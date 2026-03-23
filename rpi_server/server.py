#!/usr/bin/env python3
"""
RPi-PLC — Serveur autonome pour Raspberry Pi 3
Licence MIT

Carte E/S : 3× ADS1115 (0x48/0x49/0x4A), 12 sondes PT100 pont div. 10kΩ/3.3V
            10 sorties TOR (relais K1-K10), 8 entrées TOR GPIO

Lancer : python3 server.py [--load programme.json] [--no-web] [--port 5000]
"""

import json, os, sys, time, signal, sqlite3, threading, argparse, logging
from pathlib import Path

# ── Modules optionnels RPi-PLC ────────────────────────────────────────────────
try:
    from telegram_bot       import TelegramBot
    from recipes            import RecipeManager
    from backup_manager     import BackupManager
    from auth               import make_auth_middleware, get_ssl_context
    from calibration        import CalibrationManager
    from report_generator   import generate_html_report, generate_csv_report
    HAS_MODULES = True
except ImportError as _e:
    HAS_MODULES = False
    import logging as _l; _l.getLogger("rpi-plc").debug(f"Modules optionnels : {_e}")
    class TelegramBot:
        def __init__(self,*a,**k): pass
        def start(self): pass
        def stop(self): pass
        def check_alarms(self,*a): pass
    class RecipeManager:
        def __init__(self,*a,**k): self._data={}
        def list_names(self): return []
        def get_all(self): return {}
        def get(self,n): return {}
        def save_recipe(self,*a,**k): return False
        def delete_recipe(self,n): return False
        def apply(self,n,e): return False
        def snapshot_from_engine(self,*a,**k): return False
    class BackupManager:
        def __init__(self,*a,**k): pass
        def list_backups(self): return []
        def save(self,p,l=""): return {}
        def restore(self,i): return None
        def delete(self,i): return False
        def get_path(self,i): return None
        def auto_save_on_deploy(self,p): return {}
    def make_auth_middleware(app, cfg): pass
    def get_ssl_context(base_dir, cfg): return None
    class CalibrationManager:
        def __init__(self,*a,**k): pass
        def get(self,ch): return {"name":ch,"offset":0.0,"gain":1.0,"alarm_high":90.0,"alarm_low":3.0,"enabled":True}
        def get_all(self): return {}
        def set(self,ch,d): return False
        def apply(self,ch,v): return v
        def get_name(self,ch): return ch
        def get_alarms(self,ch): return 90.0, 3.0
    def generate_html_report(db,engine,cal,hours=24): return "<h1>Module non disponible</h1>"
    def generate_csv_report(db,analog,cal,hours=24): return ""

LOG_FILE = "/tmp/rpi-plc.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[logging.FileHandler(LOG_FILE), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("rpi-plc")

BASE_DIR     = Path(os.path.dirname(os.path.abspath(__file__)))
PROGRAM_FILE = BASE_DIR / "programme.json"
CONFIG_FILE  = BASE_DIR / "config.json"
DB_FILE      = BASE_DIR / "history.db"
RECIPES_FILE = BASE_DIR / "recipes.json"
BACKUP_DIR   = BASE_DIR / "backups"

try:
    import RPi.GPIO as GPIO
    import gpiod as _gpiod_mod
    ON_RPI = True
    log.info("Mode MATÉRIEL — RPi.GPIO détecté")
except ImportError:
    ON_RPI = False
    log.info("Mode SIMULATION — RPi.GPIO absent")


# ── Conversion tension → °C (pont diviseur 10kΩ / 3.3V) ─────────────────────
def voltage_to_celsius(vm, probe="PT100", r_ref=10000.0, vcc=3.3):
    """Convertit une tension ADS1115 en température selon le type de sonde.

    Pont diviseur : VCC → R_ref → sonde → GND
    VM = tension au milieu du pont = VCC * Rsonde / (R_ref + Rsonde)

    Sondes supportées :
      PT100, PT1000 : résistance linéaire (α = 0.00385 Ω/Ω/°C)
      NTC10K        : thermistance NTC 10kΩ, équation Steinhart-Hart
                      B = 3950 (valeur courante NTC 10k génériques)
    """
    import math
    if vm <= 0.001 or vm >= vcc - 0.001:
        return float("nan")
    # Résistance de la sonde
    rx = vm * r_ref / (vcc - vm)

    p = probe.upper().replace("-","").replace(" ","")

    if p in ("NTC10K", "NTC", "NTC10"):
        # Équation de Steinhart-Hart simplifiée (Beta)
        # 1/T = 1/T0 + (1/B) * ln(R/R0)
        # T0 = 25°C = 298.15 K, R0 = 10000 Ω, B = 3950 K
        R0 = 10000.0
        T0 = 298.15   # 25°C en Kelvin
        B  = 3950.0   # coefficient Beta NTC 10k (ajustable dans config)
        if rx <= 0:
            return float("nan")
        inv_T = (1.0 / T0) + (1.0 / B) * math.log(rx / R0)
        if inv_T <= 0:
            return float("nan")
        return (1.0 / inv_T) - 273.15

    elif p in ("NTC10K_3977", "NTC3977"):
        R0 = 10000.0; T0 = 298.15; B = 3977.0
        if rx <= 0: return float("nan")
        inv_T = (1.0 / T0) + (1.0 / B) * math.log(rx / R0)
        return (1.0 / inv_T) - 273.15 if inv_T > 0 else float("nan")

    elif p in ("PT1000",):
        r0 = 1000.0
        return (rx - r0) / (r0 * 0.00385)

    else:
        # PT100 par défaut
        r0 = 100.0
        return (rx - r0) / (r0 * 0.00385)


# ════════════════════════════════════════════════════════════════════════════════
class ADS1115Manager:
    REG_CONVERSION = 0x00
    REG_CONFIG     = 0x01
    REG_CONVERSION = 0x00
    MUX_SINGLE     = [0x4000, 0x5000, 0x6000, 0x7000]
    OS_START       = 0x8000
    OS_BUSY        = 0x0000   # bit15=0 → conversion en cours
    OS_READY       = 0x8000   # bit15=1 → conversion terminée
    PGA_4096       = 0x0200
    FSR_4096       = 4.096
    MODE_SS        = 0x0100
    DR_250         = 0x00C0   # 250 SPS → 4ms/conversion (fiable + rapide)
    DR_128         = 0x0080   # 128 SPS → 7.8ms/conversion (plus stable)

    def __init__(self, config):
        self.ads_configs = config.get("analog", {}).get("ads", [])
        self.r_ref       = config.get("analog", {}).get("r_ref_ohm", 10000.0)
        self.vcc         = config.get("analog", {}).get("vcc", 3.3)
        # Taux d'échantillonnage : 250 SPS = bon compromis fiabilité/vitesse
        # 12 canaux × 4ms = 48ms pour un tour complet
        self._data_rate  = self.DR_250
        self._conv_delay = 0.005   # 5ms > 4ms (250 SPS) + marge
        self._bus        = None
        self._lock       = threading.Lock()
        self._sim             = {}
        self._celsius_override = {}   # {ana_id: celsius} — priorité sur tension
        self._available  = False
        self._init()

    def _init(self):
        if not ON_RPI:
            log.info("ADS1115 : mode simulation")
            return
        try:
            import smbus2
            self._bus = smbus2.SMBus(1)
            for ads in self.ads_configs:
                log.info(f"ADS1115 @ {ads['address']} ({ads['id']}) prêt")
            self._available = True
        except ImportError:
            log.warning("smbus2 absent — pip3 install smbus2")
        except Exception as e:
            log.warning(f"ADS1115 init : {e}")

    def _read_channel(self, addr, channel):
        """Lit un canal ADS1115 en mode single-shot avec polling du bit OS.
        
        Séquence correcte :
        1. Écrire config (déclenche la conversion, MUX sélectionne le canal)
        2. Attendre conversion_delay (calculé selon le data rate)
        3. Vérifier bit OS=1 (conversion terminée) avec timeout
        4. Lire le registre de conversion
        """
        cfg = (self.OS_START | self.MUX_SINGLE[channel] |
               self.PGA_4096 | self.MODE_SS | self._data_rate | 0x0003)
        self._bus.write_i2c_block_data(addr, self.REG_CONFIG,
                                       [(cfg >> 8) & 0xFF, cfg & 0xFF])
        
        # Attendre la fin de conversion : polling bit OS (bit 15 du registre config)
        # Timeout = 3× le temps théorique pour éviter le blocage
        t0 = time.monotonic()
        timeout = self._conv_delay * 3
        time.sleep(self._conv_delay)   # attente minimale
        while time.monotonic() - t0 < timeout:
            cfg_r = self._bus.read_i2c_block_data(addr, self.REG_CONFIG, 2)
            status = (cfg_r[0] << 8) | cfg_r[1]
            if status & 0x8000:   # OS=1 → conversion terminée
                break
            time.sleep(0.001)
        
        raw = self._bus.read_i2c_block_data(addr, self.REG_CONVERSION, 2)
        v = (raw[0] << 8) | raw[1]
        if v > 0x7FFF: v -= 0x10000
        return v * self.FSR_4096 / 32768.0

    def read_all(self):
        result = {}
        if not self._available:
            for ads_cfg in self.ads_configs:
                for ch in ads_cfg.get("channels", []):
                    aid = ch["id"]
                    # Priorité : valeur °C forcée directement (panneau simulation)
                    if aid in self._celsius_override:
                        t = self._celsius_override[aid]
                        result[aid] = {"voltage": 0.0,
                                       "celsius": round(t,2),
                                       "name": ch.get("name",aid),
                                       "probe": ch.get("probe","NTC10K"), "sim": True}
                    else:
                        vm  = self._sim.get(aid, 0.55 + (hash(aid) % 10) * 0.015)
                        t   = voltage_to_celsius(vm, ch.get("probe","NTC10K"), self.r_ref, self.vcc)
                        result[aid] = {"voltage": round(vm,4),
                                       "celsius": round(t,2) if t==t else None,
                                       "name": ch.get("name",aid),
                                       "probe": ch.get("probe","NTC10K"), "sim": True}
            return result

        with self._lock:
            for ads_cfg in self.ads_configs:
                addr = int(ads_cfg["address"], 16)
                for i, ch in enumerate(ads_cfg.get("channels", [])):
                    aid = ch["id"]
                    try:
                        vm = self._read_channel(addr, i)
                        t  = voltage_to_celsius(vm, ch.get("probe","NTC10K"), self.r_ref, self.vcc)
                        result[aid] = {"voltage": round(vm,4),
                                       "celsius": round(t,2) if t==t else None,
                                       "name": ch.get("name",aid),
                                       "probe": ch.get("probe","NTC10K"), "sim": False}
                    except Exception as e:
                        result[aid] = {"voltage": None, "celsius": None,
                                       "name": ch.get("name",aid), "error": str(e), "sim": False}
        return result

    def set_sim(self, aid, voltage):
        self._sim[aid] = float(voltage)


