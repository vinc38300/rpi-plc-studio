#!/usr/bin/env python3
"""
telegram_bot.py — Bot Telegram pour RPi-PLC Studio
Licence MIT

Fonctionnalités :
  - Alertes automatiques température (seuils configurables)
  - Notification changement état relais (K1-K10)
  - Notification démarrage/arrêt PLC
  - Commandes : /status /temp /relais /on /off /consigne /recette /stop /start /log
  - Rapport quotidien automatique à heure configurable
  - Anti-spam configurable (défaut 10 min)
"""

import json, time, threading, logging, requests
from datetime import datetime
from pathlib import Path

log = logging.getLogger("rpi-plc.telegram")

HELP_TEXT = """
🤖 *RPi-PLC Studio — Commandes disponibles*

📊 *Informations*
/status — État général du PLC
/temp — Toutes les températures
/relais — État des relais K1-K10
/log — Dernières lignes du log
/rapport — Rapport immédiat

⚙️ *Contrôle*
/on K1 — Activer un relais (K1-K10)
/off K1 — Désactiver un relais
/start — Démarrer le scan PLC
/stop — Arrêter le scan PLC

🎯 *Consignes*
/consigne RF4 20.5 — Écrire une valeur dans RF0-RF15
/consigne — Voir toutes les consignes

📋 *Recettes*
/recette — Lister les recettes disponibles
/recette NomRecette — Appliquer une recette

ℹ️ /aide — Afficher cette aide
""".strip()


