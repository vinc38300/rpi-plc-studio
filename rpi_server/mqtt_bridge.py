#!/usr/bin/env python3
"""
mqtt_bridge.py — Pont MQTT pour RPi-PLC Studio v3.4
Chaque bloc MQTT du programme s'abonne a un topic et ecrit sa valeur dans un RF.
Les blocs MQTT publish ecrivent un RF vers un topic.
"""
import json, re, threading, logging, time
log = logging.getLogger("rpi-plc.mqtt")

try:
    import paho.mqtt.client as mqtt
    _PAHO_OK = True
except ImportError:
    _PAHO_OK = False
    log.warning("paho-mqtt absent — pip3 install paho-mqtt")


def _to_float(payload: bytes, default=0.0):
    try:
        s = payload.decode("utf-8", errors="ignore").strip()
        if s.lower() in ("true","on","1"):  return 1.0
        if s.lower() in ("false","off","0"): return 0.0
        return float(s)
    except Exception:
        try:
            d = json.loads(s)
            if isinstance(d, dict):
                for k in ("value","v","val","power","W","watt"):
                    if k in d: return float(d[k])
                return float(next(iter(d.values())))
            return float(d)
        except Exception:
            return default


class MQTTBridge:
    def __init__(self, config: dict, engine):
        self._cfg    = config.get("mqtt", {})
        self._engine = engine
        self._client = None
        self._thread = None
        self._lock   = threading.Lock()
        self._subs   = {}   # topic -> [{"reg_out": "RF300", "type": "float|bool", "stale_timeout": int|None}]
        self._pubs   = {}   # rf -> {"topic": "...", "retain": bool}
        self._rf_prev= {}   # rf -> derniere valeur publiee (evite doublons)
        self._rf_last_seen  = {}   # rf -> timestamp du dernier changement REEL de valeur (watchdog)
        self._rf_last_raw   = {}   # rf -> derniere valeur brute recue par MQTT (detection doublons)
        self._rf_frozen     = {}   # rf -> True si le watchdog a coupe ce registre (republications ignorees)
        self._watchdog_thread = None
        self._keepalive_thread = None
        # ID du portail Venus OS (ex: c0619ab3fadc), auto-detecte depuis les
        # topics N/{portalId}/... ou force via config["mqtt"]["portal_id"]
        self._portal_id = self._cfg.get("portal_id") or None
        self._keepalive_interval = int(self._cfg.get("keepalive_refresh", 45))  # < ~55-60s (limite Venus)
        self.enabled = self._cfg.get("enabled", False)

    # ── API publique ──────────────────────────────────────────────────────────

    def configure_blocks(self, program: list):
        """Reconstruit les tables sub/pub depuis le programme compile."""
        with self._lock:
            self._subs.clear()
            self._pubs.clear()
            self._rf_prev.clear()
            self._rf_last_seen.clear()
            self._rf_last_raw.clear()
            self._rf_frozen.clear()
        for blk in program:
            if str(blk.get("type", "")).lower() != "mqtt":
                continue
            topic = blk.get("topic", "")
            if not topic:
                continue
            reg_out = blk.get("reg_out", "")
            reg_in  = blk.get("reg_in",  "")
            val_type= blk.get("val_type", "float")
            retain  = blk.get("retain", False)
            # Watchdog optionnel : 0/absent = desactive (comportement d'origine).
            # A regler uniquement sur les topics qui doivent retomber a 0 en
            # l'absence de message (ex: charge/decharge batterie), pas sur les
            # capteurs qui publient rarement par nature (temperatures, etc.)
            try:
                stale_timeout = float(blk.get("stale_timeout") or 0)
            except (TypeError, ValueError):
                stale_timeout = 0
            if reg_out:
                with self._lock:
                    self._subs.setdefault(topic, []).append(
                        {"reg_out": reg_out, "val_type": val_type,
                         "stale_timeout": stale_timeout if stale_timeout > 0 else None}
                    )
                    if stale_timeout > 0:
                        # FIX : amorcer le chrono watchdog des la config du bloc,
                        # pas seulement a la reception d'un message MQTT reel.
                        # Sans ca, un topic deja silencieux au demarrage (ou dont
                        # la valeur RF a ete restauree non-nulle par la
                        # persistance) laisse _rf_last_seen[reg] a None pour
                        # toujours -> "last is not None" est faux a vie -> le
                        # watchdog ne se declenche JAMAIS et le registre reste
                        # fige sur sa derniere valeur au lieu de retomber a 0.
                        self._rf_last_seen.setdefault(reg_out, time.time())
            if reg_in:
                with self._lock:
                    self._pubs[reg_in] = {"topic": topic, "retain": retain}
        # Auto-detection du portail Venus OS (pour le keepalive) depuis les
        # topics deja presents, si pas force manuellement en config.
        if not self._cfg.get("portal_id"):
            with self._lock:
                for t in list(self._subs.keys()):
                    m = re.match(r'^[NW]/([0-9a-fA-F]{6,})/', t)
                    if m:
                        self._portal_id = m.group(1)
                        break
        if self._client and self._client.is_connected():
            self._resubscribe()
        log.info(f"MQTT: {len(self._subs)} sub(s), {len(self._pubs)} pub(s)")

    def start(self):
        if not self.enabled:
            return
        if not _PAHO_OK:
            log.error("paho-mqtt manquant — bloc MQTT desactive"); return
        self._thread = threading.Thread(target=self._run, daemon=True, name="mqtt-bridge")
        self._thread.start()
        self._watchdog_thread = threading.Thread(
            target=self._watchdog_loop, daemon=True, name="mqtt-watchdog"
        )
        self._watchdog_thread.start()
        self._keepalive_thread = threading.Thread(
            target=self._keepalive_loop, daemon=True, name="mqtt-keepalive"
        )
        self._keepalive_thread.start()

    def stop(self):
        if self._client:
            try: self._client.disconnect()
            except Exception: pass

    def publish(self, reg: str, value):
        """Appele par le moteur PLC apres chaque scan pour les blocs MQTT publish."""
        if not self._client or not self._client.is_connected():
            return
        with self._lock:
            info = self._pubs.get(reg)
        if not info:
            return
        # Eviter de republier si la valeur n'a pas change
        prev = self._rf_prev.get(reg)
        val  = float(value)
        if prev is not None and abs(prev - val) < 1e-6:
            return
        self._rf_prev[reg] = val
        topic   = info["topic"]
        retain  = info.get("retain", False)
        payload = "1" if val else "0" if abs(val) < 0.5 else str(round(val, 3))
        try:
            self._client.publish(topic, payload, qos=1, retain=retain)
        except Exception as e:
            log.debug(f"MQTT publish {topic}: {e}")

    # ── Interne ───────────────────────────────────────────────────────────────

    def _run(self):
        host    = self._cfg.get("host", "localhost")
        port    = int(self._cfg.get("port", 1883))
        user    = self._cfg.get("username", "")
        pwd     = self._cfg.get("password", "")
        keepalive = int(self._cfg.get("keepalive", 60))

        while True:
            try:
                self._client = mqtt.Client(
                    client_id=f"rpi-plc-{id(self)}",
                    protocol=mqtt.MQTTv311
                )
                if user:
                    self._client.username_pw_set(user, pwd)
                self._client.on_connect    = self._on_connect
                self._client.on_message    = self._on_message
                self._client.on_disconnect = self._on_disconnect
                self._client.reconnect_delay_set(min_delay=2, max_delay=30)
                log.info(f"MQTT connexion -> {host}:{port}")
                self._client.connect(host, port, keepalive)
                self._client.loop_forever()
            except Exception as e:
                log.warning(f"MQTT erreur: {e} — retry 15s")
                time.sleep(15)

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            log.info("MQTT connecte")
            self._resubscribe()
            self._send_keepalive()   # reveille immediatement Venus OS
        else:
            log.warning(f"MQTT connexion refusee rc={rc}")

    def _on_disconnect(self, client, userdata, rc):
        log.warning(f"MQTT deconnecte rc={rc}")

    def _send_keepalive(self):
        """Reveille le pont dbus-mqtt de Venus OS. Sans cette requete
        periodique, Venus arrete de publier les topics au bout d'environ
        55-60s (comportement documente, pas un bug reseau)."""
        if not self._portal_id or not self._client or not self._client.is_connected():
            return
        try:
            self._client.publish(f"R/{self._portal_id}/keepalive", "", qos=0)
            log.debug(f"MQTT keepalive -> R/{self._portal_id}/keepalive")
        except Exception as e:
            log.debug(f"MQTT keepalive erreur: {e}")

    def _keepalive_loop(self):
        while True:
            time.sleep(self._keepalive_interval)
            self._send_keepalive()

    def _on_message(self, client, userdata, msg):
        topic   = msg.topic
        with self._lock:
            entries = list(self._subs.get(topic, []))
        for e in entries:
            val = _to_float(msg.payload)
            reg = e["reg_out"]
            try:
                stale_timeout = e.get("stale_timeout")
                if not stale_timeout:
                    self._engine.write_register(reg, val)
                    continue
                # FIX watchdog "topic figé" : certains ponts (Venus/Node-RED sur les
                # topics custom type VENUS/Batterie/Decharge) ne coupent jamais la
                # publication — ils republient en boucle la DERNIERE valeur connue
                # (notamment reveilles par notre propre keepalive), sans jamais
                # envoyer explicitement 0 quand la grandeur reelle s'arrete.
                # Avant ce fix, on rafraichissait _rf_last_seen a CHAQUE message
                # recu, meme identique -> le watchdog ne se declenchait donc jamais
                # dans ce cas (topic "vivant" en apparence, mais fige).
                with self._lock:
                    prev_raw = self._rf_last_raw.get(reg)
                    is_dup   = prev_raw is not None and abs(prev_raw - val) < 1e-6
                    self._rf_last_raw[reg] = val
                    if not is_dup:
                        # Valeur reellement nouvelle -> le topic est vivant : on
                        # rearme le chrono et on leve le gel eventuel.
                        self._rf_last_seen[reg] = time.time()
                        self._rf_frozen[reg] = False
                    frozen = self._rf_frozen.get(reg, False)
                # DEBUG TEMPORAIRE — a retirer une fois le diagnostic termine.
                # Affiche chaque message recu sur un topic surveille par le watchdog :
                # valeur brute, doublon detecte ou non, etat gele ou non.
                log.info(f"MQTT recv {topic} -> {reg} val={val} prev={prev_raw} is_dup={is_dup} frozen={frozen}")
                if frozen:
                    # Republication d'une valeur deja jugee figee par le watchdog :
                    # on l'ignore pour ne pas faire remonter le registre au-dessus
                    # de 0 (sinon le registre oscillerait entre 0 et la valeur figee
                    # a chaque republication au lieu de rester proprement a 0).
                    continue
                self._engine.write_register(reg, val)
            except Exception as ex:
                log.debug(f"MQTT write {reg}: {ex}")

    def _watchdog_loop(self):
        """Remet a 0 les registres dont le watchdog est active (stale_timeout>0)
        si la VALEUR n'a pas change depuis ce delai (cf. _on_message : un message
        identique au registre deja ecrit ne compte plus comme "vivant"). Corrige
        le cas ou un topic (ex: Venus OS / pont Node-RED) cesse de refleter la
        realite (reste bloque sur sa derniere valeur, republiee en boucle) au
        lieu d'envoyer explicitement un message a 0 quand la grandeur s'arrete."""
        while True:
            time.sleep(2)
            now = time.time()
            with self._lock:
                watched = [
                    (e["reg_out"], e["stale_timeout"])
                    for entries in self._subs.values()
                    for e in entries
                    if e.get("stale_timeout")
                ]
            for reg, timeout in watched:
                with self._lock:
                    last = self._rf_last_seen.get(reg)
                if last is not None and (now - last) > timeout:
                    try:
                        self._engine.write_register(reg, 0.0)
                    except Exception as ex:
                        log.debug(f"MQTT watchdog write {reg}: {ex}")
                    with self._lock:
                        self._rf_last_seen[reg] = now  # evite de reecrire en boucle
                        self._rf_frozen[reg] = True     # ignore les republications de la valeur figee
                    log.info(f"MQTT watchdog: {reg} valeur figee depuis {timeout:.0f}s -> remis a 0")

    def _resubscribe(self):
        with self._lock:
            topics = list(self._subs.keys())
        for t in topics:
            self._client.subscribe(t, qos=1)
            log.debug(f"MQTT sub: {t}")