# ════════════════════════════════════════════════════════════════════════════════
class HistoryDB:
    RETENTION = 30  # jours

    def __init__(self, path):
        self.path  = path
        self._lock = threading.Lock()
        with sqlite3.connect(self.path) as c:
            c.execute("""CREATE TABLE IF NOT EXISTS history (
                ts INTEGER NOT NULL, channel TEXT NOT NULL,
                voltage REAL, celsius REAL, PRIMARY KEY(ts,channel))""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_ts ON history(ts)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_ch ON history(channel,ts)")
            c.commit()
        log.info(f"Historique : {self.path}")

    def insert(self, readings):
        ts   = int(time.time())
        rows = [(ts, k, v.get("voltage"), v.get("celsius"))
                for k, v in readings.items() if v.get("celsius") is not None]
        if not rows: return
        with self._lock:
            with sqlite3.connect(self.path) as c:
                c.executemany("INSERT OR REPLACE INTO history VALUES(?,?,?,?)", rows)
                c.execute("DELETE FROM history WHERE ts<?", (ts - self.RETENTION*86400,))
                c.commit()

    def get_history(self, channel, hours=24):
        since = int(time.time()) - hours * 3600
        with self._lock:
            with sqlite3.connect(self.path) as c:
                rows = c.execute("SELECT ts,celsius FROM history WHERE channel=? AND ts>=? ORDER BY ts",
                                 (channel, since)).fetchall()
        return [{"ts": r[0], "t": r[1]} for r in rows]

    def get_latest(self):
        with self._lock:
            with sqlite3.connect(self.path) as c:
                rows = c.execute(
                    "SELECT channel,celsius,ts FROM history WHERE ts IN "
                    "(SELECT MAX(ts) FROM history GROUP BY channel)").fetchall()
        return {r[0]: {"celsius": r[1], "ts": r[2]} for r in rows}


# ════════════════════════════════════════════════════════════════════════════════
class PLCEngine:
    def __init__(self, config, ads, db):
        self.config       = config
        self.scan_time_ms = config.get("scan_time_ms", 100)
        self._running     = False
        self._thread      = None
        self._lock        = threading.RLock()
        self._last_scan   = 0.0
        self.ads          = ads
        self.db           = db

        self.gpio = {}
        for ps, pcfg in config.get("gpio", {}).items():
            p = int(ps)
            self.gpio[p] = {"name": pcfg.get("name", f"GPIO{p}"),
                            "mode": pcfg.get("mode", "input"),
                            "value": False, "pull": pcfg.get("pull", "off")}

        self.analog    = {}
        self.registers = {f"RF{i}": 0.0 for i in range(16)}
        self.pids      = {}
        self.memory    = {f"M{i}": False for i in range(32)}
        self.timers    = {}
        self.counters  = {}
        self.av_vars   = {}   # Variables AV nommées — modifiables par l'opérateur
        self.dv_vars   = {}   # Variables DV nommées — modifiables par l'opérateur (bool)
        self.program   = []
        self.cycle_count  = 0
        self.error        = ""
        self.error_count  = 0
        self.on_update    = None
        self._last_ana    = 0.0
        self._last_db     = 0.0

    def init_gpio(self):
        if not ON_RPI: return
        # ── Vérifier que SPI n'est pas actif (causerait des conflits GPIO) ──
        import os as _os
        for boot_conf in ['/boot/firmware/config.txt', '/boot/config.txt']:
            if _os.path.exists(boot_conf):
                txt = open(boot_conf).read()
                if 'dtparam=spi=on' in txt and '#dtparam=spi=on' not in txt:
                    log.warning(
                        "⚠ SPI activé dans config.txt → conflits GPIO possibles ! "
                        "Relancer le déploiement pour le désactiver automatiquement."
                    )
                break
        try:
            import gpiod
            from gpiod.line import Direction, Value, Bias
            cfg_map = {}
            for pin_s, cfg in self.gpio.items():
                pin = int(pin_s)
                if cfg["mode"] == "output":
                    # État initial = relais OFF (sécurité)
                    # active_low=True(défaut) : HIGH=OFF → ACTIVE
                    # active_low=False : LOW=OFF → INACTIVE
                    active_low = cfg.get("active_low", True)
                    init_val = Value.ACTIVE if active_low else Value.INACTIVE
                    cfg_map[pin] = gpiod.LineSettings(
                        direction=Direction.OUTPUT,
                        output_value=init_val)
                else:
                    pull = cfg.get("pull", "off")
                    bias = (Bias.PULL_UP   if pull == "up"   else
                            Bias.PULL_DOWN if pull == "down" else
                            Bias.DISABLED)
                    cfg_map[pin] = gpiod.LineSettings(
                        direction=Direction.INPUT, bias=bias)
            self._gpiod_req = gpiod.request_lines(
                '/dev/gpiochip0', consumer='rpi-plc', config=cfg_map)
            self._use_lgpio = False
            self._use_gpiod = True
            self._gpio_ready = True
            log.info(f"GPIO initialisés via gpiod ({len(cfg_map)} pins)")
            # Test d'écriture sur chaque sortie pour détecter les pins problématiques
            from gpiod.line import Value as _TV
            for _pin, _cfg in self.gpio.items():
                if _cfg["mode"] == "output":
                    try:
                        self._gpiod_req.set_value(_pin, _TV.ACTIVE)  # HIGH = relais OFF
                        log.info(f"  GPIO {_pin} ({_cfg['name']}) : ✓ OK")
                    except Exception as _e:
                        log.error(f"  GPIO {_pin} ({_cfg['name']}) : ✗ ERREUR → {_e}")
            return
        except Exception as e:
            log.error(f"Impossible d'initialiser les GPIO : {e}")
            self._use_lgpio = False
            self._use_gpiod = False

    def cleanup_gpio(self):
        if not ON_RPI: return
        if getattr(self, '_use_gpiod', False):
            try:
                if hasattr(self, '_gpiod_req'):
                    self._gpiod_req.release()
                log.info("GPIO nettoyés (gpiod)")
            except Exception as e:
                log.warning(f"cleanup gpiod : {e}")
            return
        if getattr(self, '_use_lgpio', False):
            try:
                import lgpio as _lg
                h = getattr(self, '_lgpio_handle', None)
                if h is not None:
                    for pin, cfg in self.gpio.items():
                        if cfg["mode"] == "output":
                            try: _lg.gpio_write(h, pin, 0)
                            except: pass
                    _lg.gpiochip_close(h)
                    self._lgpio_handle = None
            except Exception as e:
                log.warning(f"cleanup lgpio : {e}")
        else:
            for pin, cfg in self.gpio.items():
                if cfg["mode"] == "output":
                    try: GPIO.output(pin, GPIO.LOW)
                    except: pass
            try: GPIO.cleanup()
            except: pass
        log.info("GPIO nettoyés")

    def read_signal(self, ref):
        if isinstance(ref, int):
            if ON_RPI and getattr(self, '_gpio_ready', False):
                try:
                    if getattr(self, '_use_gpiod', False):
                        from gpiod.line import Value as GValue
                        with self._lock:
                            v = self._gpiod_req.get_value(ref)
                            # Entrées active-low (pull-up) : INACTIVE(LOW)=fermé=True
                            val = (v == GValue.INACTIVE)
                            if ref in self.gpio:
                                self.gpio[ref]["value"] = val
                        return val
                    elif getattr(self, '_use_lgpio', False):
                        import lgpio as _lg
                        h = getattr(self, '_lgpio_handle', None)
                        if h is not None:
                            return bool(_lg.gpio_read(h, ref))
                except Exception as e:
                    log.debug(f"read_signal {ref}: {e}")
            return self.gpio.get(ref, {}).get("value", False)
        if isinstance(ref, str):
            if ref.startswith("M"):
                return self.memory.get(ref, False)
            if not hasattr(self, 'dv_vars'): self.dv_vars = {}
            if ref in self.dv_vars:
                return bool(self.dv_vars[ref])
        return False

    def write_signal(self, ref, value):
        if not hasattr(self, 'gpio'): return
        # Bit mémoire M* → écrire en mémoire
        if isinstance(ref, str) and ref.startswith("M"):
            with self._lock:
                if not hasattr(self, 'memory'): self.memory = {}
                self.memory[ref] = bool(value)
            return
        # GPIO pin → normaliser en entier
        try:
            pin = int(ref)
        except (TypeError, ValueError):
            return
        if pin not in self.gpio: return
        if self.gpio[pin]["mode"] != "output": return
        with self._lock:
            self.gpio[pin]["value"] = bool(value)
        if ON_RPI and getattr(self, '_gpio_ready', False):
            if getattr(self, '_use_gpiod', False):
                try:
                    from gpiod.line import Value as GValue
                    # Logique configurable par pin : active_low (défaut=True)
                    # active_low=True  : True→INACTIVE(LOW)=relais ON
                    # active_low=False : True→ACTIVE(HIGH)=relais ON
                    active_low = self.gpio[pin].get("active_low", True)
                    if active_low:
                        v = GValue.INACTIVE if value else GValue.ACTIVE
                    else:
                        v = GValue.ACTIVE if value else GValue.INACTIVE
                    with self._lock:
                        self._gpiod_req.set_value(pin, v)
                    log.debug(f"GPIO {pin} ({self.gpio[pin].get('name','?')}) → {'ON' if value else 'OFF'} ({'AL' if active_low else 'AH'})")
                except Exception as e:
                    log.error(f"GPIO {pin} WRITE ERREUR: {e}")
            else:
                try:
                    active_low = self.gpio[pin].get("active_low", True)
                    if active_low:
                        GPIO.output(pin, GPIO.LOW if value else GPIO.HIGH)
                    else:
                        GPIO.output(pin, GPIO.HIGH if value else GPIO.LOW)
                except Exception as e:
                    log.warning(f"GPIO.output pin {pin}: {e}")
        return
        with self._lock:
            if not hasattr(self, 'memory'): self.memory = {}
            self.memory[str(ref)] = bool(value)

    def read_analog(self, ref):
        if not ref: return 0.0
        if ref.startswith("RF"): return self.registers.get(ref, 0.0)
        if ref in self.analog: return self.analog[ref].get("celsius") or 0.0
        # Variable AV nommée (ex: "temp_interieur", "consigne_chauffe")
        if not hasattr(self, 'av_vars'): self.av_vars = {}
        if ref in self.av_vars: return float(self.av_vars[ref])
        return 0.0

    def write_register(self, ref, value):
        if ref and ref.startswith("RF"):
            with self._lock: self.registers[ref] = float(value)

    def set_analog_celsius(self, ref: str, celsius: float):
        """Simulation / forçage : injecter directement une valeur °C dans une sonde analogique."""
        # Stocker dans ADS override pour survivre aux rescans
        if hasattr(self, 'ads') and self.ads:
            self.ads._celsius_override[ref] = float(celsius)
        with self._lock:
            if ref in self.analog:
                self.analog[ref]["celsius"] = round(float(celsius), 2)
            elif ref in self.registers:
                self.registers[ref] = float(celsius)
        # Émettre immédiatement la mise à jour aux clients WebSocket
        if self.on_update:
            try:
                self.on_update(self.snapshot())
            except Exception:
                pass

    def write_av(self, varname: str, value: float):
        """Écrit une variable AV nommée (depuis l'opérateur via synoptique).
        Clé normalisée en minuscules. Écrit aussi directement le GPIO/RF câblé."""
        varname = varname.lower()
        with self._lock:
            self.av_vars[varname] = float(value)
        self._save_av_vars()
        # Écriture directe GPIO ou registre câblé
        try:
            for block in getattr(self, 'program', []):
                if block.get('type') == 'av' and block.get('varname','').lower() == varname:
                    out = block.get('output')
                    if out is not None:
                        self.write_bool_out(out, bool(value))
                    val_out = block.get('val_out')
                    if val_out:
                        self.write_register(val_out, float(value))
        except Exception as e:
            log.debug(f"write_av direct: {e}")

    def write_dv(self, varname: str, value: bool):
        varname = varname.lower()
        """Écrit une variable DV nommée (depuis l'opérateur via synoptique).
        Clé normalisée en minuscules. Écrit aussi directement le GPIO câblé."""
        varname = varname.lower()
        with self._lock:
            self.dv_vars[varname] = bool(value)
        self._save_dv_vars()
        # Écriture directe GPIO — même logique que _on_dv_write sur le PC
        # Parcourt le programme pour trouver les blocs DV câblés à ce varname
        try:
            for block in getattr(self, 'program', []):
                if block.get('type') == 'dv' and block.get('varname','').lower() == varname:
                    out = block.get('output')
                    if out is not None:
                        self.write_bool_out(out, value)
        except Exception as e:
            log.debug(f"write_dv direct GPIO: {e}")

    def _av_vars_path(self):
        import os
        d = os.path.expanduser("~/.rpi-plc-studio")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "av_vars.json")

    def _dv_vars_path(self):
        import os
        d = os.path.expanduser("~/.rpi-plc-studio")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "dv_vars.json")

    def _load_av_vars(self):
        import json, os
        path = self._av_vars_path()
        if os.path.exists(path):
            try:
                data = json.load(open(path))
                with self._lock:
                    self.av_vars = {k: float(v) for k, v in data.items()}
            except Exception as e:
                log.warning(f"[AV] Erreur chargement av_vars : {e}")

    def _load_dv_vars(self):
        """Charge les variables DV depuis le disque.
        Seules les DV marquées "persistent":true dans config.json sont restaurées.
        Les autres (boutons momentary, etc.) démarrent à False (état sûr).
        """
        import json, os
        path = self._dv_vars_path()
        # Liste des DV persistantes (définies dans config.json gpio.dv_persistent)
        persistent_vars = set(
            v.lower() for v in self.config.get("dv_persistent", [])
        )
        if os.path.exists(path):
            try:
                data = json.load(open(path))
                with self._lock:
                    # Ne restaurer que les DV explicitement persistantes
                    # Les boutons momentary et autres démarrent à False
                    if persistent_vars:
                        self.dv_vars = {
                            k: bool(v) for k, v in data.items()
                            if k.lower() in persistent_vars
                        }
                        log.info(f"[DV] {len(self.dv_vars)} variable(s) DV restaurée(s) : {list(self.dv_vars.keys())}")
                    else:
                        # Aucune DV persistante configurée → toutes à False au démarrage
                        self.dv_vars = {}
                        log.info("[DV] Toutes les DV remises à False au démarrage (état sûr)")
            except Exception as e:
                log.warning(f"[DV] Erreur chargement dv_vars : {e}")

    def _save_av_vars(self):
        import json
        try:
            with self._lock:
                data = dict(self.av_vars)
            json.dump(data, open(self._av_vars_path(), 'w'), indent=2)
        except Exception as e:
            log.warning(f"[AV] Erreur sauvegarde av_vars : {e}")

    def _save_dv_vars(self):
        import json
        try:
            with self._lock:
                data = {k: (1 if v else 0) for k, v in self.dv_vars.items()}
            json.dump(data, open(self._dv_vars_path(), 'w'), indent=2)
        except Exception as e:
            log.warning(f"[DV] Erreur sauvegarde dv_vars : {e}")

    def eval_cond(self, cond, default_if_none=True):
        if not cond: return default_if_none
        t = cond.get("type", "input")
        if t == "input":
            v = self.read_signal(cond.get("ref"))
            return not v if cond.get("negate") else v
        if t == "and":  return all(self.eval_cond(c) for c in cond.get("conditions", []))
        if t == "or":   return any(self.eval_cond(c) for c in cond.get("conditions", []))
        if t == "not":  return not self.eval_cond(cond.get("condition", {}))
        if t == "timer_done":   return self.timers.get(cond["id"], {}).get("done", False)
        if t == "counter_done": return self.counters.get(cond["id"], {}).get("done", False)
        # Conditions analogiques simples (PC-style)
        if t == "analog_gt": return self.read_analog(cond["ref"]) > cond.get("threshold", 0)
        if t == "analog_lt": return self.read_analog(cond["ref"]) < cond.get("threshold", 0)
        if t == "analog_ge": return self.read_analog(cond["ref"]) >= cond.get("threshold", 0)
        if t == "analog_le": return self.read_analog(cond["ref"]) <= cond.get("threshold", 0)
        if t == "analog_eq": return abs(self.read_analog(cond["ref"]) - cond.get("threshold", 0)) < 0.5
        if t == "compare_f":
            val  = self.read_analog(cond.get("ref", "ANA0"))
            thr  = float(cond.get("threshold", 0.0))
            hyst = float(cond.get("hysteresis", 0.0))
            op   = cond.get("op", "gt")
            cid  = f"_cmp_{cond.get('id','anon')}"
            prev = self.timers.get(cid, {}).get("s", False)
            if op == "gt":
                state = True if val > thr+hyst else (False if val < thr-hyst else prev)
            elif op == "lt":
                state = True if val < thr-hyst else (False if val > thr+hyst else prev)
            else:
                state = abs(val - thr) <= hyst
            self.timers.setdefault(cid, {})["s"] = state
            return state
        return False

    def write_bool_out(self, ref, value: bool):
        """Écrit une sortie booléenne : GPIO int, bit M*, ou variable DV nommée."""
        if ref is None:
            return
        if isinstance(ref, int) or (isinstance(ref, str) and ref.startswith("M")):
            self.write_signal(ref, value)
        elif isinstance(ref, str) and ref:
            # Variable DV nommée → dv_vars
            if not hasattr(self, 'dv_vars'): self.dv_vars = {}
            with self._lock: self.dv_vars[ref] = bool(value)

    def exec_block(self, block, dt_ms):
        btype = block.get("type"); bid = block.get("id","?"); out = block.get("output")

        if btype in ("coil","set","reset"):
            cond = self.eval_cond(block.get("condition"))
            if btype == "coil":            self.write_bool_out(out, cond)
            elif btype == "set"   and cond: self.write_bool_out(out, True)
            elif btype == "reset" and cond: self.write_bool_out(out, False)

        elif btype == "timer":
            preset = block.get("preset_ms", 1000)
            cond   = self.eval_cond(block.get("condition"))
            if bid not in self.timers:
                self.timers[bid] = {"preset": preset, "acc": 0.0, "running": False, "done": False}
            t = self.timers[bid]
            if cond:
                t["running"] = True; t["acc"] = min(t["acc"]+dt_ms, preset); t["done"] = t["acc"] >= preset
            else:
                t["running"] = False; t["acc"] = 0.0; t["done"] = False
            if out: self.write_signal(out, t["done"])

        elif btype == "counter":
            preset = block.get("preset", 10)
            cond   = self.eval_cond(block.get("condition"))
            rst    = self.eval_cond(block.get("reset_condition")) if block.get("reset_condition") else False
            if bid not in self.counters:
                self.counters[bid] = {"preset": preset, "acc": 0, "done": False, "_prev": False}
            c = self.counters[bid]
            if rst: c["acc"] = 0; c["done"] = False
            elif cond and not c["_prev"]: c["acc"] += 1; c["done"] = c["acc"] >= preset
            c["_prev"] = cond
            if out: self.write_signal(out, c["done"])

        elif btype == "scale":
            src = self.read_analog(block.get("input","ANA0"))
            il, ih = float(block.get("in_lo",0)), float(block.get("in_hi",100))
            ol, oh = float(block.get("out_lo",0)), float(block.get("out_hi",100))
            span = ih - il
            scaled = ol + (src - il) / span * (oh - ol) if abs(span) > 1e-9 else ol
            if out: self.write_register(out, scaled)

        elif btype == "pid":
            pv = self.read_analog(block.get("pv","ANA0"))
            sp = float(block.get("sp", 0.0))
            if sp == 0.0 and block.get("sp_ref","").startswith("RF"):
                sp = self.read_analog(block["sp_ref"])
            if bid not in self.pids: self.pids[bid] = {"integral": 0.0, "prev_err": 0.0}
            kp,ki,kd = float(block.get("kp",1)), float(block.get("ki",0)), float(block.get("kd",0))
            omin,omax = float(block.get("out_min",0)), float(block.get("out_max",100))
            dt = max(dt_ms / 1000.0, 0.001)
            err = sp - pv; pid = self.pids[bid]
            pid["integral"] = max(omin, min(omax, pid["integral"] + ki * err * dt))
            deriv = kd * (err - pid["prev_err"]) / dt
            pid["prev_err"] = err
            result = max(omin, min(omax, kp*err + pid["integral"] + deriv))
            if out: self.write_register(out, result)

        elif btype == "move":
            if self.eval_cond(block.get("condition")) and out:
                self.write_register(out, float(block.get("value", 0.0)))

        # ── Blocs logique ──────────────────────────────────────────────────
        elif btype in ("and", "or", "not", "xor", "inv"):
            def _gs(r):
                if r is None: return False
                if isinstance(r, int): return self.read_signal(r)
                if isinstance(r, str) and r.startswith("M"): return self.read_signal(r)
                return bool(r)
            i1 = _gs(block.get("in1") or block.get("input1"))
            i2 = _gs(block.get("in2") or block.get("input2"))
            if   btype == "and":             res = i1 and i2
            elif btype == "or":              res = i1 or  i2
            elif btype in ("not", "inv"):    res = not _gs(block.get("in") or block.get("in1"))
            elif btype == "xor":             res = i1 ^ i2
            else:                            res = False
            if out: self.write_signal(out, res)

        elif btype in ("sr", "sr_r"):
            s   = self.eval_cond(block.get("set_cond") or block.get("s_cond"))
            r   = self.eval_cond(block.get("res_cond") or block.get("r_cond"))
            bit = block.get("bit", "M0")
            if r:    self.memory[bit] = False
            elif s:  self.memory[bit] = True
            if out: self.write_signal(out, self.memory.get(bit, False))

        elif btype == "sr_s":
            # SR_S : Set prioritaire (S > R)
            s   = self.eval_cond(block.get("set_cond"), default_if_none=False)
            r   = self.eval_cond(block.get("res_cond"), default_if_none=False)
            bit = block.get("bit", "M1")
            if bit not in self.memory: self.memory[bit] = False
            if s:    self.memory[bit] = True   # Set prioritaire
            elif r:  self.memory[bit] = False
            if out: self.write_signal(out, self.memory.get(bit, False))

        elif btype == "rs":
            s   = self.eval_cond(block.get("set_cond"))
            r   = self.eval_cond(block.get("res_cond"))
            bit = block.get("bit", "M0")
            if s:    self.memory[bit] = True
            elif r:  self.memory[bit] = False
            if out: self.write_signal(out, self.memory.get(bit, False))

        # ── Blocs temporisation avancés ──────────────────────────────────
        elif btype in ("ton", "tof", "tp"):
            preset = float(block.get("preset_ms", 1000))
            cond   = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"acc": 0.0, "done": False, "q": False, "_prev": False}
            t = self.timers[bid]
            if btype == "ton":
                if cond: t["acc"] = min(t["acc"] + dt_ms, preset); t["done"] = t["acc"] >= preset
                else:    t["acc"] = 0.0; t["done"] = False
                t["q"] = t["done"]
            elif btype == "tof":
                # TOF : sortie active tant que IN=1 puis pendant le délai
                if cond:
                    t["acc"]  = 0
                    t["done"] = True   # sortie active immédiatement
                else:
                    t["acc"]  = min(t["acc"] + dt_ms, preset)
                    t["done"] = t["acc"] < preset  # reste actif pendant le délai
                t["_prev"] = cond
            elif btype == "tp":
                # TP : impulsion à durée fixe, non retriggerable
                if cond and not t["_prev"] and not t.get("active", False):
                    t["active"] = True; t["acc"] = 0
                if t.get("active", False):
                    t["acc"] += dt_ms
                    if t["acc"] >= preset: t["active"] = False
                t["_prev"] = cond
            if out: self.write_signal(out, t.get("active", False))

        elif btype == "wait":
            delay_ms = float(block.get("delay_s", 5)) * 1000.0
            cond = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"acc": 0.0, "done": False}
            t = self.timers[bid]
            if cond: t["acc"] = min(t["acc"] + dt_ms, delay_ms); t["done"] = t["acc"] >= delay_ms
            else:    t["acc"] = 0.0; t["done"] = False
            if out: self.write_signal(out, t["done"])

        elif btype == "waith":
            delay_ms = float(block.get("delay_s", 5)) * 1000.0
            cond = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"acc": 0.0, "sts": False}
            t = self.timers[bid]
            if cond:   t["sts"] = True; t["acc"] = 0.0
            elif t["sts"]:
                t["acc"] = min(t["acc"] + dt_ms, delay_ms)
                if t["acc"] >= delay_ms: t["sts"] = False
            if out: self.write_signal(out, t["sts"])

        elif btype == "pulse":
            dur_ms = float(block.get("duration_s", 3)) * 1000.0
            cond   = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"acc": 0.0, "active": False, "_prev": False}
            t = self.timers[bid]
            if cond and not t["_prev"]: t["active"] = True; t["acc"] = 0.0
            if t["active"]:
                t["acc"] += dt_ms
                if t["acc"] >= dur_ms: t["active"] = False
            t["_prev"] = cond
            if out: self.write_signal(out, t["active"])

        # ── Compteurs avancés ─────────────────────────────────────────────
        elif btype in ("ctu", "ctd", "ctud"):
            if bid not in self.counters:
                self.counters[bid] = {"acc": 0, "done": False, "_cu": False, "_cd": False}
            c      = self.counters[bid]
            preset = int(block.get("preset", 10))
            cu     = self.eval_cond(block.get("cu") or block.get("condition"))
            cd     = self.eval_cond(block.get("cd")) if btype == "ctud" else False
            rst    = self.eval_cond(block.get("r") or block.get("reset_condition"))                      if (block.get("r") or block.get("reset_condition")) else False
            ld     = self.eval_cond(block.get("ld")) if block.get("ld") else False
            if rst:                         c["acc"] = 0; c["done"] = False
            elif ld:                        c["acc"] = preset
            elif cu and not c["_cu"]:       c["acc"] = min(c["acc"] + 1, preset + 1)
            elif cd and not c["_cd"]:       c["acc"] = max(c["acc"] - 1, 0)
            c["done"] = c["acc"] >= preset
            c["_cu"] = cu; c["_cd"] = cd
            if out: self.write_signal(out, c["done"])

        # ── Blocs analogiques ─────────────────────────────────────────────
        elif btype == "sensor":
            ref  = block.get("ref", "ANA0")
            corr = float(block.get("correction", 0.0))
            val  = self.read_analog(ref) + corr
            dst  = block.get("reg_out", out)
            if dst: self.write_register(dst, val)

        elif btype in ("add", "sub", "mul", "div"):
            a   = self.registers.get(block.get("reg_a", "RF0"), 0.0)
            b_v = self.registers.get(block.get("reg_b", "RF1"), 0.0)
            if   btype == "add": res = a + b_v
            elif btype == "sub": res = a - b_v
            elif btype == "mul": res = a * b_v
            else:                res = a / b_v if abs(b_v) > 1e-12 else 0.0
            dst = block.get("reg_out", out)
            if dst: self.write_register(dst, res)

        elif btype == "mux":
            idx_ref = block.get("idx_ref", "M0")
            idx     = int(self.memory.get(idx_ref, 0)) if isinstance(idx_ref,str) and idx_ref.startswith("M") else 0
            in_keys = [block.get(f"in{i}", f"RF{i}") for i in range(4)]
            val     = self.registers.get(in_keys[max(0,min(3,idx))], 0.0)
            dst     = block.get("reg_out", out)
            if dst: self.write_register(dst, val)

        elif btype == "comph":
            val = self.registers.get(block.get("ref","RF0"), 0.0)
            thr = float(block.get("high", 80.0))
            reg = block.get("reg_out", "M0")
            if reg.startswith("M"):
                with self._lock: self.memory[reg] = val >= thr

        elif btype == "compl":
            val = self.registers.get(block.get("ref","RF0"), 0.0)
            thr = float(block.get("low", 10.0))
            reg = block.get("reg_out", "M1")
            if reg.startswith("M"):
                with self._lock: self.memory[reg] = val <= thr

        elif btype in ("gt", "ge", "lt", "eq", "ne", "compare"):
            def _rv(r):
                if isinstance(r, str) and (r.startswith("RF") or r.startswith("ANA")):
                    return self.read_analog(r)
                return float(self.read_signal(r)) if r else 0.0
            a  = _rv(block.get("ref_a") or block.get("in1"))
            br = block.get("ref_b") or block.get("in2")
            b  = _rv(br) if br else float(block.get("val_b", 0))
            op = block.get("op", btype)
            r  = {"gt":a>b,"ge":a>=b,"lt":a<b,"eq":abs(a-b)<1e-9,
                  "ne":abs(a-b)>=1e-9,"compare":a==b}.get(op, False)
            if out: self.write_signal(out, r)

        # ── Actionneurs ───────────────────────────────────────────────────
        elif btype == "contactor":
            cond = self.eval_cond(block.get("condition") or block.get("on"))
            pin  = block.get("pin")
            if pin is not None: self.write_signal(int(pin), cond)

        elif btype == "valve3v":
            cond_inc = self.eval_cond(block.get("cond_inc") or block.get("oinc"), default_if_none=False)
            cond_dec = self.eval_cond(block.get("cond_dec") or block.get("odec"), default_if_none=False)
            pin_inc  = block.get("pin_inc")
            pin_dec  = block.get("pin_dec")
            if pin_inc: self.write_signal(int(pin_inc), cond_inc)
            if pin_dec: self.write_signal(int(pin_dec), cond_dec)
            # Propager les sorties logiques Q_OUV / Q_FER
            out_inc = block.get("out_inc")
            out_dec = block.get("out_dec")
            if out_inc is not None: self.write_signal(out_inc, cond_inc)
            if out_dec is not None: self.write_signal(out_dec, cond_dec)

        # ── Compteur temps de marche ──────────────────────────────────────
        elif btype == "runtimcnt":
            cond = self.eval_cond(block.get("condition") or block.get("run"))
            rst  = self.eval_cond(block.get("reset_condition"), default_if_none=False)
            if bid not in self.pids:
                if not hasattr(self, 'av_vars'): self.av_vars = {}
                self.pids[bid] = {
                    "starts":  float(self.av_vars.get(f"_cnt_{bid}_starts", 0)),
                    "total":   float(self.av_vars.get(f"_cnt_{bid}_total",  0.0)),
                    "runtime": 0.0, "_prev": False}
            c = self.pids[bid]
            if rst:
                c["starts"] = 0; c["total"] = 0.0; c["runtime"] = 0.0; c["_prev"] = False
                with self._lock:
                    self.av_vars[f"_cnt_{bid}_starts"] = 0
                    self.av_vars[f"_cnt_{bid}_total"]  = 0.0
            else:
                if cond and not c["_prev"]:
                    c["starts"] += 1
                    with self._lock: self.av_vars[f"_cnt_{bid}_starts"] = c["starts"]
                if cond:
                    c["runtime"] += dt_ms / 1000.0; c["total"] += dt_ms / 1000.0
                    if int(c["total"]) % 10 == 0:
                        with self._lock: self.av_vars[f"_cnt_{bid}_total"] = c["total"]
                else: c["runtime"] = 0.0
            c["_prev"] = cond
            if block.get("reg_starts"):  self.write_register(block["reg_starts"], float(c["starts"]))
            if block.get("reg_total"):   self.write_register(block["reg_total"],  c["total"] / 3600.0)
            if block.get("reg_runtime"): self.write_register(block["reg_runtime"], c["runtime"])
        # ── Horloge locale ────────────────────────────────────────────────


        # ════════════════════════════════════════════════════════════════
        # ── PLANCHER CHAUFFANT — PID amb + sonde départ + retour ──────
        # ════════════════════════════════════════════════════════════════
        if btype == "plancher":
            pv_ref_amb    = block.get("pv_ref_amb", "RF0")
            pv_ref_depart = block.get("pv_ref_depart", "")
            pv_ref_retour = block.get("pv_ref_retour", "")
            sp_ref        = block.get("sp_ref")         # consigne dynamique (port SP câblé)
            sp_fixed      = float(block.get("sp", 20.0))
            en_cond       = block.get("en_cond")        # port EN (enable)
            max_depart    = float(block.get("max_depart", 45.0))
            min_delta     = float(block.get("min_delta", 3.0))
            dead_band     = float(block.get("dead_band", 0.5))
            kp            = float(block.get("kp", 2.0))
            ki            = float(block.get("ki", 0.1))
            kd            = float(block.get("kd", 0.5))
            # Sorties V3V motorisée + circulateur
            out_v3v_ouv   = block.get("out_v3v_ouv", block.get("out_vanne", "k7"))
            out_v3v_fer   = block.get("out_v3v_fer", "k8")
            out_circ      = block.get("out_circ",    block.get("out_pompe", "k9"))
            reg_out       = block.get("reg_out",    "RF2")
            reg_depart    = block.get("reg_depart",  "RF0")
            reg_retour    = block.get("reg_retour",  "RF5")
            reg_delta     = block.get("reg_delta",   "RF15")
            min_temp      = float(block.get("min_temp", 5.0))
            max_temp      = float(block.get("max_temp", 35.0))

            # ── Consigne : port SP câblé ou valeur fixe ───────────────
            sp = self.read_analog(sp_ref) if sp_ref else sp_fixed

            # ── Port EN : si câblé et False → tout OFF ────────────────
            if en_cond is not None and not self.eval_cond(en_cond):
                self.write_dv(out_v3v_ouv, False)
                self.write_dv(out_v3v_fer, False)
                self.write_dv(out_circ,    False)
                return f"PLANCHER {block.get('name','?')}: EN=0 → OFF"

            # ── Lecture des 3 sondes ──────────────────────────────────
            t_amb    = self.read_analog(pv_ref_amb)
            t_depart = self.read_analog(pv_ref_depart) if pv_ref_depart else None
            t_retour = self.read_analog(pv_ref_retour) if pv_ref_retour else None

            # ── Registres diagnostic ──────────────────────────────────
            if t_depart is not None: self.write_register(reg_depart, t_depart)
            if t_retour is not None: self.write_register(reg_retour, t_retour)
            delta = (t_depart - t_retour) if (t_depart is not None and t_retour is not None) else None
            if delta is not None: self.write_register(reg_delta, delta)

            # ── Sécurités ─────────────────────────────────────────────
            if t_amb < min_temp:
                # Protection gel : ouvrir V3V + forcer circulateur
                self.write_dv(out_v3v_ouv, True)
                self.write_dv(out_v3v_fer, False)
                self.write_dv(out_circ,    True)
                return f"PLANCHER GEL: Tamb={t_amb:.1f}°C < {min_temp}°C → PROTECTION"

            if t_amb > max_temp:
                self.write_dv(out_v3v_ouv, False)
                self.write_dv(out_v3v_fer, True)   # fermer V3V
                self.write_dv(out_circ,    False)
                return f"PLANCHER ALM: Tamb={t_amb:.1f}°C > {max_temp}°C"

            if t_depart is not None and t_depart > max_depart:
                self.write_dv(out_v3v_ouv, False)
                self.write_dv(out_v3v_fer, True)   # fermer V3V urgence
                self.write_dv(out_circ,    True)   # circulateur reste ON pour refroidir
                return f"PLANCHER DEP ALM: Tdep={t_depart:.1f}°C > {max_depart}°C"

            # ── PID sur température ambiante ──────────────────────────
            if not hasattr(self, '_plancher_state'): self._plancher_state = {}
            st = self._plancher_state.setdefault(bid, {"integral": 0.0, "prev_err": 0.0})

            error  = sp - t_amb
            active = error > dead_band

            if active:
                st["integral"] = max(-100.0, min(100.0,
                    st["integral"] + ki * error * (dt_ms / 1000.0)))
                derivative = kd * (error - st["prev_err"]) / max(0.001, dt_ms / 1000.0)
                pid_out = kp * error + st["integral"] + derivative
                pid_out = max(0.0, min(100.0, pid_out))
            else:
                pid_out = 0.0
                st["integral"] = max(0.0, st["integral"])
            st["prev_err"] = error
            self.write_register(reg_out, pid_out)

            # ── Commandes V3V motorisée + circulateur ─────────────────
            # V3V_OUV = ouvre (chauffage actif), V3V_FER = ferme (pas de chauffage)
            # Les deux ne sont JAMAIS actifs simultanément
            self.write_dv(out_v3v_ouv, active)
            self.write_dv(out_v3v_fer, not active)
            self.write_dv(out_circ,    active)   # circulateur ON uniquement si chauffe

            circ_ok = not (delta is not None and active and abs(delta) < min_delta)
            dep_str = f" Tdep={t_depart:.1f}°C" if t_depart is not None else ""
            ret_str = f" Tret={t_retour:.1f}°C" if t_retour is not None else ""
            dlt_str = f" Δ={delta:.1f}°C{'⚠' if not circ_ok else ''}" if delta is not None else ""
            return (f"PLANCHER {block.get('name','?')}: "
                    f"Tamb={t_amb:.1f}°C SP={sp:.1f}°C PID={pid_out:.0f}%"
                    f"{dep_str}{ret_str}{dlt_str} {'ON' if active else 'OFF'}")


        
        # ════════════════════════════════════════════════════════════════
        # ── SOLAIRE THERMIQUE — ΔT capteur/ballon, vanne directionnelle
        # ════════════════════════════════════════════════════════════════
        if btype == "solar":
            pv_ref_capt  = block.get("pv_ref_capteur", "RF0")
            pv_ref_ecs   = block.get("pv_ref_ecs",   "RF3")
            pv_ref_chauf = block.get("pv_ref_chauf",  "")
            delta_on     = float(block.get("delta_on",  8.0))
            delta_off    = float(block.get("delta_off", 3.0))
            sp_ecs       = float(block.get("sp_ecs",   60.0))
            sp_chauf     = float(block.get("sp_chauf", 50.0))
            max_capt     = float(block.get("max_capteur", 120.0))
            min_capt     = float(block.get("min_capteur",   5.0))
            out_pompe    = block.get("out_pompe",      "k1")
            out_v_ecs    = block.get("out_vanne_ecs",  "k2")
            out_v_chauf  = block.get("out_vanne_chauf","k3")
            reg_delta    = block.get("reg_delta",      "RF12")
            reg_rend     = block.get("reg_rendement",  "RF13")

            # ── Lecture sondes ────────────────────────────────────────
            t_capt  = self.read_analog(pv_ref_capt)
            t_ecs   = self.read_analog(pv_ref_ecs)
            t_chauf = self.read_analog(pv_ref_chauf) if pv_ref_chauf else None

            # ── ΔT capteur − ballon ECS ───────────────────────────────
            delta = t_capt - t_ecs
            self.write_register(reg_delta, round(delta, 2))

            # Rendement estimé (0-100%) basé sur ΔT / delta_on*3
            rendement = min(100.0, max(0.0, (delta / max(0.1, delta_on * 3)) * 100))
            self.write_register(reg_rend, round(rendement, 1))

            # ── Sécurités ─────────────────────────────────────────────
            # Surchauffe capteur (stagnation) → tout OFF
            if t_capt >= max_capt:
                self.write_dv(out_pompe,   False)
                self.write_dv(out_v_ecs,   False)
                self.write_dv(out_v_chauf, False)
                return f"SOLAR ALM SURCHAUFFE: T_capt={t_capt:.1f}°C ≥ {max_capt}°C"

            # ── Protection gel capteur ───────────────────────────────
            if t_capt < min_capt:
                antigel_mode = block.get("antigel_mode", "off")
                ag_temp_src  = float(block.get("antigel_temp_source", 30.0))

                # Couper le circuit solaire (pompe + vanne ECS) dans tous les cas
                self.write_dv(out_v_ecs, False)

                if antigel_mode != "off":
                    # Source : chaudière (pv_ref_chauf) ou ballon ECS
                    if antigel_mode == "chaudiere" and block.get("pv_ref_chauf"):
                        src_ref = block["pv_ref_chauf"]
                    else:
                        src_ref = block.get("pv_ref_ecs", "RF3")
                    t_source = self.read_analog(src_ref) if src_ref else 0.0

                    if t_source >= ag_temp_src:
                        # Ouvrir vanne chauffage + pompe solaire
                        # → eau chaude chaudière/ECS circule dans les capteurs
                        self.write_dv(out_v_chauf, True)
                        self.write_dv(out_pompe,   True)
                        return (f"SOLAR ANTIGEL: T_capt={t_capt:.1f}°C "
                                f"T_src={t_source:.1f}°C [{antigel_mode.upper()}]"
                                f" → vanne chauf OUVERTE + pompe ON")
                    else:
                        # Source pas assez chaude → tout OFF
                        self.write_dv(out_v_chauf, False)
                        self.write_dv(out_pompe,   False)
                        return (f"SOLAR ANTIGEL ATTENTE: T_capt={t_capt:.1f}°C "
                                f"T_src={t_source:.1f}°C < {ag_temp_src}°C")
                else:
                    # Mode off → tout couper
                    self.write_dv(out_v_chauf, False)
                    self.write_dv(out_pompe,   False)
                    return f"SOLAR GEL: T_capt={t_capt:.1f}°C < {min_capt}°C → tout OFF"

            # ── État pompe (hystérésis ΔT) ───────────────────────────
            if not hasattr(self, '_solar_state'): self._solar_state = {}
            st = self._solar_state.setdefault(bid, {"pompe": False, "mode": "ecs"})

            if st["pompe"]:
                # Arrêt si ΔT trop faible
                if delta < delta_off:
                    st["pompe"] = False
            else:
                # Démarrage si ΔT suffisant
                if delta >= delta_on:
                    st["pompe"] = True

            # ── Sélection destination (vanne directionnelle) ──────────
            # Priorité ECS : si ECS non atteinte → solaire vers ECS
            # Si ECS atteinte ET ballon chauffage non atteint → solaire vers chauffage
            ecs_ok   = t_ecs  >= sp_ecs
            chauf_ok = (t_chauf >= sp_chauf) if t_chauf is not None else True

            if st["pompe"]:
                if not ecs_ok:
                    # Priorité ECS
                    st["mode"] = "ecs"
                    self.write_dv(out_v_ecs,   True)
                    self.write_dv(out_v_chauf, False)
                elif t_chauf is not None and not chauf_ok:
                    # ECS ok → chauffage
                    st["mode"] = "chauf"
                    self.write_dv(out_v_ecs,   False)
                    self.write_dv(out_v_chauf, True)
                else:
                    # Tout ok → arrêter pompe (pas besoin)
                    st["pompe"] = False
                    self.write_dv(out_v_ecs,   False)
                    self.write_dv(out_v_chauf, False)
            else:
                self.write_dv(out_v_ecs,   False)
                self.write_dv(out_v_chauf, False)

            # ── Commande pompe : TOR ou analogique 0-10V ─────────────
            pump_mode      = block.get("pump_mode", "on_off")
            out_pompe_av   = block.get("out_pompe_av",   "")
            pump_min_pct   = float(block.get("pump_min_pct",   10.0))
            pump_delta_max = float(block.get("pump_delta_max", 30.0))
            reg_vitesse    = block.get("reg_vitesse_pompe", "RF14")

            if st["pompe"]:
                if pump_mode == "analog_0_10" and out_pompe_av:
                    # Vitesse proportionnelle au ΔT
                    # ΔT_on → pump_min_pct%  /  ΔT_max → 100%
                    delta_range = max(0.1, pump_delta_max - delta_on)
                    pct = pump_min_pct + (delta - delta_on) / delta_range * (100 - pump_min_pct)
                    pct = max(pump_min_pct, min(100.0, pct))
                    # Convertir % → volts 0-10V
                    volts = pct / 10.0
                    self.write_av(out_pompe_av, volts)
                    self.write_register(reg_vitesse, round(pct, 1))
                    # DV pompe aussi ON pour signaler l'état
                    if out_pompe: self.write_dv(out_pompe, True)
                else:
                    # Tout ou rien
                    if out_pompe: self.write_dv(out_pompe, True)
                    self.write_register(reg_vitesse, 100.0)
            else:
                if pump_mode == "analog_0_10" and out_pompe_av:
                    self.write_av(out_pompe_av, 0.0)
                if out_pompe: self.write_dv(out_pompe, False)
                self.write_register(reg_vitesse, 0.0)

            chauf_str  = f" T_chauf={t_chauf:.1f}°C" if t_chauf is not None else ""
            vit_str    = f" pompe={self.registers.get(reg_vitesse,0):.0f}%"
            mode_str   = f"→{st['mode'].upper()}" if st["pompe"] else "OFF"
            return (f"SOLAR {block.get('name','?')}: "
                    f"T_capt={t_capt:.1f}°C T_ecs={t_ecs:.1f}°C"
                    f"{chauf_str} ΔT={delta:.1f}°C{vit_str} {mode_str}")


        # ════════════════════════════════════════════════════════════════
        # ── CHAUDIÈRE — Régulation avec anti-cyclage ──────────────────
        # ════════════════════════════════════════════════════════════════
        if btype == "chaudiere":
            pv_ref_r  = block.get("pv_ref_retour", "RF1")
            pv_ref_d  = block.get("pv_ref_depart", "RF2")
            sp        = float(block.get("sp", 65.0))
            hyst      = float(block.get("hysteresis", 3.0))
            min_on    = float(block.get("min_on_s", 60)) * 1000.0
            min_off   = float(block.get("min_off_s", 30)) * 1000.0
            max_dep   = float(block.get("max_depart", 90.0))
            out_br    = block.get("out_brulee", "k3")
            out_pm    = block.get("out_pompe", "k4")

            t_dep = self.read_analog(pv_ref_d)
            t_ret = self.read_analog(pv_ref_r)

            if not hasattr(self, '_chaud_state'): self._chaud_state = {}
            st = self._chaud_state.setdefault(bid, {"on":False,"timer":0.0})

            # Sécurité max départ
            if t_dep >= max_dep:
                self.write_dv(out_br, False)
                self.write_dv(out_pm, True)  # pompe reste active
                return f"CHAUD ALM: T_dep={t_dep:.1f}°C ≥ {max_dep}°C"

            currently_on = st["on"]
            st["timer"] += dt_ms

            if currently_on:
                # Éteindre si T_départ ≥ SP + hystérésis ET temps min écoulé
                if t_dep >= sp + hyst and st["timer"] >= min_on:
                    st["on"] = False; st["timer"] = 0.0
            else:
                # Allumer si T_départ < SP - hystérésis ET temps min off écoulé
                if t_dep < sp - hyst and st["timer"] >= min_off:
                    st["on"] = True; st["timer"] = 0.0

            self.write_dv(out_br, st["on"])
            self.write_dv(out_pm, st["on"])
            return f"CHAUD {block.get('name','?')}: T_dep={t_dep:.1f}°C T_ret={t_ret:.1f}°C {'ON' if st['on'] else 'OFF'}"

        # ════════════════════════════════════════════════════════════════
        # ── ZONE DE CHAUFFAGE — Vanne motorisée + hystérésis ─────────
        # ════════════════════════════════════════════════════════════════
        if btype == "zone_chauf":
            pv_ref  = block.get("pv_ref", "RF0")
            sp      = float(block.get("sp", 20.0))
            hyst    = float(block.get("hysteresis", 0.5))
            out_v   = block.get("out_vanne", "k5")
            dly_o   = float(block.get("delay_open_s", 120)) * 1000.0
            dly_c   = float(block.get("delay_close_s", 120)) * 1000.0

            pv = self.read_analog(pv_ref)
            if not hasattr(self, '_zone_state'): self._zone_state = {}
            st = self._zone_state.setdefault(bid, {"open":False,"timer":0.0})

            currently_open = st["open"]
            st["timer"] += dt_ms

            if currently_open:
                if pv >= sp + hyst and st["timer"] >= dly_o:
                    st["open"] = False; st["timer"] = 0.0
            else:
                if pv < sp - hyst and st["timer"] >= dly_c:
                    st["open"] = True; st["timer"] = 0.0

            self.write_dv(out_v, st["open"])
            return f"ZONE {block.get('name','?')}: T={pv:.1f}°C SP={sp} vanne={'OUV' if st['open'] else 'FER'}"

        # ════════════════════════════════════════════════════════════════
        # ── ECS — Préparation eau chaude + anti-légionellose ──────────
        # ════════════════════════════════════════════════════════════════
        if btype == "ecs_bloc":
            import datetime as _dt
            pv_ecs  = self.read_analog(block.get("pv_ref_ecs", "RF3"))
            pv_prim = self.read_analog(block.get("pv_ref_prim", "RF4"))
            sp_ecs  = float(block.get("sp_ecs", 55.0))
            sp_al   = float(block.get("sp_antileg", 65.0))
            al_day  = int(block.get("antileg_day", 0))
            al_hour = int(block.get("antileg_hour", 3))
            hyst    = float(block.get("hysteresis", 2.0))
            out_pm  = block.get("out_pompe", "k6")

            now = _dt.datetime.now()
            antileg_active = (now.weekday() == al_day and now.hour == al_hour)
            sp = sp_al if antileg_active else sp_ecs

            # Pompe active si besoin de chauffe ET primaire plus chaud
            need_heat = pv_ecs < sp - hyst
            prim_ok   = pv_prim > pv_ecs + 3.0
            pump_on   = need_heat and prim_ok

            if not hasattr(self, '_ecs_state'): self._ecs_state = {}
            st = self._ecs_state.setdefault(bid, {"on": False})
            # Hystérésis sur la pompe
            if st["on"] and pv_ecs >= sp + hyst:
                st["on"] = False
            elif not st["on"] and pump_on:
                st["on"] = True

            self.write_dv(out_pm, st["on"])
            mode = "ANTILEG" if antileg_active else "NORMAL"
            return f"ECS {block.get('name','?')}: T={pv_ecs:.1f}°C SP={sp:.0f}°C [{mode}] pompe={'ON' if st['on'] else 'OFF'}"

        elif btype == "localtime":
            import datetime as _dt
            now_dt = _dt.datetime.now()
            self.write_register(block.get("out_hour","RF13"), float(now_dt.hour))
            self.write_register(block.get("out_mday","RF14"), float(now_dt.day))
            self.write_register(block.get("out_wday","RF15"), float((now_dt.weekday()+1)%7))

        # ── Variables nommées ─────────────────────────────────────────────
        elif btype in ("backup", "av"):
            varname = block.get("varname", "av0").lower()
            default = float(block.get("default", 0.0))
            # Lire depuis av_vars (écrit par l'opérateur) ou valeur par défaut
            with self._lock:
                if not hasattr(self, 'av_vars'):
                    self.av_vars = {}
                val = self.av_vars.get(varname, default)
            val_out = block.get("val_out") or block.get("reg_out")
            if val_out and str(val_out).startswith("RF"):
                self.write_register(val_out, val)
            # Sortie booléenne directe si câblée
            if out is not None:
                self.write_bool_out(out, bool(val))

        elif btype == "dv":
            varname = block.get("varname", "dv0").lower()  # insensible à la casse
            default = block.get("default", False)
            # Convertir string "true"/"false" en bool (peut arriver depuis JSON)
            if isinstance(default, str):
                default = default.strip().lower() == "true"
            else:
                default = bool(default)
            with self._lock:
                if not hasattr(self, 'dv_vars'):
                    self.dv_vars = {}
                val = self.dv_vars.get(varname, default)
            # Écrire GPIO uniquement si valeur changée (évite écrasement en boucle)
            if out is not None:
                prev_key = f"_dv_prev_{bid}"
                prev = getattr(self, '_dv_prev', {})
                if not hasattr(self, '_dv_prev'): self._dv_prev = {}
                if self._dv_prev.get(bid) != val:
                    self._dv_prev[bid] = val
                    self.write_bool_out(out, val)

        elif btype in ("stoav", "stoap"):
            cond = self.eval_cond(block.get("condition"), default_if_none=True)
            if btype == "stoav":
                # STOAV : écrire reg_in → av_vars[varname]
                reg_in  = block.get("reg_in")
                varname = block.get("varname", "av0")
                if reg_in is not None:
                    val = self.read_analog(reg_in)
                    if not hasattr(self, 'av_vars'): self.av_vars = {}
                    with self._lock: self.av_vars[varname] = float(val)
            else:
                # STOAP : écrire reg_in → timer preset
                val = self.read_analog(block.get("reg_in", "RF0"))
                varname = block.get("varname", "")
                if varname and "." in varname:
                    tid, attr = varname.split(".", 1)
                    if tid in self.timers and "preset" in attr.lower():
                        self.timers[tid]["preset_ms"] = max(0.0, float(val) * 1000.0)

        # ── CArithm : interpréteur code C simplifié ───────────────────────
        elif btype == "carithm":
            self._exec_carithm(block, dt_ms)

        elif btype == "pyblock":
            return self._exec_pyblock(block, dt_ms)

        # ── Blocs manquants — portés depuis le moteur desktop ─────────────

        elif btype in ("compare", "gt", "ge", "lt", "eq", "ne"):
            op   = block.get("op", "gt")
            a    = self.read_analog(block.get("ref_a", "RF0"))
            b_v  = self.read_analog(block.get("ref_b")) if block.get("ref_b") else float(block.get("val_b", 0))
            res  = {"gt":a>b_v,"ge":a>=b_v,"lt":a<b_v,"eq":a==b_v,"ne":a!=b_v}.get(op, False)
            if out: self.write_signal(out, res)

        elif btype == "compare_f":
            ref  = block.get("reg_ref", "RF0")
            thr  = float(block.get("threshold", 80.0))
            op   = block.get("op", "gt")
            val  = self.read_analog(ref)
            res  = {"gt":val>thr,"ge":val>=thr,"lt":val<thr,"eq":val==thr,"ne":val!=thr}.get(op, False)
            if out: self.write_signal(out, res)

        elif btype == "avg":
            src = self.read_analog(block.get("reg_in", "RF0"))
            n   = int(block.get("n", 10))
            bid = block.get("id", "avg")
            if bid not in self.timers: self.timers[bid] = {"buf": [], "acc": 0.0}
            s = self.timers[bid]
            s["buf"].append(src)
            if len(s["buf"]) > n: s["buf"].pop(0)
            avg = sum(s["buf"]) / len(s["buf"])
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, avg)

        elif btype == "filt1":
            src = self.read_analog(block.get("reg_in", "RF0"))
            tc  = float(block.get("tc_s", 10.0))
            bid = block.get("id", "filt")
            if bid not in self.timers: self.timers[bid] = {"y": src}
            s = self.timers[bid]
            dt  = dt_ms / 1000.0
            alpha = dt / (tc + dt) if (tc + dt) > 0 else 1.0
            s["y"] = s["y"] + alpha * (src - s["y"])
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, s["y"])

        elif btype == "integ":
            src = self.read_analog(block.get("reg_in", "RF0"))
            ki  = float(block.get("ki", 1.0))
            lo  = float(block.get("lo", -1e9))
            hi  = float(block.get("hi",  1e9))
            bid = block.get("id", "integ")
            if bid not in self.timers: self.timers[bid] = {"acc": 0.0}
            s = self.timers[bid]
            rc = self.eval_cond(block.get("reset_cond"))
            if rc: s["acc"] = 0.0
            else:  s["acc"] = max(lo, min(hi, s["acc"] + src * ki * dt_ms / 1000.0))
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, s["acc"])

        elif btype == "deriv":
            src = self.read_analog(block.get("reg_in", "RF0"))
            kd  = float(block.get("kd", 1.0))
            bid = block.get("id", "deriv")
            if bid not in self.timers: self.timers[bid] = {"prev": src}
            s = self.timers[bid]
            dt = dt_ms / 1000.0
            res = kd * (src - s["prev"]) / dt if dt > 0 else 0.0
            s["prev"] = src
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, res)

        elif btype == "deadb":
            src  = self.read_analog(block.get("reg_in", "RF0"))
            dead = float(block.get("dead", 1.0))
            res  = 0.0 if abs(src) <= dead else src
            dst  = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, res)
            if out: self.write_signal(out, abs(src) <= dead)

        elif btype == "ramp":
            sp   = self.read_analog(block.get("reg_sp", "RF0"))
            rate = float(block.get("rate", 1.0))
            bid  = block.get("id", "ramp")
            if bid not in self.timers: self.timers[bid] = {"cur": sp}
            s = self.timers[bid]
            dt = dt_ms / 1000.0
            delta = rate * dt
            if abs(sp - s["cur"]) <= delta: s["cur"] = sp
            elif sp > s["cur"]:             s["cur"] += delta
            else:                           s["cur"] -= delta
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, s["cur"])
            if out: self.write_signal(out, s["cur"] == sp)

        elif btype == "hyst":
            src  = self.read_analog(block.get("reg_in", "RF0"))
            sp   = float(block.get("sp", 50.0))
            band = float(block.get("band", 2.0))
            bid  = block.get("id", "hyst")
            if bid not in self.timers: self.timers[bid] = {"state": False}
            s = self.timers[bid]
            if not s["state"]:
                if src >= sp + band/2: s["state"] = True
            else:
                if src <= sp - band/2: s["state"] = False
            if out: self.write_signal(out, s["state"])

        elif btype == "abs":
            src = self.read_analog(block.get("reg_in", "RF0"))
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, abs(src))

        elif btype == "sqrt":
            src = self.read_analog(block.get("reg_in", "RF0"))
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, src**0.5 if src >= 0 else 0.0)

        elif btype == "min":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, min(a, b))

        elif btype == "max":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, max(a, b))

        elif btype == "mod":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, a % b if b != 0 else 0.0)

        elif btype == "pow":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            dst = block.get("reg_out", "RF2")
            try:    self.write_register(dst, a ** b)
            except: self.write_register(dst, 0.0)

        elif btype in ("clamp", "clamp_a", "limit"):
            src = self.read_analog(block.get("reg_in", "RF0"))
            lo  = float(block.get("lo", 0.0))
            hi  = float(block.get("hi", 100.0))
            res = max(lo, min(hi, src))
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, res)
            if out: self.write_signal(out, src < lo or src > hi)

        elif btype == "sel":
            g   = self.eval_cond(block.get("sel_cond"))
            in0 = self.read_analog(block.get("in0", "RF0"))
            in1 = self.read_analog(block.get("in1", "RF1"))
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, in1 if g else in0)

        elif btype in ("backup",):
            varname = block.get("varname", "backup0")
            bktype  = block.get("bktype", "float")
            default = block.get("default", False if bktype == "bool" else 0.0)
            val_ref = block.get("val_ref")
            val_out = block.get("val_out")
            if not hasattr(self, 'av_vars'): self.av_vars = {}
            if not hasattr(self, 'dv_vars'): self.dv_vars = {}
            store = self.dv_vars if bktype == "bool" else self.av_vars
            if varname not in store:
                with self._lock: store[varname] = bool(default) if bktype == "bool" else float(default)
            if bktype == "bool":
                if val_ref is not None:
                    nv = bool(self.read_signal(val_ref))
                    if nv != self.dv_vars.get(varname):
                        with self._lock: self.dv_vars[varname] = nv
                current = bool(self.dv_vars.get(varname, bool(default)))
                if val_out is not None: self.write_bool_out(val_out, current)
            else:
                if val_ref is not None:
                    nv = self.read_analog(val_ref)
                    old_v = float(self.av_vars.get(varname, float(default)))
                    if abs(nv - old_v) > 1e-9:
                        with self._lock: self.av_vars[varname] = nv
                current = float(self.av_vars.get(varname, float(default)))
                if val_out is not None:
                    if isinstance(val_out, str) and val_out.startswith("RF"):
                        self.write_register(val_out, current)
                    elif isinstance(val_out, str):
                        with self._lock: self.av_vars[val_out] = current
        elif btype == "stoap":
            cond = self.eval_cond(block.get("condition", {"type":"input","ref":True}))
            if cond:
                src = self.read_analog(block.get("reg_in", "RF0"))
                varname = block.get("varname", "timer0.TimerTime")
                # STOAP writes to timer preset — find timer by name prefix
                tid = varname.split(".")[0] if "." in varname else varname
                if tid in self.timers:
                    self.timers[tid]["preset_ms"] = src * 1000.0

        elif btype == "sr_r":
            # SR_R : Reset prioritaire (R > S)
            s   = self.eval_cond(block.get("set_cond"), default_if_none=False)
            r   = self.eval_cond(block.get("res_cond"), default_if_none=False)
            bit = block.get("bit", "M0")
            if bit not in self.memory: self.memory[bit] = False
            if r:    self.memory[bit] = False  # Reset prioritaire
            elif s:  self.memory[bit] = True
            if out: self.write_signal(out, self.memory.get(bit, False))

        elif btype == "ctd":
            cd = self.eval_cond(block.get("cd_cond"))
            ld = self.eval_cond(block.get("ld_cond"))
            bid = block.get("id", "ctd")
            if bid not in self.counters:
                self.counters[bid] = {"cv": int(block.get("preset", 10)), "_prev_cd": False, "_prev_ld": False, "done": False}
            c = self.counters[bid]
            pv = int(block.get("preset", 10))
            if ld and not c["_prev_ld"]: c["cv"] = pv
            if cd and not c["_prev_cd"] and c["cv"] > 0: c["cv"] -= 1
            c["done"] = c["cv"] <= 0
            c["_prev_cd"] = cd; c["_prev_ld"] = ld
            if out: self.write_signal(out, c["done"])

        elif btype == "ana_in":
            ref = block.get("analog_ref", "ANA0")
            val = self.analog.get(ref, {}).get("celsius", 0.0) or 0.0
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, val)

        elif btype == "pt_in":
            ref = block.get("analog_ref", "PT0")
            val = self.analog.get(ref, {}).get("celsius", 0.0) or 0.0
            dst = block.get("reg_out", "RF0")
            if dst: self.write_register(dst, val)

    # ── CArithm ────────────────────────────────────────────────────────────
    def _exec_carithm(self, block: dict, dt_ms: float):
        import re as _re
        code = block.get("code","").strip()
        if not code: return

        ctx = {}
        for i in range(1,9):
            ref = block.get(f"a{i}_ref", f"ANA{i-1}")
            ctx[f"A{i}"] = self.read_analog(ref)
        for i in range(1,8):
            ref = block.get(f"d{i}_ref")
            ctx[f"d{i}"] = self.read_signal(ref) if ref else False
        for i in range(1,3):
            ref = block.get(f"i{i}_ref", f"RF{12+i}")
            ctx[f"I{i}"] = int(self.read_analog(ref))
        for i in range(1,9): ctx[f"OA{i}"] = 0.0
        for i in range(1,9): ctx[f"od{i}"] = 0
        ctx["OI1"] = 0

        def _c2py(src):
            src = _re.sub(r"//.*", "", src)
            src = _re.sub(r"/\*.*?\*/", "", src, flags=_re.DOTALL)
            src = _re.sub(r";\s*$", "", src, flags=_re.MULTILINE)
            src = src.replace(";", "\n")
            lines = []; 
            for line in src.splitlines():
                line = line.strip()
                if not line: continue
                m = _re.match(r"if\s*\((.+?)\)\s*(.+?),?\s*else\s+(.+)", line)
                if m: lines += [f"if {m.group(1).strip()}:", f"    {m.group(2).strip()}", "else:", f"    {m.group(3).strip()}"]; continue
                m = _re.match(r"if\s*\((.+?)\)\s*(.+)", line)
                if m: lines += [f"if {m.group(1).strip()}:", f"    {m.group(2).strip()}"]; continue
                m = _re.match(r"else\s+(.+)", line)
                if m: lines += ["else:", f"    {m.group(1).strip()}"]; continue
                lines.append(line)
            return "\n".join(lines)

        try:
            exec(_c2py(code), {"__builtins__": {}}, ctx)
        except Exception as e:
            log.debug(f"CArithm {block.get('id','?')}: {e}")
            return

        for i in range(1,9):
            ref = block.get(f"oa{i}_ref", f"RF{i-1}")
            self.write_register(ref, float(ctx.get(f"OA{i}", 0.0)))
        for i in range(1,9):
            ref = block.get(f"od{i}_ref")
            if ref: self.write_signal(ref, bool(ctx.get(f"od{i}", 0)))
        oi_ref = block.get("oi1_ref","RF15")
        self.write_register(oi_ref, float(ctx.get("OI1", 0)))

    def _exec_pyblock(self, block: dict, dt_ms: float) -> str:
        """PYBLOCK — code Python natif avec accès complet au moteur."""
        import math, datetime, statistics

        code = block.get("code", "").strip()
        if not code:
            return f"PYBLOCK {block.get('name','?')}: vide"
        bid = block.get("id", "?")

        if not hasattr(self, '_pyblock_states'):
            self._pyblock_states = {}
        state = self._pyblock_states.setdefault(bid, {})

        ctx = {
            **{f"A{i}": self.read_analog(block.get(f"a{i}_ref", f"ANA{i-1}"))
               for i in range(1, 9)},
            **{f"d{i}": bool(self.read_signal(block.get(f"d{i}_ref")) if block.get(f"d{i}_ref") else False)
               for i in range(1, 9)},
            **{f"I{i}": int(self.read_analog(block.get(f"i{i}_ref", f"RF{12+i}")))
               for i in range(1, 3)},
            **{f"OA{i}": 0.0 for i in range(1, 9)},
            **{f"od{i}": False for i in range(1, 9)},
            "OI1": 0,
            "dt": dt_ms / 1000.0,
            "cycle": getattr(self, 'cycle_count', 0),
            "state": state,
            "read_analog":    self.read_analog,
            "read_signal":    self.read_signal,
            "write_register": self.write_register,
            "write_signal":   self.write_signal,
            "math": math, "datetime": datetime, "statistics": statistics,
            "abs": abs, "min": min, "max": max, "round": round,
            "int": int, "float": float, "bool": bool, "str": str,
            "len": len, "range": range, "list": list, "dict": dict,
            "sum": sum, "sorted": sorted, "enumerate": enumerate,
            "zip": zip, "any": any, "all": all, "print": print,
        }
        try:
            exec(compile(code, f"<pyblock:{bid}>", "exec"),
                 {"__builtins__": {}}, ctx)
        except Exception as e:
            log.warning(f"PYBLOCK {bid}: {e}")
            return f"PYBLOCK {block.get('name','?')} ERR: {e}"

        n_oa = block.get("n_oa", 0)
        n_od = block.get("n_od", 0)
        n_oi = block.get("n_oi", 0)
        for i in range(1, n_oa + 1):
            ref = block.get(f"oa{i}_ref")
            if ref: self.write_register(ref, float(ctx.get(f"OA{i}", 0.0)))
        for i in range(1, n_od + 1):
            ref = block.get(f"od{i}_ref")
            if ref: self.write_signal(ref, bool(ctx.get(f"od{i}", False)))
        if n_oi >= 1:
            oi_ref = block.get("oi1_ref")
            if oi_ref: self.write_register(oi_ref, float(ctx.get("OI1", 0)))
        self._pyblock_states[bid] = ctx["state"]
        return f"PYBLOCK {block.get('name','?')}: OA1={ctx.get('OA1',0.0):.2f} od1={'1' if ctx.get('od1') else '0'}"

    def _scan_loop(self):
        log.info(f"Scan PLC — {len(self.program)} blocs / {self.scan_time_ms} ms")
        # dt_ms = période nominale fixe (comme un vrai automate)
        while self._running:
            t0 = time.monotonic()
            dt_ms = float(self.scan_time_ms)
            try:
                if ON_RPI and getattr(self, '_gpio_ready', False):
                    with self._lock:
                        if getattr(self, '_use_gpiod', False):
                            try:
                                from gpiod.line import Value as _V
                                for pin_k, cfg in self.gpio.items():
                                    if cfg["mode"] == "input":
                                        v = self._gpiod_req.get_value(int(pin_k))
                                        # Pull-up : INACTIVE(LOW)=contact fermé=True
                                        # ACTIVE(HIGH)=contact ouvert=False
                                        cfg["value"] = (v == _V.INACTIVE)
                            except Exception as _ge:
                                log.debug(f"GPIO input read error: {_ge}")
                        else:
                            for pin, cfg in self.gpio.items():
                                if cfg["mode"] == "input":
                                    try: cfg["value"] = not bool(GPIO.input(pin))  # pull-up
                                    except: pass

                if t0 - self._last_ana >= 0.5:
                    readings = self.ads.read_all()
                    with self._lock: self.analog.update(readings)
                    self._last_ana = t0
                    if t0 - self._last_db >= 10.0:
                        self.db.insert(readings); self._last_db = t0

                with self._lock: prog = list(self.program)
                for block in prog: self.exec_block(block, dt_ms)

                self.cycle_count += 1; self.error = ""; self._last_scan = time.monotonic()

            except Exception as e:
                self.error = str(e); self.error_count += 1
                log.error(f"Cycle #{self.cycle_count}: {e}")

            if self.on_update:
                try: self.on_update(self.snapshot())
                except: pass

            elapsed = (time.monotonic() - t0) * 1000.0
            time.sleep(max(0.0, self.scan_time_ms - elapsed) / 1000.0)
        log.info("Scan arrêté")

    def _watchdog(self, timeout):
        while self._running:
            time.sleep(timeout)
            if self._running and self._thread and not self._thread.is_alive():
                log.warning("WATCHDOG : relance scan")
                self._thread = threading.Thread(target=self._scan_loop, daemon=True, name="plc-scan")
                self._thread.start()

    def start(self):
        if self._running: return
        self._load_av_vars()   # Restaurer les consignes opérateur au démarrage
        self._load_dv_vars()   # Restaurer les variables DV au démarrage
        self._running = True; self._last_scan = time.monotonic()
        self._thread  = threading.Thread(target=self._scan_loop, daemon=True, name="plc-scan")
        self._thread.start()
        threading.Thread(target=self._watchdog, args=(self.config.get("watchdog_sec",10),),
                         daemon=True, name="plc-watchdog").start()

    def stop(self):
        self._running = False
        if self._thread: self._thread.join(timeout=2)

    def load_program(self, blocks):
        with self._lock:
            self.program = blocks; self.timers.clear(); self.counters.clear()
            self.pids.clear(); self.cycle_count = 0; self.error_count = 0
        log.info(f"Programme chargé : {len(blocks)} blocs")

    def toggle_input(self, pin):
        if not ON_RPI and pin in self.gpio and self.gpio[pin]["mode"] == "input":
            with self._lock: self.gpio[pin]["value"] = not self.gpio[pin]["value"]

    def snapshot(self):
        skip = {"_prev"}
        with self._lock:
            return {
                "gpio":      {str(p): {**c} for p, c in self.gpio.items()},
                "memory":    {**self.memory},
                "analog":    {k: {**v} for k, v in self.analog.items()},
                "registers": {**self.registers},
                "av_vars":   {**self.av_vars},
                "dv_vars":   {k: bool(v) for k, v in self.dv_vars.items()},
                "timers":    {k: {kk: vv for kk,vv in v.items() if kk not in skip}
                              for k, v in self.timers.items() if not k.startswith("_cmp_")},
                "counters":  {k: {kk: vv for kk,vv in v.items() if kk not in skip}
                              for k, v in self.counters.items()},
                "pids":      {k: {kk: round(vv,4) for kk,vv in v.items()}
                              for k, v in self.pids.items()},
                "running":   self._running, "cycle": self.cycle_count,
                "error":     self.error,    "error_count": self.error_count,
                "on_rpi":    ON_RPI,        "ts": int(time.time()),
            }

    def save_program(self, path=None):
        p = path or PROGRAM_FILE
        try: p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(self.program, indent=2)); log.info(f"Sauvegardé : {p}")
        except Exception as e: log.error(f"Sauvegarde : {e}")

    @staticmethod
    def load_program_file(path=None):
        p = path or PROGRAM_FILE
        if p.exists():
            try: data = json.loads(p.read_text()); log.info(f"Programme : {p} ({len(data)} blocs)"); return data
            except Exception as e: log.error(f"Lecture : {e}")
        return []


def flatten_blocks(blocks: list) -> list:
    """Aplatit récursivement les blocs GROUP dans un programme linéaire.

    Un bloc GROUP encapsule ses blocs internes dans params._inner_blocks (JSON).
    Les blocs GROUP_IN / GROUP_OUT sont des connecteurs de port internes et ne
    génèrent aucun code moteur — ils sont supprimés lors de l'aplatissement.
    Les fils qui traversaient la frontière du groupe sont reconnectés directement.

    Appelé automatiquement au chargement du programme (boot, POST /api/program,
    restauration sauvegarde) pour garantir la compatibilité avec les programmes
    contenant des groupes créés dans l'éditeur FBD.
    """
    import copy as _copy

    def _flatten_once(blk_list):
        """Un seul passage — retourne (nouvelle_liste, changed)."""
        result  = []
        changed = False
        for b in blk_list:
            if b.get("type") != "GROUP":
                result.append(b)
                continue
            changed = True
            inner_raw = b.get("params", {}).get("_inner_blocks")
            if not inner_raw:
                continue   # groupe vide — on le retire
            try:
                saved = json.loads(inner_raw)
            except Exception:
                result.append(b)   # JSON corrompu — garder tel quel
                continue
            inner_all   = saved.get("blocks", [])
            inner_wires = saved.get("wires",  [])
            gin_ids  = {ib["id"] for ib in inner_all if ib.get("type") == "GROUP_IN"}
            gout_ids = {ib["id"] for ib in inner_all if ib.get("type") == "GROUP_OUT"}
            real_blks = [_copy.deepcopy(ib) for ib in inner_all
                         if ib.get("type") not in ("GROUP_IN", "GROUP_OUT")]
            # Seuls les blocs réels sont ajoutés — les ports GROUP_IN/OUT n'ont
            # aucune signification dans le moteur PLC linéaire.
            result.extend(real_blks)
        return result, changed

    flat = list(blocks)
    for _ in range(32):   # limite de sécurité pour les imbrications profondes
        flat, changed = _flatten_once(flat)
        if not changed:
            break
    if flat != list(blocks):
        log.info(f"flatten_blocks : {len(blocks)} → {len(flat)} blocs (groupes aplatis)")
    return flat


def load_config():
    if CONFIG_FILE.exists():
        try: cfg = json.loads(CONFIG_FILE.read_text()); log.info(f"Config : {CONFIG_FILE}"); return cfg
        except Exception as e: log.warning(f"config.json : {e}")
    return {"scan_time_ms":100,"web_port":5000,"web_enabled":True,"watchdog_sec":10,"auto_start":True,
            "security":{"enabled":False,"username":"admin","password":"plc1234"},
            "telegram":{"enabled":False,"token":"","chat_ids":[],"alarm_high":90.0,"alarm_low":2.0,"notify_relays":True,"notify_plc":True,"alarm_cooldown_s":600,"relay_cooldown_s":30,
                        "report_hour":8,"report_enabled":True},
            "analog":{"enabled":True,"r_ref_ohm":10000,"vcc":3.3,
                      "ads":[{"id":f"ADS{i}","address":f"0x{0x48+i:02X}",
                              "channels":[{"id":f"ANA{i*4+j}","name":f"Sonde {i*4+j+1}","probe":"NTC10K"}
                                          for j in range(4)]} for i in range(3)]},"gpio":{}}


# ════════════════════════════════════════════════════════════════════════════════
# ════════════════════════════════════════════════════════════════════════════════
class EmailNotifier:
    """Envoi d'alertes par email SMTP (en complément de Telegram)."""
    def __init__(self, config: dict):
        self.enabled  = config.get("enabled", False)
        self.smtp_host= config.get("smtp_host", "smtp.gmail.com")
        self.smtp_port= int(config.get("smtp_port", 587))
        self.user     = config.get("user", "")
        self.password = config.get("password", "")
        self.from_addr= config.get("from", "")
        self.to_addrs = config.get("to", [])
        self.subject_prefix = config.get("subject_prefix", "[RPi-PLC]")

    def send(self, subject: str, body: str) -> bool:
        if not self.enabled or not self.to_addrs:
            return False
        try:
            import smtplib
            from email.mime.text import MIMEText
            msg = MIMEText(body, "plain", "utf-8")
            msg["Subject"] = f"{self.subject_prefix} {subject}"
            msg["From"]    = self.from_addr or self.user
            msg["To"]      = ", ".join(self.to_addrs)
            with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=10) as s:
                s.ehlo(); s.starttls(); s.login(self.user, self.password)
                s.sendmail(msg["From"], self.to_addrs, msg.as_string())
            log.info(f"Email envoyé : {subject}")
            return True
        except Exception as e:
            log.warning(f"Email échoué : {e}")
            return False

    def send_alarm(self, name: str, value, threshold):
        self.send(f"Alarme {name}",
            f"Alarme déclenchée sur RPi-PLC\n"
            f"Variable : {name}\nValeur : {value}\nSeuil : {threshold}\n"
            f"Date : {__import__('datetime').datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")


def start_web(engine, db, port, recipes=None, backup=None, bot=None, calibration=None):
    try:
        from flask import Flask, render_template, request, jsonify
        from flask_socketio import SocketIO, emit
    except ImportError:
        log.warning("Flask absent — pip3 install flask flask-socketio"); return

    app = Flask(__name__, template_folder="templates")
    import os as _os
    app.config["SECRET_KEY"] = _os.environ.get("PLC_SECRET", "rpi-plc-" + _os.urandom(8).hex())
    make_auth_middleware(app, engine.config)
    sio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

    def on_plc_update(s):
        # Appliquer la calibration aux températures avant émission
        if calibration:
            for ch, info in s.get("analog", {}).items():
                raw = info.get("celsius")
                if raw is not None and raw == raw:
                    info["celsius"]      = round(calibration.apply(ch, raw), 2)
                    info["celsius_raw"]  = round(raw, 2)
                    cal_name = calibration.get_name(ch)
                    if cal_name and cal_name != ch:
                        info["name"] = cal_name
        sio.emit("plc_update", s)
        # ── Notifications Telegram ──────────────────────────────────────
        if hasattr(bot, 'check_alarms'):
            bot.check_alarms(s.get("analog", {}))
        if hasattr(bot, 'check_relay_changes'):
            bot.check_relay_changes(s.get("gpio", {}))
        if hasattr(bot, 'check_plc_state'):
            bot.check_plc_state(s.get("running", False))
        if hasattr(bot, 'check_daily_report'):
            bot.check_daily_report()
    engine.on_update = on_plc_update

    @app.route("/")
    def index(): return render_template("index.html")

    @app.route("/api/state")
    def api_state(): return jsonify(engine.snapshot())

    @app.route("/api/status")
    def api_status():
        s = engine.snapshot()
        return jsonify({"ok":True,"running":s["running"],"cycle":s["cycle"],
                        "error":s["error"],"on_rpi":s["on_rpi"]})

    @app.route("/api/analog")
    def api_analog(): return jsonify(engine.analog)

    @app.route("/api/analog/history")
    def api_history():
        ch = request.args.get("channel","ANA0")
        h  = int(request.args.get("hours",24))
        return jsonify(db.get_history(ch, h))

    @app.route("/api/analog/latest")
    def api_latest(): return jsonify(db.get_latest())

    @app.route("/api/analog/sim", methods=["POST"])
    def api_sim():
        d = request.json or {}
        ref = d.get("ref", "")
        if "celsius" in d:
            # Simulation directe en °C (nouveau panneau simulation synoptique)
            engine.set_analog_celsius(ref, float(d["celsius"]))
        else:
            # Ancienne API : tension en V
            engine.set_analog_sim(ref, float(d.get("value", 0)))
        return jsonify({"ok": True})

    @app.route("/api/program", methods=["GET"])
    def api_get_prog(): return jsonify(engine.program)

    @app.route("/api/program", methods=["POST"])
    def api_set_prog():
        prog = request.json
        if not isinstance(prog, list): return jsonify({"error":"Liste attendue"}), 400
        prog = flatten_blocks(prog)
        engine.load_program(prog); engine.save_program()
        if not engine._running: engine.start()
        return jsonify({"ok":True,"blocks":len(prog)})

    @app.route("/api/plc/start",     methods=["POST"])
    def api_start(): engine.start(); return jsonify({"ok":True})

    @app.route("/api/plc/stop",      methods=["POST"])
    def api_stop():  engine.stop();  return jsonify({"ok":True})

    @app.route("/api/plc/scan_time", methods=["POST"])
    def api_scan():
        ms = max(10, min(int(request.json.get("ms",100)), 5000))
        engine.scan_time_ms = ms; return jsonify({"ok":True,"ms":ms})

    @app.route("/api/gpio/write", methods=["POST"])
    @app.route("/api/gpio", methods=["POST"])   # alias pour synoptic.html
    def api_gpio_write():
        d = request.json or {}
        pin = int(d.get("pin", 0))
        val = bool(int(d.get("value", 0)))
        # Écrire le GPIO physique
        engine.write_signal(pin, val)
        # Mettre à jour aussi les DV liées à ce pin
        # pour éviter que le scan cycle n'écrase la commande manuelle
        for block in engine.program:
            if block.get('type') == 'dv' and block.get('output') == pin:
                vn = block.get('varname', '').lower()
                with engine._lock:
                    engine.dv_vars[vn] = val
                if hasattr(engine, '_dv_prev'):
                    engine._dv_prev[block.get('id','')] = val
                engine._save_dv_vars()
                log.info(f"GPIO {pin} → DV '{vn}' = {val} (commande manuelle SCADA)")
        return jsonify({"ok": True, "pin": pin, "value": val})

    @app.route("/api/gpio/scan", methods=["POST"])
    def api_gpio_scan():
        """Pulse chaque sortie 0.5s dans l'ordre pour identifier le câblage."""
        import time as _t
        if not ON_RPI or not getattr(engine, '_gpio_ready', False):
            return jsonify({"ok": False, "error": "GPIO non disponible"})
        
        results = []
        outputs = [(pin, cfg) for pin, cfg in sorted(engine.gpio.items())
                   if cfg["mode"] == "output"]
        
        def _scan():
            from gpiod.line import Value as GV
            for pin, cfg in outputs:
                active_low = cfg.get("active_low", True)
                # ON
                on_v = GV.INACTIVE if active_low else GV.ACTIVE
                off_v = GV.ACTIVE if active_low else GV.INACTIVE
                try:
                    engine._gpiod_req.set_value(pin, on_v)
                    _t.sleep(0.4)
                    engine._gpiod_req.set_value(pin, off_v)
                    _t.sleep(0.2)
                    results.append({"pin": pin, "name": cfg["name"], "ok": True})
                except Exception as e:
                    results.append({"pin": pin, "name": cfg["name"], "ok": False, "error": str(e)})
        
        import threading as _th
        t = _th.Thread(target=_scan, daemon=True)
        t.start()
        return jsonify({"ok": True, "message": f"Scan de {len(outputs)} sorties en cours...",
                        "order": [{"pin": p, "name": c["name"]} for p,c in outputs]})

    @app.route("/api/gpio/test", methods=["POST"])
    def api_gpio_test():
        """Test direct gpiod sans logique active-low — pour diagnostic."""
        d = request.json or {}
        pin = int(d.get("pin", 0))
        raw = int(d.get("raw", 0))  # 0=INACTIVE(LOW), 1=ACTIVE(HIGH)
        if ON_RPI and getattr(engine, '_gpio_ready', False) and getattr(engine, '_use_gpiod', False):
            try:
                from gpiod.line import Value as GV
                v = GV.ACTIVE if raw else GV.INACTIVE
                engine._gpiod_req.set_value(pin, v)
                return jsonify({"ok": True, "pin": pin, "raw": raw,
                                "level": "HIGH" if raw else "LOW"})
            except Exception as e:
                return jsonify({"ok": False, "error": str(e)})
        return jsonify({"ok": False, "error": "GPIO non disponible"})

    @app.route("/api/gpio/status")
    def api_gpio_status():
        """Lit l'état réel de tous les GPIO via gpiod."""
        result = {}
        if ON_RPI and getattr(engine, '_gpio_ready', False) and getattr(engine, '_use_gpiod', False):
            from gpiod.line import Value as GV
            for pin, cfg in engine.gpio.items():
                try:
                    with engine._lock:
                        v = engine._gpiod_req.get_value(pin)
                    # Pour les entrées pull-up: INACTIVE(LOW)=fermé=True, ACTIVE(HIGH)=ouvert=False
                    if cfg["mode"] == "input":
                        logic_val = (v != GV.ACTIVE)   # INACTIVE ou LOW = True
                    else:
                        logic_val = cfg["value"]
                    result[str(pin)] = {
                        "name": cfg["name"], "mode": cfg["mode"],
                        "logic": logic_val,
                        "physical": "HIGH" if v == GV.ACTIVE else "LOW",
                        "pull": cfg.get("pull", "off")
                    }
                except Exception as e:
                    result[str(pin)] = {"name": cfg["name"], "error": str(e)}
        else:
            for pin, cfg in engine.gpio.items():
                result[str(pin)] = {"name": cfg["name"], "mode": cfg["mode"],
                                    "logic": cfg["value"], "physical": "sim"}
        return jsonify(result)

    @app.route("/api/register/write", methods=["POST"])
    def api_reg_write():
        d = request.json; ref = d.get("ref",""); val = float(d.get("value",0.0))
        if ref.startswith("RF"):
            engine.registers[ref] = val; return jsonify({"ok":True,"ref":ref,"value":val})
        return jsonify({"error":"Ref invalide"}), 400

    @app.route("/api/av/write", methods=["POST"])
    def api_av_write():
        """Écriture d'une variable AV nommée depuis le synoptique opérateur."""
        d = request.json
        varname = d.get("varname", "")
        val     = float(d.get("value", 0.0))
        if not varname:
            return jsonify({"error": "varname manquant"}), 400
        engine.write_av(varname, val)
        return jsonify({"ok": True, "varname": varname, "value": val})

    @app.route("/api/av/read")
    def api_av_read():
        """Lecture de toutes les variables AV nommées."""
        with engine._lock:
            return jsonify(dict(engine.av_vars))

    @app.route("/api/dv/write", methods=["POST"])
    def api_dv_write():
        """Écriture d'une variable DV nommée depuis le synoptique opérateur."""
        d = request.json
        varname = d.get("varname", "")
        raw = d.get("value", False)
        # Conversion robuste : 0, "0", "false" → False ; 1, "1", "true" → True
        if isinstance(raw, str):
            val = raw.lower() not in ('0', 'false', '')
        else:
            val = bool(raw)
        if not varname:
            return jsonify({"error": "varname manquant"}), 400
        engine.write_dv(varname, val)
        return jsonify({"ok": True, "varname": varname, "value": val})

    @app.route("/api/dv/read")
    def api_dv_read():
        """Lecture de toutes les variables DV nommées."""
        with engine._lock:
            return jsonify({k: bool(v) for k, v in engine.dv_vars.items()})

    @app.route("/api/dv/reset", methods=["POST"])
    def api_dv_reset():
        """Remet toutes les DV à False et écrit les GPIO (état sûr)."""
        with engine._lock:
            keys = list(engine.dv_vars.keys())
            for k in keys:
                engine.dv_vars[k] = False
        # Réécrire tous les GPIO liés à des DV
        for block in engine.program:
            if block.get('type') == 'dv':
                out = block.get('output')
                if out is not None:
                    engine.write_bool_out(out, False)
                    if hasattr(engine, '_dv_prev'):
                        engine._dv_prev[block.get('id','')] = False
        engine._save_dv_vars()
        log.info(f"[DV] Reset: {len(keys)} variable(s) remises à False")
        return jsonify({"ok": True, "reset": keys})

    @app.route("/api/memory/write", methods=["POST"])
    def api_mem_write():
        d = request.json; ref = d.get("ref",""); val = bool(d.get("value",False))
        if ref.startswith("M"):
            engine.memory[ref] = val; return jsonify({"ok":True,"ref":ref,"value":val})
        return jsonify({"error":"Ref invalide"}), 400

    @app.route("/api/analog/history/csv")
    def api_history_csv():
        ch = request.args.get("channel","ANA0"); hours = int(request.args.get("hours",24))
        rows = db.get_history(ch, hours)
        import io, csv as _csv
        from datetime import datetime as _dt
        from flask import Response
        buf = io.StringIO(); w = _csv.writer(buf)
        w.writerow(["timestamp","datetime","celsius"])
        for r in rows:
            w.writerow([r["ts"], _dt.fromtimestamp(r["ts"]).strftime("%Y-%m-%d %H:%M:%S"), r["t"]])
        return Response(buf.getvalue(), mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment;filename={ch}_{hours}h.csv"})

    @app.route("/api/analog/stats")
    def api_stats():
        ch = request.args.get("channel","ANA0"); hours = int(request.args.get("hours",24))
        rows = db.get_history(ch, hours); vals = [r["t"] for r in rows if r["t"] is not None]
        if not vals: return jsonify({"channel":ch,"count":0})
        return jsonify({"channel":ch,"hours":hours,"count":len(vals),
            "min":round(min(vals),2),"max":round(max(vals),2),
            "avg":round(sum(vals)/len(vals),2),"last":round(vals[-1],2)})

    @app.route("/scada")
    def scada(): return render_template("scada.html")

    @app.route("/regulech")
    def regulech(): return render_template("synoptique_regulech.html")

    @app.route("/manifest.json")
    def manifest():
        from flask import send_from_directory
        return send_from_directory(str(BASE_DIR / "static"), "manifest.json",
                                   mimetype="application/manifest+json")

    @app.route("/sw.js")
    def sw():
        from flask import send_from_directory, make_response
        resp = make_response(send_from_directory(str(BASE_DIR / "static"), "sw.js"))
        resp.headers["Service-Worker-Allowed"] = "/"
        resp.headers["Cache-Control"] = "no-cache"
        return resp

    @app.route("/static/<path:filename>")
    def static_files(filename):
        from flask import send_from_directory
        return send_from_directory(str(BASE_DIR / "static"), filename)

    # ── API Recettes ──────────────────────────────────────────────────────────
    @app.route("/api/recipes", methods=["GET"])
    def api_recipes_list():
        return jsonify(recipes.get_all() if recipes else {})

    @app.route("/api/recipes/save", methods=["POST"])
    def api_recipes_save():
        d = request.json
        ok = recipes.save_recipe(
            d.get("name",""), d.get("description",""),
            d.get("setpoints",{}), d.get("memory",{})
        ) if recipes else False
        return jsonify({"ok": ok})

    @app.route("/api/recipes/apply", methods=["POST"])
    def api_recipes_apply():
        name = request.json.get("name","")
        ok = recipes.apply(name, engine) if recipes else False
        return jsonify({"ok": ok})

    @app.route("/api/recipes/delete", methods=["POST"])
    def api_recipes_delete():
        name = request.json.get("name","")
        ok = recipes.delete_recipe(name) if recipes else False
        return jsonify({"ok": ok})

    @app.route("/api/recipes/snapshot", methods=["POST"])
    def api_recipes_snapshot():
        d = request.json
        ok = recipes.snapshot_from_engine(engine, d.get("name",""), d.get("description","")) if recipes else False
        return jsonify({"ok": ok})

    # ── API Sauvegardes ───────────────────────────────────────────────────────
    @app.route("/api/backup/list")
    def api_backup_list():
        return jsonify(backup.list_backups() if backup else [])

    @app.route("/api/backup/save", methods=["POST"])
    def api_backup_save():
        d     = request.json or {}
        label = d.get("label", "")
        info  = backup.save(engine.program, label) if backup else {}
        return jsonify({"ok": bool(info), "backup": info})

    @app.route("/api/backup/restore", methods=["POST"])
    def api_backup_restore():
        bid     = (request.json or {}).get("id","")
        program = backup.restore(bid) if backup else None
        if program is not None:
            program = flatten_blocks(program)
            engine.load_program(program)
            engine.save_program()
            return jsonify({"ok": True, "blocks": len(program)})
        return jsonify({"ok": False, "error": "Sauvegarde introuvable"}), 404

    @app.route("/api/backup/delete", methods=["POST"])
    def api_backup_delete():
        bid = (request.json or {}).get("id","")
        ok  = backup.delete(bid) if backup else False
        return jsonify({"ok": ok})

    @app.route("/api/backup/download/<bid>")
    def api_backup_download(bid):
        if not backup: return jsonify({"error":"backup non dispo"}), 404
        p = backup.get_path(bid)
        if not p: return jsonify({"error":"introuvable"}), 404
        from flask import send_file
        return send_file(p, as_attachment=True,
                         download_name=p.name, mimetype="application/json")

    # ── API Telegram ──────────────────────────────────────────────────────────
    @app.route("/api/telegram/test", methods=["POST"])
    def api_telegram_test():
        """Envoie un message de test Telegram depuis le RPi."""
        try:
            _token    = getattr(bot, "token", "")    if bot else ""
            _enabled  = getattr(bot, "enabled", False) if bot else False
            _chat_ids = list(getattr(bot, "chat_ids", []) if bot else [])

            if not _token:
                return jsonify({"ok": False,
                    "error": "Token manquant — configurer dans SCADA ✈ Telegram"})
            if not _enabled:
                return jsonify({"ok": False,
                    "error": "Bot desactive — cocher Activer dans SCADA ✈ Telegram"})

            import requests as _req

            # Auto-decouverte du chat_id via getUpdates si absent
            if not _chat_ids:
                try:
                    upd = _req.get(
                        "https://api.telegram.org/bot" + _token + "/getUpdates",
                        timeout=8).json()
                    found = []
                    for u in upd.get("result", []):
                        cid = str(u.get("message", {}).get("chat", {}).get("id", ""))
                        if cid and cid not in found:
                            found.append(cid)
                    if found:
                        _chat_ids = found
                        if bot:
                            bot.chat_ids = found
                        _cfg2 = engine.config.setdefault("telegram", {})
                        _cfg2["chat_ids"] = found
                        try:
                            ex2 = json.loads(CONFIG_FILE.read_text()) if CONFIG_FILE.exists() else {}
                            ex2["telegram"] = _cfg2
                            CONFIG_FILE.write_text(json.dumps(ex2, indent=2))
                        except Exception:
                            pass
                        log.info("Chat IDs auto-decouverts: " + str(found))
                    else:
                        return jsonify({"ok": False,
                            "error": "Aucun chat_id — envoyer /start au bot Telegram d'abord"})
                except Exception as eu:
                    return jsonify({"ok": False,
                        "error": "getUpdates echoue: " + str(eu)})

            # Envoi du message de test
            s = engine.snapshot()
            run_str  = "RUN" if s.get("running") else "STOP"
            msg_text = ("Test RPi-PLC Studio\nPLC: " + run_str +
                        "\nCycles: " + str(s.get("cycle", 0)) +
                        "\nBot operationnel !")
            errors = []
            for cid in _chat_ids:
                try:
                    r = _req.post(
                        "https://api.telegram.org/bot" + _token + "/sendMessage",
                        json={"chat_id": cid, "text": msg_text},
                        timeout=8)
                    data = r.json()
                    if data.get("ok"):
                        log.info("Test Telegram OK -> " + str(cid))
                    else:
                        errors.append(str(cid) + ": " + data.get("description", "Erreur"))
                except Exception as es:
                    errors.append(str(es))

            if not errors:
                return jsonify({"ok": True, "chat_ids": _chat_ids})
            return jsonify({"ok": False, "error": " | ".join(errors),
                            "chat_ids": _chat_ids})

        except Exception as top_e:
            log.error("api_telegram_test: " + str(top_e), exc_info=True)
            return jsonify({"ok": False, "error": "Erreur interne: " + str(top_e)})

    # ── Email SMTP ──────────────────────────────────────────────────────────
    @app.route("/api/email/config", methods=["GET"])
    def api_email_config_get():
        cfg = load_config().get("email", {})
        # Ne pas exposer le mot de passe
        safe = {k: v for k, v in cfg.items() if k != "password"}
        safe["password_set"] = bool(cfg.get("password"))
        return jsonify(safe)

    @app.route("/api/email/config", methods=["POST"])
    def api_email_config_set():
        import json as _j
        cfg_path = Path(__file__).parent / "config.json"
        try:
            full_cfg = _j.loads(cfg_path.read_text()) if cfg_path.exists() else {}
        except Exception:
            full_cfg = {}
        full_cfg.setdefault("email", {}).update(request.json or {})
        cfg_path.write_text(_j.dumps(full_cfg, indent=2, ensure_ascii=False))
        return jsonify({"ok": True})

    @app.route("/api/email/test", methods=["POST"])
    def api_email_test():
        cfg = load_config().get("email", {})
        notifier = EmailNotifier(cfg)
        ok = notifier.send("Test RPi-PLC", "Message de test depuis votre RPi-PLC Studio.")
        return jsonify({"ok": ok, "error": None if ok else "Vérifiez la configuration SMTP"})

    @app.route("/api/telegram/config", methods=["GET"])
    def api_telegram_cfg():
        cfg = engine.config.get("telegram", {})
        # Valeurs par défaut pour les nouveaux champs
        cfg.setdefault("notify_relays", True)
        cfg.setdefault("notify_plc", True)
        cfg.setdefault("alarm_cooldown_s", 600)
        cfg.setdefault("relay_cooldown_s", 30)
        cfg.setdefault("alarm_high", 90.0)
        cfg.setdefault("alarm_low", 2.0)
        return jsonify({
            "enabled":        cfg.get("enabled", False),
            "has_token":      bool(cfg.get("token", "")),
            "chat_ids":       cfg.get("chat_ids", []),
            "alarm_high":     cfg.get("alarm_high", 85.0),
            "alarm_low":      cfg.get("alarm_low", 3.0),
            "report_hour":    cfg.get("report_hour", 8),
            "report_enabled": cfg.get("report_enabled", True),
            "bot_running":    bool(getattr(bot, "_running", False)),
        })

    @app.route("/api/telegram/config", methods=["POST"])
    def api_telegram_cfg_save():
        """Met à jour la config Telegram et redémarre le bot si nécessaire."""
        d = request.json or {}
        cfg = engine.config.setdefault("telegram", {})
        for k in ("enabled","token","chat_ids","alarm_high","alarm_low",
                  "report_hour","report_enabled"):
            if k in d: cfg[k] = d[k]
        try:
            existing = json.loads(CONFIG_FILE.read_text()) if CONFIG_FILE.exists() else {}
            existing["telegram"] = cfg
            CONFIG_FILE.write_text(json.dumps(existing, indent=2))
        except Exception as e:
            log.warning(f"Config telegram write: {e}")
        # Redémarrer le bot avec la nouvelle config
        try:
            if bot and hasattr(bot, 'restart'):
                bot.restart(cfg)
            elif bot:
                # Ancienne version sans restart() — mise à jour manuelle
                bot.stop() if hasattr(bot, 'stop') else None
                bot.cfg       = cfg
                bot.enabled   = cfg.get("enabled", False)
                bot.token     = cfg.get("token", "")
                bot.chat_ids  = [str(c) for c in cfg.get("chat_ids", [])]
                bot.alarm_high= float(cfg.get("alarm_high", 85.0))
                bot.alarm_low = float(cfg.get("alarm_low", 3.0))
                bot._base     = f"https://api.telegram.org/bot{bot.token}"
                bot._offset   = 0
                if hasattr(bot, 'start'): bot.start()
            log.info(f"Bot Telegram reconfiguré (enabled={cfg.get('enabled',False)}, "
                     f"chat_ids={cfg.get('chat_ids',[])})")
        except Exception as e:
            log.warning(f"Redémarrage bot: {e}")
        return jsonify({"ok": True, "enabled": cfg.get("enabled", False),
                        "running": getattr(bot, '_running', False)})

    # ── API Calibration ──────────────────────────────────────────────────────
    @app.route("/api/calibration", methods=["GET"])
    def api_cal_get():
        return jsonify(calibration.get_all() if calibration else {})

    @app.route("/api/calibration/<channel>", methods=["POST"])
    def api_cal_set(channel):
        ok = calibration.set(channel, request.json or {}) if calibration else False
        return jsonify({"ok": ok})

    @app.route("/api/calibration/reset", methods=["POST"])
    def api_cal_reset():
        """Réinitialiser la calibration d'un canal."""
        ch = (request.json or {}).get("channel", "")
        if calibration and ch:
            calibration.set(ch, {"offset": 0.0, "gain": 1.0})
            return jsonify({"ok": True})
        return jsonify({"ok": False})

    # ── API Rapports ──────────────────────────────────────────────────────────
    @app.route("/api/report/html")
    def api_report_html():
        hours = int(request.args.get("hours", 24))
        html  = generate_html_report(db, engine, calibration, hours)
        from flask import Response
        return Response(html, mimetype="text/html",
                        headers={"Content-Disposition": f"inline; filename=rapport_{hours}h.html"})

    @app.route("/api/report/csv")
    def api_report_csv():
        hours = int(request.args.get("hours", 24))
        csv_  = generate_csv_report(db, engine.analog, calibration, hours)
        from flask import Response
        from datetime import datetime as _dt
        fname = f"rpi-plc_{_dt.now().strftime('%Y%m%d_%H%M')}_{hours}h.csv"
        return Response(csv_, mimetype="text/csv",
                        headers={"Content-Disposition": f"attachment; filename={fname}"})

    @app.route("/api/report/json")
    def api_report_json():
        hours = int(request.args.get("hours", 24))
        channels = sorted(engine.analog.keys(),
                          key=lambda x: int(x[3:]) if x[3:].isdigit() else 0)
        result = {}
        for ch in channels:
            rows = db.get_history(ch, hours)
            cal  = calibration.get(ch) if calibration else {}
            result[ch] = {
                "name":      cal.get("name") or engine.analog.get(ch,{}).get("name", ch),
                "current":   engine.analog.get(ch, {}).get("celsius"),
                "alarm_high":cal.get("alarm_high", 90.0),
                "alarm_low": cal.get("alarm_low", 3.0),
                "history":   rows,
            }
        return jsonify(result)

    @sio.on("connect")
    def on_connect(): emit("plc_update", engine.snapshot())

    @sio.on("toggle_input")
    def on_toggle(data):
        engine.toggle_input(int(data["pin"])); sio.emit("plc_update", engine.snapshot())

    # ── API Synoptique ────────────────────────────────────────────────────────
    @app.route("/api/synoptic", methods=["GET"])
    def api_synoptic_get():
        from pathlib import Path as _P
        p = BASE_DIR / "synoptic.json"
        if p.exists():
            return jsonify(json.loads(p.read_text()))
        return jsonify({"widgets": [], "background": "#0d1117", "grid": 20})

    @app.route("/api/synoptic", methods=["POST"])
    def api_synoptic_save():
        from pathlib import Path as _P
        data = request.json or {}
        (_P(BASE_DIR) / "synoptic.json").write_text(
            json.dumps(data, indent=2, ensure_ascii=False))
        return jsonify({"ok": True})

    @app.route("/api/set_register", methods=["POST"])
    def api_set_register():
        """Modifie un registre RF* ou variable AV nommée depuis le synoptique."""
        data = request.json or {}
        ref  = str(data.get("id", ""))
        val  = float(data.get("value", 0))
        try:
            if ref.startswith("RF"):
                engine.write_register(ref, val)
            else:
                engine.write_av(ref, val)
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.route("/api/set_dv", methods=["POST"])
    def api_set_dv():
        """Modifie une variable discrète/mémoire depuis le synoptique."""
        data = request.json or {}
        ref  = str(data.get("id", ""))
        val  = data.get("value", 0)
        try:
            engine.write_dv(ref, bool(int(val)))
            return jsonify({"ok": True})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)})

    @app.route("/api/action", methods=["POST"])
    def api_action():
        """Actions PLC depuis le synoptique (start/stop/reset)."""
        d = request.json or {}
        action = d.get("action", "")
        ref    = d.get("ref", "")
        if action == "plc_start":
            if not engine._running:
                engine.start()
            return jsonify({"ok": True, "action": "started"})
        elif action == "plc_stop":
            engine.stop()
            return jsonify({"ok": True, "action": "stopped"})
        elif action == "reset":
            engine.write_dv(ref, False) if ref else None
            return jsonify({"ok": True})
        return jsonify({"ok": False, "error": f"Action inconnue: {action}"})

    @app.route("/synoptic")
    def synoptic_editor():
        return render_template("synoptic.html")

    @app.route("/api/auth/status")
    def api_auth_status():
        sec = engine.config.get("security", {})
        return jsonify({"enabled": sec.get("enabled", False),
                        "https":   sec.get("https", False),
                        "username": sec.get("username", "admin")})

    @app.route("/api/auth/config", methods=["POST"])
    def api_auth_config():
        import hashlib as _hl
        d   = request.json or {}
        sec = engine.config.setdefault("security", {})
        if "enabled"  in d: sec["enabled"]  = bool(d["enabled"])
        if "https"    in d: sec["https"]     = bool(d["https"])
        if "username" in d: sec["username"]  = str(d["username"])
        if "password" in d and d["password"]:
            sec["password"] = str(d["password"])  # stocké en clair, hashé à la vérification
        try:
            existing = json.loads(CONFIG_FILE.read_text()) if CONFIG_FILE.exists() else {}
            existing["security"] = sec
            CONFIG_FILE.write_text(json.dumps(existing, indent=2))
        except Exception: pass
        return jsonify({"ok": True})

    def run():
        ssl_ctx = get_ssl_context(BASE_DIR, engine.config)
        proto   = "https" if ssl_ctx else "http"
        log.info(f"Web : {proto}://0.0.0.0:{port}")
        if ssl_ctx:
            sio.run(app, host="0.0.0.0", port=port, debug=False,
                    use_reloader=False, ssl_context=ssl_ctx, allow_unsafe_werkzeug=True)
        else:
            sio.run(app, host="0.0.0.0", port=port, debug=False, use_reloader=False, allow_unsafe_werkzeug=True)

    threading.Thread(target=run, daemon=True, name="web").start()


