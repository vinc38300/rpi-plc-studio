#!/usr/bin/env python3
"""
telegram_bot.py — Bot Telegram pour RPi-PLC Studio  v3
Corrections :
  - _last_error initialisé dans __init__
  - Pending updates droppés au démarrage (skip_pending)
  - _loop entièrement increvable avec retry exponentiel
  - Markdown : underscores échappés dans les noms GPIO
  - /on /off : thread-safe, pas de _save_dv_vars inexistant
  - /consigne : utilise write_register() (thread-safe)
  - 409 Conflict : détecté et corrigé automatiquement
  - Commandes /ping /diagnose /fixwebhook
"""

import json, time, threading, logging, requests
from datetime import datetime
from pathlib import Path

log = logging.getLogger("rpi-plc.telegram")

HELP_TEXT = """
🤖 *RPi-PLC — Commandes disponibles*

🔧 *Diagnostic*
/ping — Vérifier que le bot répond
/diagnose — Diagnostic complet
/fixwebhook — Corriger réception bloquée

📊 *Informations*
/status — État général du PLC
/temp — Toutes les températures
/relais — État des relais
/log — Dernières lignes du log
/rapport — Rapport immédiat

🔔 *Notifications*
/notifs — Voir l'état des notifications
/notifs relais on — Activer notifs relais
/notifs relais off — Désactiver notifs relais

🎯 *Consignes*
/consigne — Voir toutes les consignes
/consigne ambiance 20 — Modifier une consigne

📋 *Recettes*
/recette — Lister les recettes
/recette NomRecette — Appliquer une recette

ℹ️ /menu ou /aide — Afficher cette aide
""".strip()


def _md_escape(text: str) -> str:
    return str(text).replace("_", r"\_")


def _safe_name(name: str) -> str:
    if "_" in str(name):
        return f"`{name}`"
    return f"*{name}*"