class TelegramBot:
    POLL_TIMEOUT = 30

    def __init__(self, config: dict, engine, recipe_manager=None):
        self.cfg            = config.get("telegram", {})
        self.engine         = engine
        self.recipes        = recipe_manager
        self.enabled        = self.cfg.get("enabled", False)
        self.token          = self.cfg.get("token", "")
        self.chat_ids       = [str(c) for c in self.cfg.get("chat_ids", [])]
        # Seuils - valeurs réalistes pour installation de chauffage
        self.alarm_high     = float(self.cfg.get("alarm_high", 90.0))
        self.alarm_low      = float(self.cfg.get("alarm_low",  2.0))
        self.report_hour    = int(self.cfg.get("report_hour", 8))
        self.report_enabled = self.cfg.get("report_enabled", True)
        # Notifications relais et PLC
        self.notify_relays  = self.cfg.get("notify_relays",  True)
        self.notify_plc     = self.cfg.get("notify_plc",     True)
        # Anti-spam
        self._alarm_cooldown  = int(self.cfg.get("alarm_cooldown_s",  600))
        self._relay_cooldown  = int(self.cfg.get("relay_cooldown_s",   30))

        self._base          = f"https://api.telegram.org/bot{self.token}"
        self._offset        = 0
        self._running       = False
        self._thread        = None

        # Anti-spam
        self._last_alarm: dict  = {}   # {canal_key: timestamp}
        self._last_relay: dict  = {}   # {pin: timestamp}

        # État précédent pour détecter les changements
        self._prev_gpio:  dict  = {}   # {pin: value}
        self._prev_running: bool = None

        # Rapport quotidien
        self._last_report_date = None

    # ── API Telegram ─────────────────────────────────────────────────────────

    def _req(self, method: str, **kwargs) -> dict:
        try:
            r = requests.post(f"{self._base}/{method}", json=kwargs, timeout=35)
            return r.json()
        except Exception as e:
            log.debug(f"Telegram {method}: {e}")
            return {}

    def send(self, text: str, chat_id: str = None, parse_mode="Markdown"):
        if not self.enabled or not self.token:
            return
        targets = [chat_id] if chat_id else self.chat_ids
        for cid in targets:
            self._req("sendMessage", chat_id=cid, text=text,
                      parse_mode=parse_mode, disable_web_page_preview=True)

    def _get_updates(self) -> list:
        r = self._req("getUpdates", offset=self._offset,
                      timeout=self.POLL_TIMEOUT, allowed_updates=["message"])
        return r.get("result", [])

    # ── Surveillance alarmes températures ────────────────────────────────────

    def check_alarms(self, analog: dict):
        """Appelé à chaque snapshot PLC — détecte les dépassements."""
        if not self.enabled or not self.chat_ids:
            return
        now = time.time()
        for ana_id, info in analog.items():
            t = info.get("celsius")
            if t is None or (t != t):
                continue
            name    = info.get("name", ana_id)
            key_hi  = f"{ana_id}_hi"
            key_lo  = f"{ana_id}_lo"

            if t > self.alarm_high:
                if now - self._last_alarm.get(key_hi, 0) > self._alarm_cooldown:
                    self._last_alarm[key_hi] = now
                    self.send(
                        f"🔴 *ALARME HAUTE — {name}*\n"
                        f"Température : *{t:.1f}°C* (seuil {self.alarm_high}°C)\n"
                        f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_"
                    )
                    log.warning(f"Alarme Telegram haute : {name} = {t:.1f}°C")

            elif t < self.alarm_low:
                if now - self._last_alarm.get(key_lo, 0) > self._alarm_cooldown:
                    self._last_alarm[key_lo] = now
                    self.send(
                        f"🔵 *ALARME GEL — {name}*\n"
                        f"Température : *{t:.1f}°C* (seuil gel {self.alarm_low}°C)\n"
                        f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_"
                    )
                    log.warning(f"Alarme Telegram gel : {name} = {t:.1f}°C")
            else:
                self._last_alarm.pop(key_hi, None)
                self._last_alarm.pop(key_lo, None)

    # ── Notification changements état relais ─────────────────────────────────

    def check_relay_changes(self, gpio: dict):
        """Détecte les changements d'état des sorties GPIO et notifie."""
        if not self.enabled or not self.chat_ids or not self.notify_relays:
            return
        now = time.time()
        for pin_s, cfg in gpio.items():
            if cfg.get("mode") != "output":
                continue
            pin   = str(pin_s)
            val   = bool(cfg.get("value", False))
            prev  = self._prev_gpio.get(pin)

            if prev is None:
                # Premier cycle — mémoriser sans notifier
                self._prev_gpio[pin] = val
                continue

            if val != prev:
                self._prev_gpio[pin] = val
                # Anti-spam par relais
                if now - self._last_relay.get(pin, 0) < self._relay_cooldown:
                    continue
                self._last_relay[pin] = now
                name = cfg.get("name", f"GPIO{pin}")
                icon = "🟢" if val else "⚫"
                etat = "activé" if val else "désactivé"
                self.send(
                    f"{icon} *{name}* {etat}\n"
                    f"_{datetime.now().strftime('%H:%M:%S')}_"
                )
                log.info(f"Telegram relay: {name} → {etat}")

    # ── Notification démarrage/arrêt PLC ────────────────────────────────────

    def check_plc_state(self, running: bool):
        """Notifie si le PLC démarre ou s'arrête de façon inattendue."""
        if not self.enabled or not self.chat_ids or not self.notify_plc:
            return
        if self._prev_running is None:
            self._prev_running = running
            return
        if running == self._prev_running:
            return
        self._prev_running = running
        if running:
            self.send(
                f"▶ *PLC démarré*\n"
                f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_"
            )
        else:
            self.send(
                f"■ *PLC arrêté*\n"
                f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_"
            )

    # ── Rapport quotidien ────────────────────────────────────────────────────

    def check_daily_report(self):
        """Appelé depuis on_update — envoie le rapport au bon moment."""
        if not self.report_enabled or not self.enabled:
            return
        now   = datetime.now()
        today = now.date()
        if now.hour == self.report_hour and self._last_report_date != today:
            self._last_report_date = today
            self._send_daily_report()

    def _send_daily_report(self):
        s      = self.engine.snapshot()
        analog = s.get("analog", {})
        gpio   = s.get("gpio", {})
        lines  = [f"📊 *Rapport {datetime.now().strftime('%d/%m/%Y')} — {datetime.now().strftime('%H:%M')}*\n"]

        # Températures
        lines.append("🌡 *Températures :*")
        for ana_id in sorted(analog, key=lambda x: int(x[3:]) if x[3:].isdigit() else 99):
            info = analog[ana_id]
            t    = info.get("celsius")
            name = info.get("name", ana_id)
            if t is not None and t == t:
                icon = "🔴" if t > self.alarm_high else ("🔵" if t < self.alarm_low else "🟢")
                lines.append(f"  {icon} {name} : *{t:.1f}°C*")

        # Relais actifs
        actifs = [cfg.get("name", f"GPIO{p}") for p, cfg in gpio.items()
                  if cfg.get("mode") == "output" and cfg.get("value")]
        if actifs:
            lines.append(f"\n⚡ *Relais actifs :* {', '.join(actifs)}")
        else:
            lines.append(f"\n⚡ *Relais :* tous OFF")

        # Consignes RF
        regs = s.get("registers", {})
        consignes = {k: v for k, v in regs.items()
                     if k.startswith("RF") and k[2:].isdigit() and int(k[2:]) <= 15}
        if consignes:
            lines.append("\n🎯 *Consignes :*")
            for k in sorted(consignes, key=lambda x: int(x[2:])):
                lines.append(f"  *{k}* = {consignes[k]:.1f}")

        # État PLC
        lines.append(
            f"\n⚙️ PLC : {'▶ RUN' if s.get('running') else '■ STOP'} | "
            f"cycles : {s.get('cycle', 0):,} | "
            f"erreurs : {s.get('error_count', 0)}"
        )
        self.send("\n".join(lines))

    # ── Traitement des commandes ─────────────────────────────────────────────

    def _handle(self, msg: dict):
        chat_id = str(msg.get("chat", {}).get("id", ""))
        text    = msg.get("text", "").strip()
        if not text or not chat_id:
            return
        if self.chat_ids and chat_id not in self.chat_ids:
            self._req("sendMessage", chat_id=chat_id,
                      text="⛔ Accès non autorisé. Votre ID : " + chat_id)
            return
        cmd  = text.split()[0].lower().lstrip("/")
        args = text.split()[1:]

        if cmd in ("aide", "help"):
            self.send(HELP_TEXT, chat_id)
        elif cmd == "status":
            self._cmd_status(chat_id)
        elif cmd in ("temp", "temperatures", "température"):
            self._cmd_temp(chat_id)
        elif cmd in ("relais", "relay", "outputs"):
            self._cmd_relais(chat_id)
        elif cmd == "on" and args:
            self._cmd_relay_ctrl(chat_id, args[0].upper(), True)
        elif cmd == "off" and args:
            self._cmd_relay_ctrl(chat_id, args[0].upper(), False)
        elif cmd == "start":
            self.engine.start()
            self.send("▶ PLC *démarré*.", chat_id)
        elif cmd == "stop":
            self.engine.stop()
            self.send("■ PLC *arrêté*.", chat_id)
        elif cmd == "consigne":
            self._cmd_consigne(chat_id, args)
        elif cmd == "recette":
            self._cmd_recette(chat_id, args)
        elif cmd == "log":
            self._cmd_log(chat_id)
        elif cmd == "rapport":
            self._send_daily_report()
        else:
            self.send(f"❓ Commande inconnue : `{cmd}`\nTaper /aide pour la liste.", chat_id)

    def _cmd_status(self, chat_id):
        s   = self.engine.snapshot()
        ana = s.get("analog", {})
        ok  = sum(1 for v in ana.values() if v.get("celsius") is not None)
        rel = s.get("gpio", {})
        on  = sum(1 for p, c in rel.items() if c.get("mode") == "output" and c.get("value"))
        txt = (
            f"⚙️ *État RPi-PLC*\n"
            f"PLC : {'▶ *RUN*' if s.get('running') else '■ *STOP*'}\n"
            f"Sondes actives : *{ok}*\n"
            f"Relais actifs : *{on}*\n"
            f"Cycles : *{s.get('cycle', 0):,}*\n"
            f"Erreurs : *{s.get('error_count', 0)}*\n"
            f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_"
        )
        self.send(txt, chat_id)

    def _cmd_temp(self, chat_id):
        s      = self.engine.snapshot()
        analog = s.get("analog", {})
        lines  = ["🌡 *Températures actuelles :*\n"]
        for ana_id in sorted(analog, key=lambda x: int(x[3:]) if x[3:].isdigit() else 99):
            info = analog[ana_id]
            t    = info.get("celsius")
            name = info.get("name", ana_id)
            if t is not None and t == t:
                icon = "🔴" if t > self.alarm_high else ("🔵" if t < self.alarm_low else "🟢")
                lines.append(f"{icon} *{name}* : {t:.1f}°C")
            else:
                lines.append(f"⚫ *{name}* : N/C")
        self.send("\n".join(lines), chat_id)

    def _cmd_relais(self, chat_id):
        s     = self.engine.snapshot()
        gpio  = s.get("gpio", {})
        lines = ["⚡ *État des relais :*\n"]
        for pin, cfg in sorted(gpio.items(), key=lambda x: int(x[0])):
            if cfg.get("mode") == "output":
                icon = "🟢 *ON*" if cfg.get("value") else "⚫ off"
                lines.append(f"{icon} — {cfg.get('name', 'GPIO'+str(pin))}")
        self.send("\n".join(lines), chat_id)

    def _cmd_relay_ctrl(self, chat_id, relay_name: str, state: bool):
        s     = self.engine.snapshot()
        gpio  = s.get("gpio", {})
        found = None
        for pin, cfg in gpio.items():
            if cfg.get("mode") == "output":
                if (cfg.get("name", "").upper() == relay_name or
                        relay_name in cfg.get("name", "").upper()):
                    found = int(pin)
                    break
        if found is None:
            self.send(f"❓ Relais *{relay_name}* introuvable.\nUtiliser K1-K10.", chat_id)
            return
        self.engine.write_signal(found, state)
        icon = "🟢 activé" if state else "⚫ désactivé"
        self.send(f"⚡ *{relay_name}* (GPIO{found}) {icon}", chat_id)

    def _cmd_consigne(self, chat_id, args):
        if len(args) >= 2:
            ref, val = args[0].upper(), args[1]
            try:
                fval = float(val)
                if ref.startswith("RF"):
                    self.engine.registers[ref] = fval
                    self.send(f"✅ *{ref}* ← *{fval}*", chat_id)
                else:
                    self.send(f"❌ Référence invalide : `{ref}` (utiliser RF0-RF15)", chat_id)
            except ValueError:
                self.send(f"❌ Valeur invalide : `{val}`", chat_id)
        else:
            regs  = self.engine.registers
            lines = ["🎯 *Consignes RF0-RF15 :*\n"]
            for k in sorted(regs, key=lambda x: int(x[2:]) if x[2:].isdigit() else 99):
                if k.startswith("RF") and k[2:].isdigit() and int(k[2:]) <= 15:
                    lines.append(f"  *{k}* = {regs[k]:.2f}")
            self.send("\n".join(lines), chat_id)

    def _cmd_recette(self, chat_id, args):
        if self.recipes is None:
            self.send("❌ Module recettes non chargé.", chat_id)
            return
        if not args:
            names = self.recipes.list_names()
            if not names:
                self.send("📋 Aucune recette enregistrée.", chat_id)
            else:
                txt = "📋 *Recettes disponibles :*\n\n"
                for n in names:
                    r = self.recipes.get(n)
                    txt += f"• *{n}* — {r.get('description','')}\n"
                txt += "\n`/recette NomRecette` pour appliquer"
                self.send(txt, chat_id)
        else:
            name   = " ".join(args)
            result = self.recipes.apply(name, self.engine)
            if result:
                self.send(f"✅ Recette *{name}* appliquée.", chat_id)
            else:
                self.send(f"❌ Recette *{name}* introuvable.", chat_id)

    def _cmd_log(self, chat_id):
        try:
            with open("/tmp/rpi-plc.log") as f:
                lines = f.readlines()
            last = "".join(lines[-20:]).strip()
            self.send(f"📋 *Log (20 dernières lignes) :*\n```\n{last[-3000:]}\n```", chat_id)
        except Exception as e:
            self.send(f"❌ Log inaccessible : {e}", chat_id)

    # ── Boucle polling (commandes entrantes uniquement) ──────────────────────

    def _loop(self):
        log.info("Bot Telegram démarré — polling commandes")
        self.send(
            f"🤖 *RPi-PLC démarré*\n"
            f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_\n"
            f"Taper /aide pour les commandes"
        )
        while self._running:
            try:
                updates = self._get_updates()
                for upd in updates:
                    self._offset = upd["update_id"] + 1
                    if "message" in upd:
                        self._handle(upd["message"])
            except Exception as e:
                log.debug(f"Telegram loop: {e}")
                time.sleep(5)
        log.info("Bot Telegram arrêté")

    def start(self):
        if not self.enabled or not self.token:
            log.info("Bot Telegram désactivé (token manquant ou enabled=false)")
            return
        if self._running and self._thread and self._thread.is_alive():
            return
        self._running = True
        self._thread  = threading.Thread(target=self._loop,
                                          daemon=True, name="telegram")
        self._thread.start()
        log.info(f"Bot Telegram démarré (chat_ids={self.chat_ids})")

    def stop(self, silent=False):
        self._running = False
        if not silent and self.chat_ids and self.enabled:
            try:
                self.send("🔴 *RPi-PLC arrêté*")
            except Exception:
                pass

    def restart(self, cfg: dict):
        self.stop(silent=True)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        self.cfg            = cfg
        self.enabled        = cfg.get("enabled", False)
        self.token          = cfg.get("token", "")
        self.chat_ids       = [str(c) for c in cfg.get("chat_ids", [])]
        self.alarm_high     = float(cfg.get("alarm_high", 90.0))
        self.alarm_low      = float(cfg.get("alarm_low",  2.0))
        self.report_hour    = int(cfg.get("report_hour", 8))
        self.report_enabled = cfg.get("report_enabled", True)
        self.notify_relays  = cfg.get("notify_relays", True)
        self.notify_plc     = cfg.get("notify_plc", True)
        self._alarm_cooldown= int(cfg.get("alarm_cooldown_s", 600))
        self._relay_cooldown= int(cfg.get("relay_cooldown_s",  30))
        self._base          = f"https://api.telegram.org/bot{self.token}"
        self._offset        = 0
        self._last_alarm    = {}
        self._last_relay    = {}
        self._prev_gpio     = {}
        self._prev_running  = None
        self.start()