# ════════════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--load",   metavar="FILE")
    parser.add_argument("--no-web", action="store_true")
    parser.add_argument("--port",   type=int, default=None)
    parser.add_argument("--scan",   type=int, default=None)
    args = parser.parse_args()

    log.info("="*54); log.info("  RPi-PLC — Démarrage")
    log.info(f"  Mode : {'MATÉRIEL' if ON_RPI else 'SIMULATION'}")
    log.info(f"  Dir  : {BASE_DIR}"); log.info("="*54)

    config = load_config()
    if args.scan: config["scan_time_ms"] = args.scan
    port = args.port or config.get("web_port", 5000)

    ads         = ADS1115Manager(config)
    db          = HistoryDB(DB_FILE)
    recipes     = RecipeManager(BASE_DIR)
    backup      = BackupManager(BASE_DIR)
    calibration = CalibrationManager(BASE_DIR)
    engine      = PLCEngine(config, ads, db)
    engine.init_gpio()

    prog_path = Path(args.load) if args.load else PROGRAM_FILE
    program   = PLCEngine.load_program_file(prog_path)
    if program:
        program = flatten_blocks(program)
        engine.load_program(program)
    else:
        log.warning("Aucun programme — en attente d'un déploiement")

    # Bot Telegram
    bot = TelegramBot(config, engine, recipes)
    bot.start()

    # Démarrer Flask EN PREMIER — avant le scan GPIO
    if not args.no_web and config.get("web_enabled", True):
        start_web(engine, db, port, recipes, backup, bot, calibration)
        import time as _tw; _tw.sleep(1)  # laisser Flask lier le port

    if config.get("auto_start", True) and program:
        engine.start(); log.info("Scan démarré automatiquement")

    def shutdown(sig, frame):
        log.info("Arrêt…"); bot.stop(); engine.stop(); engine.cleanup_gpio(); sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT,  shutdown)

    log.info("RPi-PLC opérationnel")
    while True:
        time.sleep(30)
        s = engine.snapshot()
        ok = sum(1 for v in s["analog"].values() if v.get("celsius") is not None)
        log.info(f"[OK] cycle={s['cycle']} err={s['error_count']} analog={ok}/12 run={s['running']}")

if __name__ == "__main__":
    main()