class TelegramBot:
    POLL_TIMEOUT = 25

    def __init__(self, config: dict, engine, recipe_manager=None):
        self.cfg            = config.get("telegram", {})
        self.engine         = engine
        self.recipes        = recipe_manager
        self.enabled        = self.cfg.get("enabled", False)
        self.token          = self.cfg.get("token", "")
        self.chat_ids       = [str(c) for c in self.cfg.get("chat_ids", [])]
        self.alarm_high     = float(self.cfg.get("alarm_high", 90.0))
        self.alarm_low      = float(self.cfg.get("alarm_low",  2.0))
        self.report_hour    = int(self.cfg.get("report_hour", 8))
        self.report_enabled = self.cfg.get("report_enabled", True)
        self.notify_relays  = self.cfg.get("notify_relays",  False)  # OFF par défaut en régulation
        self.notify_plc     = self.cfg.get("notify_plc",     True)
        self._alarm_cooldown  = int(self.cfg.get("alarm_cooldown_s",  600))
        self._relay_cooldown  = int(self.cfg.get("relay_cooldown_s",   30))

        self._base          = f"https://api.telegram.org/bot{self.token}"
        self._offset        = 0
        self._running       = False
        self._thread        = None
        self._stop_event    = threading.Event()
        self._polling_lock  = threading.Lock()

        self._last_alarm: dict  = {}
        self._last_relay: dict  = {}
        self._prev_gpio:  dict  = {}
        self._prev_running      = None
        self._last_report_date  = None
        self._last_error: str   = None   # ← initialisé ici (évite AttributeError)

    # ── API Telegram ──────────────────────────────────────────────────────────

    def _req(self, method: str, _warn=True, **kwargs) -> dict:
        try:
            r = requests.post(f"{self._base}/{method}", json=kwargs, timeout=35)
            data = r.json()
            if not data.get("ok"):
                lvl = log.warning if _warn else log.debug
                lvl(f"Telegram {method} [{data.get('error_code','?')}]: "
                    f"{data.get('description','?')}")
            return data
        except Exception as e:
            log.warning(f"Telegram {method} exception: {e}")
            return {}

    def send(self, text: str, chat_id: str = None, parse_mode="Markdown"):
        if not self.enabled or not self.token:
            return
        targets = [chat_id] if chat_id else self.chat_ids
        for cid in targets:
            try:
                r = self._req("sendMessage", chat_id=cid, text=text,
                              parse_mode=parse_mode,
                              disable_web_page_preview=True)
                if not r.get("ok"):
                    err = r.get("description", "")
                    if "parse" in err.lower() or "entity" in err.lower():
                        plain = (text.replace("*", "").replace("`", "")
                                     .replace(r"\_", "_").replace("\\", ""))
                        self._req("sendMessage", chat_id=cid, text=plain,
                                  disable_web_page_preview=True)
            except Exception as e:
                log.debug(f"send error: {e}")

    def _delete_webhook(self):
        for attempt in range(1, 4):
            r = self._req("deleteWebhook", drop_pending_updates=True,
                          _warn=(attempt > 1))
            if r.get("ok"):
                log.info(f"Telegram : webhook supprimé (tentative {attempt})")
                break
            time.sleep(attempt * 2)
        wi = self._req("getWebhookInfo", _warn=False)
        url = wi.get("result", {}).get("url", "")
        if url:
            log.warning(f"⚠️  Webhook ENCORE ACTIF : {url}")

    def _skip_pending_updates(self):
        """
        Saute tous les messages en attente au démarrage pour éviter de traiter
        des commandes obsolètes (accumulées pendant que le bot était arrêté).
        Méthode : récupérer les updates avec timeout=0 et avancer l'offset.
        """
        try:
            r = self._req("getUpdates", offset=-1, timeout=0,
                          allowed_updates=["message"], _warn=False)
            updates = r.get("result", [])
            if updates:
                last_uid = updates[-1].get("update_id", 0)
                self._offset = last_uid + 1
                log.info(f"Telegram : {len(updates)} message(s) en attente ignoré(s) "
                         f"(offset → {self._offset})")
        except Exception as e:
            log.debug(f"_skip_pending_updates: {e}")

    def _get_updates(self) -> list:
        CHUNK, waited = 5, 0
        while self._running and not self._stop_event.is_set():
            remaining = self.POLL_TIMEOUT - waited
            t = min(CHUNK, remaining)
            if t <= 0:
                break
            with self._polling_lock:
                r = self._req("getUpdates", offset=self._offset,
                              timeout=t, allowed_updates=["message"],
                              _warn=False)
            if not r.get("ok"):
                code = r.get("error_code", 0)
                if code == 409:
                    log.warning("⚠️  409 Conflict — relance deleteWebhook")
                    self._delete_webhook()
                else:
                    log.warning(f"getUpdates erreur [{code}]: "
                                f"{r.get('description','?')}")
                time.sleep(3)
                return []
            updates = r.get("result", [])
            if updates:
                return updates
            waited += t
        return []

    def get_updates_for_test(self) -> list:
        """Utilisé par api_telegram_test — n'entre pas en conflit avec le polling."""
        try:
            with self._polling_lock:
                r = self._req("getUpdates", offset=self._offset,
                              timeout=0, allowed_updates=["message"], _warn=False)
            return r.get("result", [])
        except Exception:
            return []

    # ── Surveillance ──────────────────────────────────────────────────────────

    def check_alarms(self, analog: dict):
        if not self.enabled or not self.chat_ids:
            return
        now = time.time()

        # Noms depuis les blocs SENSOR du programme
        sensor_names = {}
        try:
            with self.engine._lock:
                prog = list(getattr(self.engine, "program", []))
            for b in prog:
                if b.get("type", "").lower() == "sensor":
                    ref  = b.get("ref", b.get("params", {}).get("ref", ""))
                    name = b.get("name", b.get("params", {}).get("name", ""))
                    if ref and name:
                        sensor_names[ref] = name.replace("_", " ")
        except Exception:
            pass

        for ana_id, info in analog.items():
            t = info.get("celsius")
            if t is None or (t != t):
                continue
            # FIX: n'alarmer que les sondes explicitement utilisées dans le programme
            # Les sondes câblées mais non référencées (cassées, déconnectées, etc.)
            # ne doivent pas générer d'alarmes Telegram.
            if sensor_names and ana_id not in sensor_names:
                continue
            # Ignorer les valeurs physiquement aberrantes (court-circuit / circuit ouvert)
            if t < -60 or t > 150:
                continue
            name = sensor_names.get(ana_id) or info.get("name", ana_id)
            khi, klo = f"{ana_id}_hi", f"{ana_id}_lo"
            if t > self.alarm_high:
                if now - self._last_alarm.get(khi, 0) > self._alarm_cooldown:
                    self._last_alarm[khi] = now
                    self.send(f"🔴 *ALARME HAUTE — {_md_escape(name)}*\n"
                              f"Température : *{t:.1f}°C* (seuil {self.alarm_high}°C)\n"
                              f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_")
            elif t < self.alarm_low:
                if now - self._last_alarm.get(klo, 0) > self._alarm_cooldown:
                    self._last_alarm[klo] = now
                    self.send(f"🔵 *ALARME GEL — {_md_escape(name)}*\n"
                              f"Température : *{t:.1f}°C* (seuil {self.alarm_low}°C)\n"
                              f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_")
            else:
                self._last_alarm.pop(khi, None)
                self._last_alarm.pop(klo, None)

    def check_relay_changes(self, gpio: dict):
        if not self.enabled or not self.chat_ids or not self.notify_relays:
            return
        now = time.time()
        for pin_s, cfg in gpio.items():
            if cfg.get("mode") != "output":
                continue
            pin  = str(pin_s)
            val  = bool(cfg.get("value", False))
            prev = self._prev_gpio.get(pin)
            if prev is None:
                self._prev_gpio[pin] = val
                continue
            if val != prev:
                self._prev_gpio[pin] = val
                if now - self._last_relay.get(pin, 0) < self._relay_cooldown:
                    continue
                self._last_relay[pin] = now
                name = cfg.get("name", f"GPIO{pin}")
                icon = "🟢" if val else "⚫"
                self.send(f"{icon} {_safe_name(name)} "
                          f"{'activé' if val else 'désactivé'}\n"
                          f"_{datetime.now().strftime('%H:%M:%S')}_")

    def check_plc_state(self, running: bool):
        if not self.enabled or not self.chat_ids or not self.notify_plc:
            return
        if self._prev_running is None:
            self._prev_running = running
            return
        if running == self._prev_running:
            return
        self._prev_running = running
        msg = ("▶ *PLC démarré*" if running else "■ *PLC arrêté*")
        self.send(f"{msg}\n_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_")

    def check_daily_report(self):
        if not self.report_enabled or not self.enabled:
            return
        now = datetime.now()
        if now.hour == self.report_hour and self._last_report_date != now.date():
            self._last_report_date = now.date()
            self._send_daily_report()

    def _send_daily_report(self):
        try:
            s      = self.engine.snapshot()
            analog = s.get("analog", {})
            gpio   = s.get("gpio", {})
            lines  = [f"📊 *Rapport {datetime.now().strftime('%d/%m/%Y %H:%M')}*\n"]
            lines.append("🌡 *Températures :*")
            for aid in sorted(analog, key=lambda x: int(x[3:]) if x[3:].isdigit() else 99):
                info = analog[aid]
                t    = info.get("celsius")
                name = info.get("name", aid)
                if t is not None and t == t:
                    icon = ("🔴" if t > self.alarm_high
                            else "🔵" if t < self.alarm_low else "🟢")
                    lines.append(f"  {icon} {_md_escape(name)} : *{t:.1f}°C*")
            actifs = [cfg.get("name", f"GPIO{p}") for p, cfg in gpio.items()
                      if cfg.get("mode") == "output" and cfg.get("value")]
            if actifs:
                lines.append(f"\n⚡ *Relais actifs :* "
                             f"{', '.join(_md_escape(n) for n in actifs)}")
            else:
                lines.append("\n⚡ *Relais :* tous OFF")
            regs = s.get("registers", {})
            consignes = {k: v for k, v in regs.items()
                         if k.startswith("RF") and k[2:].isdigit()
                         and int(k[2:]) <= 15}
            if consignes:
                lines.append("\n🎯 *Consignes :*")
                for k in sorted(consignes, key=lambda x: int(x[2:])):
                    lines.append(f"  *{k}* = {consignes[k]:.1f}")
            last_err = s.get("error") or "—"
            lines.append(
                f"\n⚙️ PLC : {'▶ RUN' if s.get('running') else '■ STOP'} | "
                f"cycles : {s.get('cycle', 0):,} | "
                f"erreur : {_md_escape(str(last_err))}"
            )
            self.send("\n".join(lines))
        except Exception as e:
            log.error(f"_send_daily_report: {e}", exc_info=True)

    # ── Commandes ─────────────────────────────────────────────────────────────

    def _parse_cmd(self, text: str):
        parts = text.strip().split()
        if not parts:
            return "", []
        raw = parts[0].lstrip("/").lower()
        if "@" in raw:
            raw = raw.split("@")[0]
        # Telegram échappe les underscores en \_ dans certains clients
        raw = raw.replace("\\_", "_").replace("\\", "")
        return raw, parts[1:]

    def _handle(self, msg: dict):
        chat_id = str(msg.get("chat", {}).get("id", ""))
        text    = msg.get("text", "").strip()
        if not text or not chat_id:
            return
        if self.chat_ids and chat_id not in self.chat_ids:
            self._req("sendMessage", chat_id=chat_id,
                      text=f"⛔ Accès non autorisé.\nVotre ID : `{chat_id}`",
                      parse_mode="Markdown")
            return
        cmd, args = self._parse_cmd(text)
        if not cmd:
            return
        log.info(f"Telegram cmd: /{cmd} {args} (chat {chat_id})")
        try:
            if cmd in ("aide", "help", "menu"):
                self.send(HELP_TEXT, chat_id)
            elif cmd == "ping":
                self.send(f"🏓 Pong !\n_{datetime.now().strftime('%H:%M:%S')}_", chat_id)
            elif cmd == "diagnose":
                self._cmd_diagnose(chat_id)
            elif cmd == "fixwebhook":
                self._cmd_fixwebhook(chat_id)
            elif cmd == "status":
                self._cmd_status(chat_id)
            elif cmd in ("temp", "temperatures", "t"):
                self._cmd_temp(chat_id)
            elif cmd in ("relais", "relay", "r"):
                self._cmd_relais(chat_id)
            elif cmd == "on" and args:
                self._cmd_relay_ctrl(chat_id, args[0].upper(), True)
            elif cmd == "off" and args:
                self._cmd_relay_ctrl(chat_id, args[0].upper(), False)
            elif cmd == "on":
                self.send("❓ Préciser le relais — ex: `/on K1`", chat_id)
            elif cmd == "off":
                self.send("❓ Préciser le relais — ex: `/off K1`", chat_id)
            elif cmd in ("plcstart",):
                # Confirmation requise pour démarrer le PLC
                self.send(
                    "⚠️ Confirmer le démarrage du scan PLC ?\n"
                    "Répondre `/plcstart_confirm` pour confirmer.", chat_id)
            elif cmd == "plcstart_confirm":
                self.engine.start()
                self.send("▶ PLC *démarré*.", chat_id)
            elif cmd in ("plcstop", "stop"):
                # Confirmation requise pour arrêter le PLC
                self.send(
                    "⚠️ Confirmer l'arrêt du scan PLC ?\n"
                    "Répondre `/plcstop_confirm` pour confirmer.", chat_id)
            elif cmd == "plcstop_confirm":
                self.engine.stop()
                self.send("■ PLC *arrêté*.", chat_id)
            elif cmd == "notifs":
                self._cmd_notifs(chat_id, args)
            elif cmd == "consigne":
                self._cmd_consigne(chat_id, args)
            elif cmd == "recette":
                self._cmd_recette(chat_id, args)
            elif cmd == "log":
                self._cmd_log(chat_id)
            elif cmd == "rapport":
                self._send_daily_report()
            else:
                # Vérifier si la commande correspond à un nom de variable AV
                # ex: /conssigne_ambiance 20  ou  /temp_chaudiere
                try:
                    av = self.engine.snapshot().get("av_vars", {})
                    av_pub = {k: v for k, v in av.items()
                              if not k.startswith("_") and isinstance(v, (int, float))}
                    cmd_lc = cmd.lower()
                    # Chercher correspondance exacte ou partielle
                    match = None
                    if cmd_lc in av_pub:
                        match = cmd_lc
                    else:
                        candidates = [k for k in av_pub if cmd_lc in k]
                        if len(candidates) == 1:
                            match = candidates[0]
                    if match:
                        if args:
                            # /nom_variable valeur → écrire
                            self._cmd_consigne(chat_id, [match, args[0]])
                        else:
                            # /nom_variable seul → afficher la valeur actuelle
                            val = av_pub[match]
                            self.send(
                                f"🎯 *{_md_escape(match)}* = *{val:.2f}*\n"
                                f"_Pour modifier : `/{match} 20.5`_",
                                chat_id
                            )
                    else:
                        self.send(
                            f"❓ Commande inconnue : `/{cmd}`\nTaper /menu.",
                            chat_id
                        )
                except Exception:
                    self.send(
                        f"❓ Commande inconnue : `/{cmd}`\nTaper /menu.",
                        chat_id
                    )
        except Exception as e:
            log.error(f"Telegram _handle /{cmd}: {e}", exc_info=True)
            try:
                self.send(f"⚠️ Erreur : `{type(e).__name__}: {e}`", chat_id)
            except Exception:
                pass

    def _cmd_notifs(self, chat_id, args):
        """Affiche ou modifie l'état des notifications."""
        if not args:
            # Afficher l'état actuel
            rel  = "🟢 actives" if self.notify_relays else "⚫ désactivées"
            plc  = "🟢 actives" if self.notify_plc    else "⚫ désactivées"
            self.send(
                f"🔔 *Notifications actuelles :*\n\n"
                f"Changements relais : {rel}\n"
                f"Démarrage/arrêt PLC : {plc}\n"
                f"Alarmes températures : 🟢 toujours actives\n\n"
                f"_Modifier : `/notifs relais on/off` | `/notifs plc on/off`_",
                chat_id
            )
        elif len(args) >= 2:
            cible = args[0].lower()
            etat  = args[1].lower() in ("on", "1", "oui", "true")
            if cible == "relais":
                self.notify_relays = etat
                self.send(
                    f"🔔 Notifications relais : "
                    f"{'🟢 activées' if etat else '⚫ désactivées'}\n"
                    f"_Note : dans une régulation, les relais commutent souvent._\n"
                    f"_Cooldown actuel : {self._relay_cooldown}s entre deux notifs._",
                    chat_id
                )
            elif cible == "plc":
                self.notify_plc = etat
                self.send(
                    f"🔔 Notifications PLC : "
                    f"{'🟢 activées' if etat else '⚫ désactivées'}",
                    chat_id
                )
            elif cible == "cooldown" and cible == "relais" and len(args) >= 3:
                try:
                    self._relay_cooldown = int(args[2])
                    self.send(f"⏱ Cooldown relais : *{self._relay_cooldown}s*", chat_id)
                except ValueError:
                    self.send("❌ Valeur invalide", chat_id)
            else:
                self.send("❓ Usage : `/notifs relais on/off` | `/notifs plc on/off`",
                          chat_id)
        else:
            self.send("❓ Usage : `/notifs relais on/off` | `/notifs plc on/off`", chat_id)

    def _cmd_diagnose(self, chat_id):
        lines = ["🔍 *Diagnostic RPi-PLC Bot*\n"]
        wi = self._req("getWebhookInfo", _warn=False)
        wh_url = wi.get("result", {}).get("url", "")
        lines.append(f"{'✅' if not wh_url else '❌'} Webhook : "
                     f"{'aucun (polling OK)' if not wh_url else f'ACTIF → `{wh_url}`'}")
        me = self._req("getMe", _warn=False)
        if me.get("ok"):
            lines.append(f"✅ Token valide — @{me.get('result',{}).get('username','?')}")
        else:
            lines.append(f"❌ Token invalide")
        lines.append(f"✅ Chat ID : `{chat_id}`")
        lines.append(f"ℹ️ Offset : `{self._offset}`")
        try:
            s = self.engine.snapshot()
            lines.append(f"{'▶' if s.get('running') else '■'} PLC "
                         f"{'RUN' if s.get('running') else 'STOP'} | "
                         f"cycles {s.get('cycle',0):,}")
        except Exception as e:
            lines.append(f"⚠️ PLC : {e}")
        if wh_url:
            lines.append("\n⚠️ Envoyer `/fixwebhook` pour corriger.")
        self.send("\n".join(lines), chat_id)

    def _cmd_fixwebhook(self, chat_id):
        self.send("🔧 Suppression webhook…", chat_id)
        self._delete_webhook()
        wi = self._req("getWebhookInfo", _warn=False)
        url = wi.get("result", {}).get("url", "")
        if not url:
            self.send("✅ Webhook supprimé — polling actif.", chat_id)
        else:
            self.send(f"❌ Webhook toujours actif : `{url}`", chat_id)

    def _cmd_status(self, chat_id):
        try:
            s    = self.engine.snapshot()
            ana  = s.get("analog", {})
            ok   = sum(1 for v in ana.values() if v.get("celsius") is not None)
            rel  = s.get("gpio", {})
            on   = sum(1 for c in rel.values()
                       if c.get("mode") == "output" and c.get("value"))
            last_err = s.get("error")
            err_str  = f"`{_md_escape(str(last_err))}`" if last_err else "aucune"
            self.send(
                f"⚙️ *État RPi-PLC*\n"
                f"PLC : {'▶ *RUN*' if s.get('running') else '■ *STOP*'}\n"
                f"Sondes actives : *{ok}*\n"
                f"Relais actifs : *{on}*\n"
                f"Cycles : *{s.get('cycle', 0):,}*\n"
                f"Dernière erreur : {err_str}\n"
                f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_",
                chat_id
            )
        except Exception as e:
            self.send(f"⚠️ Erreur status : `{e}`", chat_id)

    def _cmd_temp(self, chat_id):
        try:
            s      = self.engine.snapshot()
            analog = s.get("analog", {})
            if not analog:
                self.send("🌡 Aucune sonde configurée.", chat_id)
                return

            # Mapping ANA→nom lisible depuis les blocs SENSOR du programme
            # Construit dynamiquement depuis engine.program si disponible
            sensor_names = {}
            try:
                with self.engine._lock:
                    prog = list(getattr(self.engine, "program", []))
                for b in prog:
                    if b.get("type", "").lower() == "sensor":
                        ref  = b.get("ref", b.get("params", {}).get("ref", ""))
                        name = b.get("name", b.get("params", {}).get("name", ""))
                        if ref and name:
                            sensor_names[ref] = name.replace("_", " ")
            except Exception:
                pass

            lines = ["🌡 *Températures :*\n"]
            shown = 0
            for aid in sorted(analog,
                              key=lambda x: int(x[3:]) if x[3:].isdigit() else 99):
                info = analog[aid]
                t    = info.get("celsius")
                if t is None or (t != t):
                    continue
                # Ignorer les sondes non câblées (valeurs aberrantes)
                if t < -60 or t > 150:
                    continue
                # Nom : depuis le mapping SENSOR, sinon depuis la config analog
                name = sensor_names.get(aid) or info.get("name", aid)
                icon = ("🔴" if t > self.alarm_high
                        else "🔵" if t < self.alarm_low else "🟢")
                lines.append(f"{icon} *{_md_escape(name)}* : {t:.1f}°C")
                shown += 1

            if shown == 0:
                self.send("🌡 Aucune sonde active.", chat_id)
                return
            self.send("\n".join(lines), chat_id)
        except Exception as e:
            self.send(f"⚠️ Erreur temp : `{e}`", chat_id)

    def _cmd_relais(self, chat_id):
        try:
            gpio    = self.engine.snapshot().get("gpio", {})
            outputs = {str(p): c for p, c in gpio.items()
                       if c.get("mode") == "output"}
            if not outputs:
                self.send("⚡ Aucune sortie GPIO configurée.", chat_id)
                return
            lines = ["⚡ *État des relais :*\n"]
            for pin in sorted(outputs, key=lambda x: int(x) if str(x).isdigit() else 0):
                cfg  = outputs[pin]
                icon = "🟢 *ON*" if cfg.get("value") else "⚫ off"
                name = cfg.get("name", "GPIO" + str(pin))
                lines.append(f"{icon} — {_safe_name(name)}")
            self.send("\n".join(lines), chat_id)
        except Exception as e:
            self.send(f"⚠️ Erreur relais : `{e}`", chat_id)

    def _cmd_relay_ctrl(self, chat_id, relay_name: str, state: bool):
        try:
            gpio       = self.engine.snapshot().get("gpio", {})
            found_pin  = None
            found_name = None
            for pin, cfg in gpio.items():
                if cfg.get("mode") == "output":
                    n = cfg.get("name", "").upper()
                    if n == relay_name or relay_name in n:
                        found_pin  = int(pin)
                        found_name = cfg.get("name", f"GPIO{pin}")
                        break
            if found_pin is None:
                self.send(f"❓ Relais *{relay_name}* introuvable.\n"
                          f"Utiliser `/relais` pour voir les noms.", chat_id)
                return
            self.engine.write_signal(found_pin, state)
            # Sync dv_vars si applicable (thread-safe)
            try:
                with self.engine._lock:
                    prog = list(getattr(self.engine, "program", []))
                for block in prog:
                    if block.get("type") == "dv":
                        blk_out = block.get("output")
                        if blk_out is not None and int(blk_out) == found_pin:
                            vn = block.get("varname", "").lower()
                            if vn:
                                with self.engine._lock:
                                    self.engine.dv_vars[vn] = state
            except Exception as de:
                log.debug(f"dv_vars sync: {de}")
            icon = "🟢 activé" if state else "⚫ désactivé"
            self.send(f"⚡ {_safe_name(found_name)} {icon}", chat_id)
        except Exception as e:
            self.send(f"⚠️ Erreur commande relais : `{e}`", chat_id)

    def _cmd_consigne(self, chat_id, args):
        try:
            s      = self.engine.snapshot()
            av     = s.get("av_vars", {})
            # Filtrer les variables internes (commençant par _)
            av_pub = {k: v for k, v in av.items()
                      if not k.startswith("_") and isinstance(v, (int, float))}

            if len(args) >= 2:
                # /consigne NomVariable valeur
                varname = args[0]
                val_str = args[1]
                try:
                    fval = float(val_str.replace(",", "."))
                except ValueError:
                    self.send(f"❌ Valeur invalide : `{val_str}`", chat_id)
                    return

                # Chercher la variable (insensible à la casse)
                varname_lc = varname.lower()
                if varname.startswith("RF") and varname[2:].isdigit():
                    # Registre RF direct
                    self.engine.write_register(varname.upper(), fval)
                    self.send(f"✅ *{varname.upper()}* ← *{fval}*", chat_id)
                elif varname_lc in av_pub:
                    # Variable AV connue du moteur
                    self.engine.write_av(varname_lc, fval)
                    self.send(
                        f"✅ *{_md_escape(varname_lc)}* ← *{fval}*\n"
                        f"_(était : {av_pub[varname_lc]:.1f})_",
                        chat_id
                    )
                else:
                    # Cherche une correspondance partielle
                    matches = [k for k in av_pub if varname_lc in k]
                    if len(matches) == 1:
                        self.engine.write_av(matches[0], fval)
                        self.send(
                            f"✅ *{_md_escape(matches[0])}* ← *{fval}*\n"
                            f"_(était : {av_pub[matches[0]]:.1f})_",
                            chat_id
                        )
                    elif len(matches) > 1:
                        liste = "\n".join(f"  • `{_md_escape(k)}`" for k in sorted(matches))
                        self.send(
                            f"❓ *{varname}* correspond à plusieurs variables :\n{liste}\n\n"
                            f"Préciser le nom complet.",
                            chat_id
                        )
                    else:
                        self.send(
                            f"❌ Variable *{_md_escape(varname)}* introuvable.\n"
                            f"Taper `/consigne` pour voir la liste.",
                            chat_id
                        )

            elif len(args) == 1:
                # /consigne NomVariable — afficher la valeur actuelle
                varname_lc = args[0].lower()
                matches = {k: v for k, v in av_pub.items() if varname_lc in k}
                if matches:
                    lines = [f"🎯 *Consignes correspondantes :*\n"]
                    for k, v in sorted(matches.items()):
                        lines.append(f"  `{_md_escape(k)}` = *{v:.2f}*")
                    self.send("\n".join(lines), chat_id)
                else:
                    self.send(f"❌ Aucune variable contenant `{args[0]}`", chat_id)

            else:
                # /consigne — lister toutes les consignes par catégorie
                if not av_pub:
                    self.send("🎯 Aucune consigne disponible.", chat_id)
                    return

                # Grouper par préfixe thématique
                groupes = {
                    "🌡 Températures / Ambiance": ["ambiance","correction","corect"],
                    "🔵 Ballons ECS":             ["ballon","ecs"],
                    "☀️ Solaire":                 ["solaire","panneau","paneaux"],
                    "🔥 Chaudière":               ["chaudiere","chaudie"],
                    "🕐 Programmation":            ["heure","prog","jour","nuit"],
                    "⚙️ Autres":                   [],
                }
                affectes = set()
                lignes_groupes = {}
                for grp, mots in groupes.items():
                    if not mots:
                        continue
                    lignes_groupes[grp] = []
                    for k, v in sorted(av_pub.items()):
                        if any(m in k for m in mots):
                            lignes_groupes[grp].append(f"  `{_md_escape(k)}` = *{v:.2f}*")
                            affectes.add(k)

                # Autres = non affectés
                autres = [f"  `{_md_escape(k)}` = *{v:.2f}*"
                          for k, v in sorted(av_pub.items()) if k not in affectes]
                if autres:
                    lignes_groupes["⚙️ Autres"] = autres

                lines = ["🎯 *Consignes du programme :*\n"]
                for grp, ls in lignes_groupes.items():
                    if ls:
                        lines.append(f"\n{grp}")
                        lines.extend(ls)

                lines.append(
                    "\n_Modifier : `/consigne nom valeur`_\n"
                    "_ex : `/consigne ambiance 20`_"
                )
                self.send("\n".join(lines), chat_id)

        except Exception as e:
            self.send(f"⚠️ Erreur consigne : `{e}`", chat_id)

    def _cmd_recette(self, chat_id, args):
        if self.recipes is None:
            self.send("❌ Module recettes non chargé.", chat_id)
            return
        try:
            if not args:
                names = self.recipes.list_names()
                if not names:
                    self.send("📋 Aucune recette.", chat_id)
                else:
                    txt = "📋 *Recettes disponibles :*\n\n"
                    for n in names:
                        r   = self.recipes.get(n)
                        txt += f"• *{_md_escape(n)}* — {_md_escape(r.get('description',''))}\n"
                    self.send(txt, chat_id)
            else:
                name   = " ".join(args)
                result = self.recipes.apply(name, self.engine)
                if result:
                    self.send(f"✅ Recette *{_md_escape(name)}* appliquée.", chat_id)
                else:
                    self.send(f"❌ Recette *{_md_escape(name)}* introuvable.", chat_id)
        except Exception as e:
            self.send(f"⚠️ Erreur recette : `{e}`", chat_id)

    def _cmd_log(self, chat_id):
        try:
            for path in ["/tmp/rpi-plc.log", "/var/log/rpi-plc.log"]:
                if Path(path).exists():
                    with open(path) as f:
                        lines = f.readlines()
                    last = "".join(lines[-20:]).strip()
                    self.send(f"📋 *Log :*\n```\n{last[-3000:]}\n```", chat_id)
                    return
            self.send("❌ Fichier log introuvable.", chat_id)
        except Exception as e:
            self.send(f"❌ Log inaccessible : `{e}`", chat_id)

    # ── Boucle polling ────────────────────────────────────────────────────────

    def _loop(self):
        log.warning("Bot Telegram : démarrage thread polling (PID visible dans journalctl)")
        retry_delay = 5

        while self._running:
            try:
                self._loop_once()
            except BaseException as e:
                self._last_error = f"{type(e).__name__}: {e}"
                log.error(f"Bot Telegram crash: {self._last_error}", exc_info=True)
                if self._running and not isinstance(e, (SystemExit, KeyboardInterrupt)):
                    log.warning(f"Relance bot dans {retry_delay}s…")
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * 2, 120)
                else:
                    self._running = False
                    break
            else:
                retry_delay = 5

        log.warning(f"Bot Telegram arrêté (last_error={self._last_error})")

    def _loop_once(self):
        log.warning("Bot Telegram : _loop_once démarré")
        # Étape 1 : vérifier token
        me = self._req("getMe")
        if not me.get("ok"):
            log.error(f"Token invalide : {me.get('description','?')}")
            time.sleep(30)
            return

        log.warning(f"Bot connecté : @{me.get('result',{}).get('username','?')}")

        # Étape 2 : supprimer webhook
        self._delete_webhook()
        time.sleep(1)

        # Étape 3 : sauter les messages en attente (évite de rejouer de vieux /on /off)
        self._skip_pending_updates()

        # Étape 4 : message de démarrage
        self.send(
            f"🤖 *RPi-PLC démarré*\n"
            f"_{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}_\n"
            f"Taper /menu pour les commandes"
        )
        log.warning(f"Polling actif (chat_ids={self.chat_ids}, offset={self._offset})")

        # Étape 5 : boucle polling
        empty_count = 0
        while self._running:
            try:
                updates = self._get_updates()
                if updates:
                    empty_count = 0
                    for upd in updates:
                        uid = upd.get("update_id", 0)
                        self._offset = uid + 1
                        log.info(f"Update reçu : update_id={uid}")
                        if "message" in upd:
                            try:
                                self._handle(upd["message"])
                            except Exception as e:
                                log.error(f"_handle: {e}", exc_info=True)
                else:
                    empty_count += 1
                    if empty_count % 24 == 0:
                        log.debug(f"Polling heartbeat (offset={self._offset})")
            except Exception as e:
                log.warning(f"Polling error: {e}")
                time.sleep(5)

    # ── Cycle de vie ──────────────────────────────────────────────────────────

    def start(self):
        if not self.enabled or not self.token:
            log.warning("Bot Telegram désactivé (enabled=False ou token vide)")
            return
        if self._running and self._thread and self._thread.is_alive():
            log.warning("Bot Telegram déjà actif — pas de redémarrage")
            return

        # Capturer les exceptions non interceptées du thread (Python 3.8+)
        def _thread_excepthook(args):
            self._last_error = f"{args.exc_type.__name__}: {args.exc_value}"
            log.error(f"Bot Telegram exception non capturée dans le thread: "
                      f"{self._last_error}", exc_info=(args.exc_type,
                      args.exc_value, args.exc_traceback))
        try:
            threading.excepthook = _thread_excepthook
        except AttributeError:
            pass  # Python < 3.8

        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop,
                                        daemon=False, name="telegram")
        self._thread.start()
        log.warning(f"Bot Telegram thread démarré (chat_ids={self.chat_ids}, "
                    f"thread={self._thread.ident})")

    def stop(self, silent=False):
        self._running = False
        self._stop_event.set()
        if not silent and self.chat_ids and self.enabled:
            try:
                self.send("🔴 *RPi-PLC arrêté*")
            except Exception:
                pass

    def restart(self, cfg: dict):
        self.stop(silent=True)
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=self.POLL_TIMEOUT + 5)
        self._stop_event.clear()
        self.cfg            = cfg
        self.enabled        = cfg.get("enabled", False)
        # Ne jamais écraser le token par une valeur vide (champ masqué dans le formulaire)
        new_token = cfg.get("token", "")
        if new_token:
            self.token = new_token
        # sinon on garde self.token existant
        self.chat_ids       = [str(c) for c in cfg.get("chat_ids", [])]
        self.alarm_high     = float(cfg.get("alarm_high", 90.0))
        self.alarm_low      = float(cfg.get("alarm_low",  2.0))
        self.report_hour    = int(cfg.get("report_hour", 8))
        self.report_enabled = cfg.get("report_enabled", True)
        self.notify_relays  = cfg.get("notify_relays", False)
        self.notify_plc     = cfg.get("notify_plc", True)
        self._alarm_cooldown= int(cfg.get("alarm_cooldown_s", 600))
        self._relay_cooldown= int(cfg.get("relay_cooldown_s",  30))
        self._base          = f"https://api.telegram.org/bot{self.token}"
        self._offset        = 0
        self._last_error    = None
        self._last_alarm    = {}
        self._last_relay    = {}
        self._prev_gpio     = {}
        self._prev_running  = None
        log.warning(f"Bot Telegram restart — token={'OK' if self.token else 'VIDE !'} "
                    f"enabled={self.enabled} chat_ids={self.chat_ids}")
        self.start()
