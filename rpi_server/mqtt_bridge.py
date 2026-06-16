#!/usr/bin/env python3
"""
mqtt_bridge.py — Pont MQTT pour RPi-PLC Studio v3.4
Chaque bloc MQTT du programme s'abonne a un topic et ecrit sa valeur dans un RF.
Les blocs MQTT publish ecrivent un RF vers un topic.
"""
import json, threading, logging, time
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
        self._subs   = {}   # topic -> [{"reg_out": "RF300", "type": "float|bool"}]
        self._pubs   = {}   # rf -> {"topic": "...", "retain": bool}
        self._rf_prev= {}   # rf -> derniere valeur publiee (evite doublons)
        self.enabled = self._cfg.get("enabled", False)

    # ── API publique ──────────────────────────────────────────────────────────

    def configure_blocks(self, program: list):
        """Reconstruit les tables sub/pub depuis le programme compile."""
        with self._lock:
            self._subs.clear()
            self._pubs.clear()
            self._rf_prev.clear()
        for blk in program:
            if blk.get("type") != "mqtt":
                continue
            topic = blk.get("topic", "")
            if not topic:
                continue
            reg_out = blk.get("reg_out", "")
            reg_in  = blk.get("reg_in",  "")
            val_type= blk.get("val_type", "float")
            retain  = blk.get("retain", False)
            if reg_out:
                with self._lock:
                    self._subs.setdefault(topic, []).append(
                        {"reg_out": reg_out, "val_type": val_type}
                    )
            if reg_in:
                with self._lock:
                    self._pubs[reg_in] = {"topic": topic, "retain": retain}
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
        else:
            log.warning(f"MQTT connexion refusee rc={rc}")

    def _on_disconnect(self, client, userdata, rc):
        log.warning(f"MQTT deconnecte rc={rc}")

    def _on_message(self, client, userdata, msg):
        topic   = msg.topic
        with self._lock:
            entries = list(self._subs.get(topic, []))
        for e in entries:
            val = _to_float(msg.payload)
            reg = e["reg_out"]
            try:
                self._engine.write_register(reg, val)
            except Exception as ex:
                log.debug(f"MQTT write {reg}: {ex}")

    def _resubscribe(self):
        with self._lock:
            topics = list(self._subs.keys())
        for t in topics:
            self._client.subscribe(t, qos=1)
            log.debug(f"MQTT sub: {t}")
