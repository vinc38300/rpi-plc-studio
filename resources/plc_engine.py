"""
core/plc_engine.py — Moteur PLC avec support analogique (PT100/PT1000, ADS1115, PID)
"""

import time
import math
import threading
import logging
from typing import Callable, Optional

log = logging.getLogger("plc")


class PLCEngine:

    def __init__(self, on_update: Optional[Callable] = None):
        self.on_update    = on_update
        self._running     = False
        self._thread: Optional[threading.Thread] = None
        self._lock        = threading.Lock()

        self.program: list = []

        # GPIO numériques simulés
        # GPIO réels de la carte E/S PT100
        # 8 entrées TOR + 16 sorties relais K1-K16 (GPIO2/GPIO3 réservés I²C)
        self.gpio: dict = {
            # ── Sorties relais K1–K16 (ordre K1→K16) ─────────────────────────
             5: {"name":"Sortie K1",    "mode":"output", "value":False},
            11: {"name":"Sortie K2",    "mode":"output", "value":False},
             9: {"name":"Sortie K3",    "mode":"output", "value":False},
            10: {"name":"Sortie K4",    "mode":"output", "value":False},
            22: {"name":"Sortie K5",    "mode":"output", "value":False},
            27: {"name":"Sortie K6",    "mode":"output", "value":False},
            17: {"name":"Sortie K7",    "mode":"output", "value":False},
             4: {"name":"Sortie K8",    "mode":"output", "value":False},
             6: {"name":"Sortie K9",    "mode":"output", "value":False},
            13: {"name":"Sortie K10",   "mode":"output", "value":False},
            19: {"name":"Sortie K11",   "mode":"output", "value":False},
            26: {"name":"Sortie K12",   "mode":"output", "value":False},
            21: {"name":"Sortie K13",   "mode":"output", "value":False},
            20: {"name":"Sortie K14",   "mode":"output", "value":False},
            16: {"name":"Sortie K15",   "mode":"output", "value":False},
            12: {"name":"Sortie K16",   "mode":"output", "value":False},
            # ── Entrées TOR 1–8 ──────────────────────────────────────────────
            14: {"name":"Entrée TOR 1", "mode":"input",  "value":False},
            15: {"name":"Entrée TOR 2", "mode":"input",  "value":False},
            18: {"name":"Entrée TOR 3", "mode":"input",  "value":False},
            23: {"name":"Entrée TOR 4", "mode":"input",  "value":False},
            24: {"name":"Entrée TOR 5", "mode":"input",  "value":False},
            25: {"name":"Entrée TOR 6", "mode":"input",  "value":False},
             8: {"name":"Entrée TOR 7", "mode":"input",  "value":False},
             7: {"name":"Entrée TOR 8", "mode":"input",  "value":False},
        }

        # Mémoires booléennes M0–M31
        self.memory: dict = {f"M{i}": False for i in range(32)}

        # ── Entrées analogiques ──────────────────────────────────────────────
        # 12 sondes PT100 via 3× ADS1115 (0x48/0x49/0x4A) + pont div. 10kΩ/3.3V
        # ADS0(0x48) → ANA0..ANA3, ADS1(0x49) → ANA4..ANA7, ADS2(0x4A) → ANA8..ANA11
        ADS_ADDR = {0:"0x48", 1:"0x49", 2:"0x4A"}
        self.analog: dict = {
            f"ANA{i}": {
                "name":      f"Sonde {i+1}",
                "type":      "ads1115_pt100",
                "ads_addr":  ADS_ADDR[i // 4],
                "channel":   i % 4,
                "celsius":   20.0,
                "voltage":   0.55,
                "unit":      "°C",
                "sim_value": -1.0,   # -1 = override °C direct (pas de recalcul NTC/PT100)
                "probe":     "PT100",
                "r_ref":     10000.0,
                "vcc":       3.3,
            }
            for i in range(12)
        }

        # Registres flottants RF0–RF15 (analogues des bits mémoires pour les float)
        self.registers: dict = {f"RF{i}": 0.0 for i in range(256)}  # FIX: RF0..RF255

        # PID states
        self.pids: dict = {}

        # Timers et compteurs
        self.timers:   dict = {}
        self.counters: dict = {}

        self.cycle_count:  int = 0
        self.scan_time_ms: int = 100
        self._wdog = None          # watchdog /dev/watchdog (initialisé au démarrage)
        self.last_error:   Optional[str] = None
        self.cycle_logs:   list = []

        # Variables DV et AV nommées (modifiables par l'opérateur)
        self.dv_vars: dict = {}
        self.av_vars: dict = {}

        # Drivers hardware (initialisés sur RPi)
        self._max31865_drivers: dict = {}  # channel -> driver
        self._ads1115_driver = None

        # Forçages manuels — non écrasés par le cycle PLC
        self._gpio_force: dict = {}   # {pin_int: bool}
        self._dv_force:   dict = {}   # {varname_lower: bool}

    # ════════════════════════════════════════════════════════════════
    # LECTURE / ÉCRITURE SIGNAUX
    # ════════════════════════════════════════════════════════════════
    def read_signal(self, ref) -> bool:
        """Lit un signal booléen (GPIO, mémoire M*, registre RF* ou variable DV nommée)."""
        if isinstance(ref, int):
            return self.gpio.get(ref, {}).get("value", False)
        if isinstance(ref, str):
            if ref.startswith("M"):
                return self.memory.get(ref, False)
            # Registre RF* utilisé comme condition booléenne (ex: runtimecnt condition="RF4")
            if ref.startswith("RF"):
                return bool(self.registers.get(ref, 0.0))
            # Variable DV nommée — recherche insensible à la casse
            # (le canvas stocke "TOR1" mais _on_dv_write enregistre "tor1")
            if hasattr(self, '_backup_store'):
                if ref in self._backup_store:
                    return bool(self._backup_store[ref])
                ref_lc = ref.lower()
                if ref_lc in self._backup_store:
                    return bool(self._backup_store[ref_lc])
            # Fallback : dv_vars (mis à jour directement par _on_dv_write)
            if hasattr(self, 'dv_vars'):
                if ref in self.dv_vars:
                    return bool(self.dv_vars[ref])
                ref_lc = ref.lower()
                if ref_lc in self.dv_vars:
                    return bool(self.dv_vars[ref_lc])
        return False

    def read_analog(self, ref: str) -> float:
        """Lit une valeur analogique (température °C, registre RF*, ou variable AV nommée)."""
        if not ref:
            return 0.0
        if ref in self.analog:
            return self.analog[ref].get("celsius") or self.analog[ref].get("value", 0.0)
        if ref in self.registers:
            return self.registers[ref]
        # Variable AV nommée — essai casse exacte d'abord
        if hasattr(self, '_backup_store') and ref in self._backup_store:
            v = self._backup_store[ref]
            if not isinstance(v, bool):   # les bool sont des DV, pas des AV
                return float(v)
        # FIX : set_backup_value / write_av normalisent en minuscules
        # → fallback insensible à la casse pour les noms mixtes (ex: "Prog_Heure_Debut_L")
        ref_lc = ref.lower()
        if ref_lc != ref:
            if hasattr(self, '_backup_store') and ref_lc in self._backup_store:
                v = self._backup_store[ref_lc]
                if not isinstance(v, bool):
                    return float(v)
            if hasattr(self, 'av_vars') and ref_lc in self.av_vars:
                return float(self.av_vars[ref_lc])
        return 0.0

    def write_signal(self, ref, value: bool):
        """Écrit un signal booléen : GPIO int, bit mémoire M*, ou registre RF*.
        Les RF* booléens (od_ref) sont stockés comme 1.0/0.0 dans registers."""
        if isinstance(ref, int):
            # ── Forçage manuel : le cycle PLC ne peut pas écraser ────────────
            if ref in self._gpio_force:
                value = self._gpio_force[ref]
            with self._lock:
                if ref in self.gpio:
                    self.gpio[ref]["value"] = bool(value)
        elif isinstance(ref, str) and ref.startswith("M"):
            with self._lock:
                self.memory[ref] = bool(value)
        elif isinstance(ref, str) and ref.startswith("RF"):
            # FIX CRITIQUE : od_ref = RF* → écrire dans registers comme 1.0/0.0
            with self._lock:
                self.registers[ref] = 1.0 if value else 0.0

    def write_register(self, ref: str, value: float):
        if ref and ref.startswith("RF"):
            with self._lock:
                self.registers[ref] = float(value)

    # ════════════════════════════════════════════════════════════════
    # LECTURE HARDWARE (RPi réel)
    # ════════════════════════════════════════════════════════════════
    def _init_hardware(self):
        """Initialise smbus2 pour les 3 ADS1115 sur I²C bus 1."""
        try:
            import smbus2
            self._smbus = smbus2.SMBus(1)
            self._smbus_ok = True
        except ImportError:
            self._smbus = None; self._smbus_ok = False
        except Exception:
            self._smbus = None; self._smbus_ok = False

    def _ads_read_voltage(self, addr: int, channel: int) -> float:
        """Lit un canal ADS1115 via smbus2 avec polling OS bit."""
        import time as _t
        MUX   = [0x4000, 0x5000, 0x6000, 0x7000]
        DR250 = 0x00C0  # 250 SPS → 4ms conversion
        cfg   = (0x8000 | MUX[channel] | 0x0200 | 0x0100 | DR250 | 0x0003)
        self._smbus.write_i2c_block_data(addr, 0x01, [(cfg>>8)&0xFF, cfg&0xFF])
        # Attendre fin de conversion via bit OS
        _t.sleep(0.005)
        t0 = _t.monotonic()
        while _t.monotonic() - t0 < 0.020:
            cfg_r = self._smbus.read_i2c_block_data(addr, 0x01, 2)
            if (cfg_r[0] << 8 | cfg_r[1]) & 0x8000:
                break
            _t.sleep(0.001)
        raw = self._smbus.read_i2c_block_data(addr, 0x00, 2)
        v   = (raw[0] << 8) | raw[1]
        if v > 0x7FFF: v -= 0x10000
        return v * 4.096 / 32768.0

    def _voltage_to_celsius(self, vm: float, probe="NTC10K", r_ref=10000.0, vcc=3.3) -> float:
        """Convertit tension pont diviseur en °C.
        Supporte : PT100, PT1000, NTC10K (Steinhart-Hart Beta=3950)
        """
        import math as _math
        if vm <= 0.001 or vm >= vcc - 0.001:
            return float("nan")
        rx = vm * r_ref / (vcc - vm)
        p  = probe.upper().replace("-","").replace(" ","")
        if p in ("NTC10K","NTC","NTC10"):
            R0, T0, B = 10000.0, 298.15, 3950.0
            if rx <= 0: return float("nan")
            inv_T = (1.0/T0) + (1.0/B) * _math.log(rx/R0)
            return (1.0/inv_T - 273.15) if inv_T > 0 else float("nan")
        elif p == "PT1000":
            return (rx - 1000.0) / (1000.0 * 0.00385)
        else:  # PT100
            return (rx - 100.0) / (100.0 * 0.00385)

    def _read_hardware_analogs(self):
        """Lit les 12 canaux ADS1115 via smbus2."""
        ADS_ADDR = [0x48, 0x49, 0x4A]   # 0x48→ANA0-3 (Sondes1-4), 0x49→ANA4-7 (Sondes5-8)
        for i in range(12):
            key  = f"ANA{i}"
            info = self.analog.get(key)
            if not info: continue
            addr = ADS_ADDR[i // 4]
            ch   = i % 4
            if getattr(self, "_smbus_ok", False):
                try:
                    vm   = self._ads_read_voltage(addr, ch)
                    temp = self._voltage_to_celsius(vm, info.get("probe","NTC10K"),
                                                    info.get("r_ref",10000.0),
                                                    info.get("vcc",3.3))
                    with self._lock:
                        self.analog[key]["voltage"] = round(vm, 4)
                        self.analog[key]["celsius"] = round(temp, 2) if temp==temp else None
                except Exception:
                    pass
            else:
                # Simulation : utiliser celsius forcé ou calculer depuis tension
                sim_val = info.get("sim_value", 0.55)
                if sim_val == -1.0:
                    # Override direct °C — ne pas recalculer
                    pass  # celsius déjà forcé dans analog[key]["celsius"]
                else:
                    vm   = sim_val
                    temp = self._voltage_to_celsius(vm, info.get("probe","NTC10K"),
                                                    info.get("r_ref",10000.0),
                                                    info.get("vcc",3.3))
                    with self._lock:
                        self.analog[key]["voltage"] = round(vm, 4)
                        self.analog[key]["celsius"] = round(temp, 2) if temp==temp else None


    # ════════════════════════════════════════════════════════════════
    # CONDITIONS
    # ════════════════════════════════════════════════════════════════
    def eval_cond(self, cond, default_if_none: bool = True) -> bool:
        """Évalue une condition booléenne.
        
        default_if_none : valeur retournée si cond est None/absent.
          True  = pas de condition → toujours actif (COIL, SET…)
          False = port optionnel non câblé → inactif (SEL.G, VALVE3V.cond_dec…)
        """
        if cond is None:
            return default_if_none
        # FIX: condition stockée comme string brute (ex: "RUN_CPT_SOL", "RF4")
        if isinstance(cond, str):
            cond = {"type": "input", "ref": cond}
        if not cond:          # dict vide {} ou liste vide []
            return default_if_none
        t = cond.get("type", "input")
        if t == "input":
            v = self.read_signal(cond.get("ref"))
            return not v if cond.get("negate") else v
        if t == "and":
            return all(self.eval_cond(c) for c in cond.get("conditions", []))
        if t == "or":
            return any(self.eval_cond(c) for c in cond.get("conditions", []))
        if t == "not":
            return not self.eval_cond(cond.get("condition", {}))
        if t == "timer_done":
            return self.timers.get(cond["id"], {}).get("done", False)
        if t == "counter_done":
            return self.counters.get(cond["id"], {}).get("done", False)
        if t == "analog_gt":
            return self.read_analog(cond["ref"]) > cond.get("threshold", 0)
        if t == "analog_lt":
            return self.read_analog(cond["ref"]) < cond.get("threshold", 0)
        if t == "analog_ge":
            return self.read_analog(cond["ref"]) >= cond.get("threshold", 0)
        if t == "analog_le":
            return self.read_analog(cond["ref"]) <= cond.get("threshold", 0)
        if t == "analog_eq":
            return abs(self.read_analog(cond["ref"]) - cond.get("threshold", 0)) < 0.5
        return False

    # ════════════════════════════════════════════════════════════════
    # EXÉCUTION D'UN BLOC
    # ════════════════════════════════════════════════════════════════
    def write_bool_out(self, ref, value: bool):
        """Écrit une sortie booléenne : GPIO int, bit M*, ou variable DV nommée."""
        if ref is None:
            return
        if isinstance(ref, int) or (isinstance(ref, str) and ref.startswith("M")):
            self.write_signal(ref, value)
        elif isinstance(ref, str) and ref:
            # Variable DV nommée → backup_store
            self.set_backup_value(ref, bool(value))

    def write_dv(self, varname: str, value: bool):
        """Écrit une variable DV nommée (blocs métier : plancher, chaudière, solar…).
        Alias de write_bool_out adapté aux noms de DV string.
        Accepte aussi GPIO int ou bit M* pour la compatibilité."""
        if varname is None:
            return
        if isinstance(varname, int) or (isinstance(varname, str) and varname.startswith("M")):
            self.write_signal(varname, bool(value))
        elif isinstance(varname, str) and varname:
            self.set_backup_value(varname.lower(), bool(value))

    def write_av(self, varname: str, value: float):
        """Écrit une variable AV analogique nommée (blocs métier).
        Accepte RF* (registre) ou nom de variable AV libre."""
        if varname is None:
            return
        if isinstance(varname, str) and varname.startswith("RF"):
            self.write_register(varname, float(value))
        elif isinstance(varname, str) and varname:
            self.set_backup_value(varname.lower(), float(value))

    def exec_block(self, block: dict, dt_ms: float) -> Optional[str]:
        btype = (block.get("type") or "").lower()  # FIX: normalisation casse (canvas stocke uppercase)
        bid   = block.get("id", "?")
        out   = block.get("output")

        # ── Booléens ──────────────────────────────────────────────
        # ── CONN : connecteur numéroté — propage le signal entre blocs ──────────
        if btype == "conn":
            reg_in_c  = block.get("reg_in")
            reg_out_c = block.get("reg_out")
            num_c     = block.get("num", block.get("params", {}).get("num"))
            if not hasattr(self, 'page_signals'): self.page_signals = {}
            if reg_in_c and str(reg_in_c).startswith("RF"):
                val_c = self.registers.get(reg_in_c, 0.0)
                with self._lock:
                    self.page_signals[f"__conn_{num_c}"] = val_c
            elif reg_out_c and str(reg_out_c).startswith("RF"):
                val_c = self.page_signals.get(f"__conn_{num_c}", 0.0)
                with self._lock:
                    self.registers[reg_out_c] = val_c
            return

        # ── CONN_TX : émetteur — écrit dans le bus de signaux numéroté ──────────
        if btype == "conn_tx":
            reg_in_c = block.get("reg_in")
            num_c    = block.get("num", block.get("params", {}).get("num"))
            if not hasattr(self, 'page_signals'): self.page_signals = {}
            if reg_in_c and str(reg_in_c).startswith("RF"):
                val_c = self.registers.get(reg_in_c, 0.0)
                with self._lock:
                    self.page_signals[f"__conn_{num_c}"] = val_c
            return

        # ── CONN_RX : récepteur — lit depuis le bus de signaux numéroté ──────────
        if btype == "conn_rx":
            reg_out_c = block.get("reg_out")
            num_c     = block.get("num", block.get("params", {}).get("num"))
            if not hasattr(self, 'page_signals'): self.page_signals = {}
            if reg_out_c and str(reg_out_c).startswith("RF"):
                val_c = self.page_signals.get(f"__conn_{num_c}", 0.0)
                with self._lock:
                    self.registers[reg_out_c] = val_c
            return

        if btype in ("coil", "set", "reset"):
            cond = self.eval_cond(block.get("condition"))
            if btype == "coil":
                self.write_bool_out(out, cond)
                return f"COIL {out}={'1' if cond else '0'}"
            if btype == "set" and cond:
                self.write_bool_out(out, True)
                return f"SET {out}=1"
            if btype == "reset" and cond:
                self.write_bool_out(out, False)
                return f"RST {out}=0"
            return None

        # ── Timer (ton = alias RPi de timer) ──────────────────────
        if btype == "ton":
            btype = "timer"   # normalisation : délégue au bloc ci-dessous
        if btype == "timer":
            preset = block.get("preset_ms", 1000)
            cond   = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"preset":preset,"acc":0,"running":False,"done":False}
            t = self.timers[bid]
            if cond:
                t["running"] = True
                t["acc"]     = min(t["acc"] + dt_ms, preset)
                t["done"]    = t["acc"] >= preset
            else:
                t["running"] = False
                t["acc"]     = 0
                t["done"]    = False
            if out:
                self.write_signal(out, t["done"])
            return f"TON {bid} {t['acc']:.0f}/{preset}ms done={t['done']}"

        # ── TOF — temporisation au déclenchement ─────────────────────
        if btype == "tof":
            preset = block.get("preset_ms", 1000)
            cond   = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"preset":preset,"acc":0,"done":True,"_prev":False}
            t = self.timers[bid]
            if cond:
                t["acc"]  = 0
                t["done"] = True   # sortie active tant que IN=1
            else:
                t["acc"]  = min(t["acc"] + dt_ms, preset)
                t["done"] = t["acc"] < preset   # reste actif pendant le délai
            t["_prev"] = cond
            if out: self.write_signal(out, t["done"])
            return f"TOF {bid} {t['acc']:.0f}/{preset}ms done={t['done']}"

        # ── TP — impulsion à durée fixe ──────────────────────────────
        if btype == "tp":
            preset = block.get("preset_ms", 1000)
            cond   = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"preset":preset,"acc":0,"active":False,"_prev":False}
            t = self.timers[bid]
            if cond and not t["_prev"] and not t["active"]:
                t["active"] = True; t["acc"] = 0
            if t["active"]:
                t["acc"] += dt_ms
                if t["acc"] >= preset: t["active"] = False
            t["_prev"] = cond
            if out: self.write_signal(out, t["active"])
            return f"TP {bid} {t['acc']:.0f}/{preset}ms active={t['active']}"

        # ── Compteur (CTU) — alias ctu accepté ────────────────────
        if btype == "ctu":
            btype = "counter"   # normalisation : délégue au bloc ci-dessous
        if btype == "counter":
            preset = block.get("preset", 10)
            # Accepte cu_cond (serveur), cu, ou condition (PC)
            cond   = self.eval_cond(block.get("cu_cond") or block.get("cu") or block.get("condition"))
            rst    = self.eval_cond(block.get("reset_condition")) if block.get("reset_condition") else False
            if bid not in self.counters:
                self.counters[bid] = {"preset":preset,"acc":0,"done":False,"_prev":False}
            c = self.counters[bid]
            if rst:
                c["acc"] = 0; c["done"] = False
            elif cond and not c["_prev"]:
                c["acc"] += 1
                if c["acc"] >= preset:
                    c["done"] = True
            c["_prev"] = cond
            if out:
                self.write_signal(out, c["done"])
            return f"CTU {bid} {c['acc']}/{preset} done={c['done']}"

        # ── Compteur descendant (CTD) ──────────────────────────────────
        if btype == "ctd":
            preset = block.get("preset", 10)
            # ld et cd : ports optionnels — absent = non câblé = False
            cd  = self.eval_cond(block.get("cd_cond"), default_if_none=False)
            ld  = self.eval_cond(block.get("ld_cond"), default_if_none=False)
            if bid not in self.counters:
                self.counters[bid] = {"preset": preset, "acc": preset, "done": False, "_prev": False}
            c = self.counters[bid]
            if ld:
                c["acc"] = preset; c["done"] = False
            elif cd and not c["_prev"]:
                c["acc"] = max(0, c["acc"] - 1)
                c["done"] = c["acc"] <= 0
            c["_prev"] = cd
            if out: self.write_signal(out, c["done"])
            cv_ref = block.get("cv_ref")
            if cv_ref: self.write_register(cv_ref, float(c["acc"]))
            return f"CTD {bid} {c['acc']}/{preset} done={c['done']}"

        # ── Compteur bidirectionnel (CTUD) ─────────────────────────────
        if btype == "ctud":
            preset = block.get("preset", 10)
            # Tous les ports optionnels : absent = non câblé = False
            cu  = self.eval_cond(block.get("cu_cond"),        default_if_none=False)
            cd  = self.eval_cond(block.get("cd_cond"),        default_if_none=False)
            rst = self.eval_cond(block.get("reset_condition"), default_if_none=False)
            ld  = self.eval_cond(block.get("ld_cond"),         default_if_none=False)
            if bid not in self.counters:
                self.counters[bid] = {"preset": preset, "acc": 0, "qu": False, "qd": False, "_pcu": False, "_pcd": False}
            c = self.counters[bid]
            if rst:   c["acc"] = 0
            elif ld:  c["acc"] = preset
            else:
                if cu and not c["_pcu"]: c["acc"] += 1
                if cd and not c["_pcd"]: c["acc"] = max(0, c["acc"] - 1)
            c["_pcu"] = cu; c["_pcd"] = cd
            c["qu"] = c["acc"] >= preset
            c["qd"] = c["acc"] <= 0
            if out: self.write_signal(out, c["qu"])
            cv_ref = block.get("cv_ref")
            if cv_ref: self.write_register(cv_ref, float(c["acc"]))
            return f"CTUD {bid} {c['acc']}/{preset} QU={c['qu']} QD={c['qd']}"

        # ── Comparaison booléenne ──────────────────────────────────
        if btype == "compare":
            def _rv(ref):
                if isinstance(ref, str) and (ref.startswith("RF") or ref.startswith("ANA")):
                    return self.read_analog(ref)
                return float(self.read_signal(ref)) if isinstance(ref,(int,str)) else 0.0
            val_a  = _rv(block.get("ref_a") or block.get("in1"))
            ref_b  = block.get("ref_b") or block.get("in2")
            val_b  = _rv(ref_b) if ref_b else float(block.get("val_b", 0))
            op     = block.get("op", "eq")
            ops    = {"eq": abs(val_a-val_b)<1e-9, "neq": abs(val_a-val_b)>=1e-9,
                      "gt": val_a>val_b, "lt": val_a<val_b,
                      "ge": val_a>=val_b, "le": val_a<=val_b}
            result = ops.get(op, False)
            if out: self.write_signal(out, result)
            return f"CMP {val_a:.2f} {op} {val_b:.2f}=>{result}"

        # Alias GT/GE/LT/EQ comme blocs autonomes (support RF et GPIO)
        if btype in ("gt", "ge", "lt", "le", "eq", "ne"):
            def _rv2(ref):
                if isinstance(ref, str) and (ref.startswith("RF") or ref.startswith("ANA")):
                    return self.read_analog(ref)
                return float(self.read_signal(ref)) if ref else 0.0
            a = _rv2(block.get("in1") or block.get("ref_a"))
            b_ref = block.get("in2") or block.get("ref_b")
            b = _rv2(b_ref) if b_ref else float(block.get("val_b", 0))
            r = {"gt":a>b,"ge":a>=b,"lt":a<b,"le":a<=b,"eq":abs(a-b)<1e-9,"ne":abs(a-b)>=1e-9}.get(btype, False)
            if out: self.write_signal(out, r)


        # ── Lecture analogique PT100/PT1000 ─────────────────────────
        if btype == "pt_in":
            key = block.get("analog_ref", "PT0")
            # En simulation, utiliser sim_value
            value = self.analog.get(key, {}).get("value", 0.0)
            reg_out = block.get("reg_out")   # ex: "RF0"
            if reg_out:
                self.write_register(reg_out, value)
            return f"PT_IN {key}={value:.2f}°C"

        # ── Lecture analogique générique (ADS1115) ──────────────────
        if btype == "ana_in":
            key   = block.get("analog_ref", "ANA0")
            value = self.analog.get(key, {}).get("value", 0.0)
            reg_out = block.get("reg_out")
            if reg_out:
                self.write_register(reg_out, value)
            return f"ANA_IN {key}={value:.4f}"

        # ── Comparaison flottante (seuil) ───────────────────────────
        if btype == "compare_f":
            ref       = block.get("reg_ref", "RF0")    # registre ou analog_ref
            threshold = float(block.get("threshold", 0.0))
            hyst      = float(block.get("hysteresis", 0.0))
            op        = block.get("op", "gt")
            val = self.read_analog(ref)
            ops = {
                "gt": val > threshold,
                "lt": val < threshold,
                "ge": val >= threshold,
                "le": val <= threshold,
                "eq": abs(val - threshold) < max(hyst, 0.1),
            }
            result = ops.get(op, False)
            if out:
                self.write_signal(out, result)
            return f"CMP_F {ref}={val:.2f} {op} {threshold}=>{result}"

        # ── Régulateur PID ──────────────────────────────────────────
        if btype == "pid":
            bid_pid  = bid
            # Accepte "sp" (server/canvas) ou "setpoint" (PC)
            sp       = float(block.get("setpoint") if block.get("setpoint") is not None else block.get("sp", 0.0))
            # Consigne dynamique via registre sp_ref (prioritaire si sp==0 et sp_ref câblé)
            sp_ref_dyn = block.get("sp_ref", "")
            if sp == 0.0 and sp_ref_dyn and isinstance(sp_ref_dyn, str) and sp_ref_dyn.startswith("RF"):
                sp = self.read_analog(sp_ref_dyn)
            # Accepte "pv" (server/canvas) ou "pv_ref" (PC)
            pv_ref   = block.get("pv_ref") or block.get("pv", "RF0")
            kp       = float(block.get("kp", 1.0))
            ki       = float(block.get("ki", 0.0))
            kd       = float(block.get("kd", 0.0))
            out_min  = float(block.get("out_min", 0.0))
            out_max  = float(block.get("out_max", 100.0))
            # Accepte "reg_out" (PC) ou "output" (server écrit sur out directement)
            reg_out  = block.get("reg_out", "RF1")
            en       = self.eval_cond(block.get("enable_condition")) if block.get("enable_condition") else True

            pv = self.read_analog(pv_ref)

            if bid_pid not in self.pids:
                self.pids[bid_pid] = {"integral":0.0,"prev_err":0.0,"output":0.0}
            pid = self.pids[bid_pid]

            dt_s = max(dt_ms / 1000.0, 0.001)
            if en:
                err = sp - pv
                # Anti-windup : clamp l'intégrale dans [out_min, out_max] (aligné serveur)
                pid["integral"] = max(out_min, min(out_max,
                    pid["integral"] + ki * err * dt_s))
                derivative = kd * (err - pid["prev_err"]) / dt_s
                output = kp * err + pid["integral"] + derivative
                output = max(out_min, min(out_max, output))
                pid["output"]   = output
                pid["prev_err"] = err
            else:
                pid["integral"] = 0.0
                pid["output"]   = out_min

            self.write_register(reg_out, pid["output"])
            if out:
                # Sortie booléenne si > 50% OU écriture directe registre (si out est un RF*)
                if isinstance(out, str) and out.startswith("RF"):
                    self.write_register(out, pid["output"])
                else:
                    self.write_signal(out, pid["output"] > (out_max * 0.5))
            return f"PID {bid_pid} SP={sp} PV={pv:.2f} OUT={pid['output']:.1f}%"

        # ── Mise à l'échelle analogique ─────────────────────────────
        if btype == "scale":
            # Convertit une valeur brute en valeur ingénierie
            # Accepte "input" (server/canvas) ou "reg_ref" (PC)
            src   = block.get("reg_ref") or block.get("input", "RF0")
            dst   = block.get("reg_out") or out or "RF1"
            in_lo = float(block.get("in_lo", 0.0))
            in_hi = float(block.get("in_hi", 5.0))
            ou_lo = float(block.get("out_lo", 0.0))
            ou_hi = float(block.get("out_hi", 100.0))
            raw   = self.read_analog(src)
            if in_hi != in_lo:
                scaled = ou_lo + (raw - in_lo) / (in_hi - in_lo) * (ou_hi - ou_lo)
                scaled = max(ou_lo, min(ou_hi, scaled))
            else:
                scaled = ou_lo
            self.write_register(dst, scaled)
            return f"SCALE {src}={raw:.3f} → {dst}={scaled:.3f}"

        # ── Nouveaux blocs ────────────────────────────────────────
        if btype == "sensor":
            ref  = block.get("ref", "ANA0")
            corr = float(block.get("correction", 0.0))
            val  = self.read_analog(ref) + corr
            dst  = block.get("reg_out", "RF0")
            if dst: self.write_register(dst, val)

        if btype in ("add", "sub", "mul", "div"):
            def _rr(k): return self.read_analog(block.get(k, "RF0"))
            a   = _rr("reg_a")
            b_v = _rr("reg_b")
            if btype == "add":   res = a + b_v
            elif btype == "sub": res = a - b_v
            elif btype == "mul": res = a * b_v
            else:                res = a / b_v if abs(b_v) > 1e-12 else 0.0
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, res)
            return f"{btype.upper()} {a:.2f},{b_v:.2f}=>{res:.2f}"

        # ── Calcul mathématique (ABS, MIN, MAX, MOD, SQRT, POW) ────────
        if btype == "abs":
            val = self.read_analog(block.get("reg_in", "RF0"))
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, abs(val))
            return f"ABS {val:.2f}=>{abs(val):.2f}"

        if btype == "min":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            res = min(a, b)
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, res)
            return f"MIN {a:.2f},{b:.2f}=>{res:.2f}"

        if btype == "max":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            res = max(a, b)
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, res)
            return f"MAX {a:.2f},{b:.2f}=>{res:.2f}"

        if btype == "mod":
            a = self.read_analog(block.get("reg_a", "RF0"))
            b = self.read_analog(block.get("reg_b", "RF1"))
            res = math.fmod(a, b) if abs(b) > 1e-12 else 0.0
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, res)
            return f"MOD {a:.2f}%{b:.2f}=>{res:.2f}"

        if btype == "sqrt":
            val = self.read_analog(block.get("reg_in", "RF0"))
            res = math.sqrt(max(0.0, val))
            dst = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, res)
            return f"SQRT {val:.2f}=>{res:.2f}"

        if btype == "pow":
            base = self.read_analog(block.get("reg_a", "RF0"))
            exp  = self.read_analog(block.get("reg_b", "RF1"))
            try:    res = math.pow(base, exp)
            except: res = 0.0
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, res)
            return f"POW {base:.2f}^{exp:.2f}=>{res:.2f}"

        # ── Clamp / Limit ───────────────────────────────────────────────
        if btype in ("clamp", "limit", "clamp_a"):
            val  = self.read_analog(block.get("reg_in", "RF0"))
            lo   = float(block.get("lo",  0.0))
            hi   = float(block.get("hi", 100.0))
            res  = max(lo, min(hi, val))
            dst  = block.get("reg_out", "RF1")
            if dst: self.write_register(dst, res)
            if out: self.write_signal(out, res != val)  # TRUE si clampé
            return f"CLAMP {val:.2f}→{res:.2f} [{lo},{hi}]"

        if btype == "sel":
            # G est optionnel : non câblé = False → sélectionne IN0
            g   = self.eval_cond(block.get("sel_cond"), default_if_none=False)
            in0 = self.read_analog(block.get("in0", "RF0"))
            in1 = self.read_analog(block.get("in1", "RF1"))
            res = in1 if g else in0
            dst = block.get("reg_out", "RF2")
            if dst: self.write_register(dst, res)
            return f"SEL G={g} =>{res:.2f}"

        # ── Filtre passe-bas 1er ordre (FILT1) ──────────────────────────
        if btype == "filt1":
            val  = self.read_analog(block.get("reg_in", "RF0"))
            tc   = float(block.get("tc_s", 10.0))  # constante de temps en secondes
            dst  = block.get("reg_out", "RF1")
            if bid not in self.pids:
                self.pids[bid] = {"y": val}
            p = self.pids[bid]
            dt_s = dt_ms / 1000.0
            alpha = dt_s / (tc + dt_s) if (tc + dt_s) > 0 else 1.0
            p["y"] = p["y"] + alpha * (val - p["y"])
            if dst: self.write_register(dst, p["y"])
            return f"FILT1 in={val:.2f} y={p['y']:.2f} tc={tc}s"

        # ── Moyenne glissante (AVG) ─────────────────────────────────────
        if btype == "avg":
            val = self.read_analog(block.get("reg_in", "RF0"))
            n   = max(1, int(block.get("n", 10)))
            dst = block.get("reg_out", "RF1")
            if bid not in self.pids:
                self.pids[bid] = {"buf": [val] * n, "idx": 0}
            p = self.pids[bid]
            if len(p["buf"]) != n:
                p["buf"] = [val] * n; p["idx"] = 0
            p["buf"][p["idx"] % n] = val
            p["idx"] += 1
            res = sum(p["buf"]) / n
            if dst: self.write_register(dst, res)
            return f"AVG in={val:.2f} avg={res:.2f} n={n}"

        # ── Intégrateur (INTEG) ─────────────────────────────────────────
        if btype == "integ":
            val    = self.read_analog(block.get("reg_in", "RF0"))
            reset  = self.eval_cond(block.get("reset_cond")) if block.get("reset_cond") else False
            ki     = float(block.get("ki", 1.0))
            lo     = float(block.get("lo", -1e9))
            hi     = float(block.get("hi",  1e9))
            dst    = block.get("reg_out", "RF1")
            if bid not in self.pids:
                self.pids[bid] = {"acc": 0.0}
            p = self.pids[bid]
            if reset:
                p["acc"] = 0.0
            else:
                p["acc"] += val * ki * (dt_ms / 1000.0)
                p["acc"]  = max(lo, min(hi, p["acc"]))
            if dst: self.write_register(dst, p["acc"])
            if out: self.write_signal(out, p["acc"] >= hi)
            return f"INTEG in={val:.2f} acc={p['acc']:.2f}"

        # ── Dérivateur (DERIV) ──────────────────────────────────────────
        if btype == "deriv":
            val = self.read_analog(block.get("reg_in", "RF0"))
            kd  = float(block.get("kd", 1.0))
            dst = block.get("reg_out", "RF1")
            if bid not in self.pids:
                self.pids[bid] = {"prev": val}
            p = self.pids[bid]
            dt_s = dt_ms / 1000.0
            res  = kd * (val - p["prev"]) / dt_s if dt_s > 0 else 0.0
            p["prev"] = val
            if dst: self.write_register(dst, res)
            return f"DERIV in={val:.2f} d={res:.2f}"

        # ── Zone morte (DEADB) ──────────────────────────────────────────
        if btype == "deadb":
            val  = self.read_analog(block.get("reg_in", "RF0"))
            dead = float(block.get("dead", 1.0))   # demi-bande morte
            dst  = block.get("reg_out", "RF1")
            res  = 0.0 if abs(val) <= dead else (val - math.copysign(dead, val))
            if dst: self.write_register(dst, res)
            if out: self.write_signal(out, abs(val) > dead)
            return f"DEADB in={val:.2f} dead=±{dead} out={res:.2f}"

        # ── Rampe (RAMP) ────────────────────────────────────────────────
        if btype == "ramp":
            target  = self.read_analog(block.get("reg_sp", "RF0"))  # consigne cible
            rate    = float(block.get("rate", 1.0))   # max variation par seconde
            dst     = block.get("reg_out", "RF1")
            if bid not in self.pids:
                self.pids[bid] = {"current": target}
            p = self.pids[bid]
            max_step = rate * (dt_ms / 1000.0)
            err = target - p["current"]
            if abs(err) <= max_step:
                p["current"] = target
            else:
                p["current"] += math.copysign(max_step, err)
            if dst: self.write_register(dst, p["current"])
            if out: self.write_signal(out, abs(p["current"] - target) < 0.01)
            return f"RAMP sp={target:.2f} out={p['current']:.2f} rate={rate}/s"

        # ── Hystérésis simple (HYST) ────────────────────────────────────
        if btype == "hyst":
            val  = self.read_analog(block.get("reg_in", "RF0"))
            sp   = float(block.get("sp", 50.0))
            band = float(block.get("band", 2.0))   # bande totale (±band/2)
            if bid not in self.timers:
                self.timers[bid] = {"state": False}
            st = self.timers[bid]
            if not st["state"]:
                if val >= sp + band / 2: st["state"] = True
            else:
                if val <= sp - band / 2: st["state"] = False
            if out: self.write_signal(out, st["state"])
            return f"HYST in={val:.2f} sp={sp} band={band} =>{st['state']}"

        # ── STOAP — écriture paramètre timer ───────────────────────────
        if btype == "stoap":
            val = self.read_analog(block.get("reg_in", "RF0"))
            varname = block.get("varname", "")
            # Format "timerID.TimerTime" → modifier le preset du timer
            if varname and "." in varname:
                tid, attr = varname.split(".", 1)
                attr_low  = attr.lower()
                if tid in self.timers:
                    if "preset" in attr_low or "timertime" in attr_low:
                        self.timers[tid]["preset"] = max(0.0, float(val))
                        return f"STOAP {tid}.preset={val:.0f}ms"
            return f"STOAP {varname}={val:.2f}"

        if btype == "mux":
            # Index depuis un registre RF (entier) ou un bit M (0/1)
            idx_ref = block.get("idx_ref", "RF0")
            if isinstance(idx_ref, str) and idx_ref.startswith("M"):
                idx = int(self.memory.get(idx_ref, 0))
            elif isinstance(idx_ref, str) and idx_ref.startswith("RF"):
                idx = int(self.registers.get(idx_ref, 0))
            else:
                idx = 0
            n_in = block.get("n_in", 4)
            idx  = max(0, min(n_in - 1, idx))
            in_keys = [block.get(f"in{i}", f"RF{i}") for i in range(n_in)]
            src = in_keys[idx]
            val = self.read_analog(src)
            dst = block.get("reg_out", "RF4")
            if dst: self.write_register(dst, val)
            return f"MUX idx={idx} src={src} val={val:.2f}"

        # ── Comparateurs avec hystérésis (Comph / Compl) ─────────────
        if btype == "comph":
            # Seuil HAUT avec hystérésis : monte quand val >= high,
            # redescend seulement quand val < high - hyst
            val  = self.read_analog(block.get("ref", "RF0"))
            high = float(block.get("high", 80.0))
            hyst = float(block.get("hyst", 0.5))
            reg  = block.get("reg_out", "M0")
            if bid not in self.timers:
                self.timers[bid] = {"state": False}
            st = self.timers[bid]
            if not st["state"]:
                if val >= high:           st["state"] = True
            else:
                if val < (high - hyst):   st["state"] = False
            result = st["state"]
            if reg.startswith("M"):
                with self._lock: self.memory[reg] = result
            elif reg.startswith("RF"):
                self.write_register(reg, 1.0 if result else 0.0)
            if out: self.write_signal(out, result)
            return f"COMPH {block.get('ref')}={val:.2f} >={high}(hyst={hyst}) => {result}"

        if btype == "compl":
            # Seuil BAS avec hystérésis : monte quand val <= low,
            # redescend seulement quand val > low + hyst
            val  = self.read_analog(block.get("ref", "RF0"))
            low  = float(block.get("low", 10.0))
            hyst = float(block.get("hyst", 0.5))
            reg  = block.get("reg_out", "M1")
            if bid not in self.timers:
                self.timers[bid] = {"state": False}
            st = self.timers[bid]
            if not st["state"]:
                if val <= low:            st["state"] = True
            else:
                if val > (low + hyst):    st["state"] = False
            result = st["state"]
            if reg.startswith("M"):
                with self._lock: self.memory[reg] = result
            elif reg.startswith("RF"):
                self.write_register(reg, 1.0 if result else 0.0)
            if out: self.write_signal(out, result)
            return f"COMPL {block.get('ref')}={val:.2f} <={low}(hyst={hyst}) => {result}"

        if btype == "wait":
            delay_ms = float(block.get("delay_s", 5)) * 1000.0
            cond = self.eval_cond(block.get("condition") or block.get("in"))
            if bid not in self.timers:
                self.timers[bid] = {"acc": 0.0, "done": False}
            t = self.timers[bid]
            if cond: t["acc"] = min(t["acc"] + dt_ms, delay_ms); t["done"] = t["acc"] >= delay_ms
            else:    t["acc"] = 0.0; t["done"] = False
            if out: self.write_signal(out, t["done"])

        if btype == "waith":
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

        if btype == "pulse":
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

        if btype in ("sr", "sr_r", "sr_s"):
            # Ports optionnels : absent = non câblé = inactif (False)
            # Accepte set_cond (PC) ou s_cond (server), idem pour reset
            s   = self.eval_cond(block.get("set_cond") or block.get("s_cond"), default_if_none=False)
            r   = self.eval_cond(block.get("res_cond") or block.get("r_cond"), default_if_none=False)
            bit = block.get("bit", "M0")
            if bit not in self.memory:
                self.memory[bit] = False
            if btype in ("sr_r", "sr"):   # Reset prioritaire : R > S
                if r:    self.memory[bit] = False
                elif s:  self.memory[bit] = True
            else:                 # Set prioritaire : S > R
                if s:    self.memory[bit] = True
                elif r:  self.memory[bit] = False
            state = self.memory[bit]
            if out: self.write_signal(out, state)
            return f"{btype.upper()} {bit}={'1' if state else '0'} (S={s},R={r})"

        # ── RS — bascule RS simple (Set prioritaire sur entrée S) ────────
        if btype == "rs":
            s   = self.eval_cond(block.get("set_cond"), default_if_none=False)
            r   = self.eval_cond(block.get("res_cond"), default_if_none=False)
            bit = block.get("bit", "M0")
            if bit not in self.memory:
                self.memory[bit] = False
            # RS : S prioritaire sur R (Set wins)
            if s:    self.memory[bit] = True
            elif r:  self.memory[bit] = False
            state = self.memory[bit]
            if out: self.write_signal(out, state)
            return f"RS {bit}={'1' if state else '0'} (S={s},R={r})"

        # ── MOVE — copie valeur constante vers registre ───────────────────
        if btype == "move":
            cond = self.eval_cond(block.get("condition"))
            if cond and out:
                self.write_register(out, float(block.get("value", 0.0)))
                return f"MOVE {out}={block.get('value', 0.0)}"
            return None

        # ── AND / OR / XOR / NOT / INV — blocs logique câblés ────────────
        if btype in ("and", "or", "xor", "not", "inv", "nand", "nor"):
            def _gs(r):
                if r is None: return False
                if isinstance(r, int): return bool(self.read_signal(r))
                if isinstance(r, str) and r.startswith("M"):  return bool(self.read_signal(r))
                if isinstance(r, str) and r.startswith("RF"): return bool(self.read_analog(r))
                if isinstance(r, str): return bool(self.read_signal(r))
                return bool(r)
            # FIX : lire in1/in2 compilés par block_editor ou reg_a/reg_b (legacy)
            in1_key = block.get("in1") or block.get("input1") or block.get("reg_a") or block.get("in")
            in2_key = block.get("in2") or block.get("input2") or block.get("reg_b")
            i1 = _gs(in1_key)
            i2 = _gs(in2_key)
            if   btype == "and":              res = i1 and i2
            elif btype == "or":               res = i1 or  i2
            elif btype in ("not", "inv"):     res = not i1
            elif btype == "xor":              res = bool(i1) ^ bool(i2)
            elif btype == "nand":             res = not (i1 and i2)
            elif btype == "nor":              res = not (i1 or  i2)
            else:                             res = False
            # Écrire résultat dans reg_out RF* ET dans out (GPIO/M)
            reg_out_logic = block.get("reg_out") or block.get("out")
            if reg_out_logic and str(reg_out_logic).startswith("RF"):
                self.write_register(reg_out_logic, 1.0 if res else 0.0)
            if out: self.write_signal(out, res)
            return f"{btype.upper()} {reg_out_logic}={'1' if res else '0'} (i1={i1},i2={i2})"

        # ── STOAV — écriture valeur analogique vers variable AV nommée ────
        if btype == "stoav":
            reg_in  = block.get("reg_in")
            varname = block.get("varname", "av0")
            if reg_in is not None:
                val = self.read_analog(reg_in)
                self.set_backup_value(varname, float(val))
                return f"STOAV {varname}={val:.3f}"
            return f"STOAV {varname} (no input)"

        # ── BACKUP — registre non-volatile universel (float + bool) ──────────
        if btype == "backup":
            varname = block.get("varname", "backup0")
            bktype  = block.get("bktype", "float")
            default = block.get("default", False if bktype == "bool" else 0.0)
            val_ref = block.get("val_ref")
            val_out = block.get("val_out")

            if not hasattr(self, '_backup_store'):
                self._backup_store = {}; self._backup_dirty = False
                self._load_backup_store()
            if varname not in self._backup_store:
                self._backup_store[varname] = bool(default) if bktype == "bool" else float(default)

            if bktype == "bool":
                if val_ref is not None:
                    nv = bool(self.read_signal(val_ref))
                    if nv != self._backup_store.get(varname):
                        self._backup_store[varname] = nv; self._backup_dirty = True
                current = bool(self._backup_store.get(varname, bool(default)))
                if val_out is not None: self.write_bool_out(val_out, current)
                return f"BACKUP {varname}={'1' if current else '0'}"
            else:
                if val_ref is not None:
                    nv = self.read_analog(val_ref)
                    if abs(nv - float(self._backup_store.get(varname, float(default)))) > 1e-9:
                        self._backup_store[varname] = nv; self._backup_dirty = True
                current = float(self._backup_store.get(varname, float(default)))
                if val_out is not None:
                    if isinstance(val_out, str) and val_out.startswith("RF"):
                        self.write_register(val_out, current)
                    elif isinstance(val_out, str):
                        self.set_backup_value(val_out, current)
                return f"BACKUP {varname}={current:.3f}"

        # ── AV — variable analogique d'état (source pure) ───────────────────
        if btype == "av":
            varname = block.get("varname", "av0").lower()
            val_out = block.get("val_out") or block.get("reg_out")
            current = float(block.get("default", 0.0))
            # Lire depuis av_vars (valeur opérateur) en priorité
            if not hasattr(self, 'av_vars'): self.av_vars = {}
            if varname in self.av_vars:
                current = float(self.av_vars[varname])
            elif hasattr(self, '_backup_store') and varname in self._backup_store:
                current = float(self._backup_store[varname])
            if val_out and isinstance(val_out, str) and val_out.startswith("RF"):
                self.write_register(val_out, current)
            # Sortie booléenne directe si câblée (OUT → OUTPUT/MEM)
            if out is not None:
                self.write_bool_out(out, bool(current))
            return f"AV {varname}={current:.3f}"

        # ── BOOLEAN — table de vérité configurable ─────────────────────────
        if btype == "boolean":
            n_in  = int(block.get("n_in", 4))
            n_out = int(block.get("n_out", 1))
            tt    = block.get("truth_table") or []
            invert_o1 = bool(block.get("invert_o1", False))
            invert_o2 = bool(block.get("invert_o2", False))
            # Lire les entrées I1..In
            inputs = []
            for i in range(1, n_in + 1):
                ref = block.get(f"in{i}_ref")
                inputs.append(bool(self.read_signal(ref)) if ref is not None else False)
            # Index de ligne = somme des bits (I1=bit0, I2=bit1, ...)
            row_idx = sum(int(v) << i for i, v in enumerate(inputs))
            # Lire les sorties depuis la table
            row = tt[row_idx] if row_idx < len(tt) else [0] * n_out
            o1 = bool(row[0]) if len(row) > 0 else False
            o2 = bool(row[1]) if len(row) > 1 else False
            if invert_o1: o1 = not o1
            if invert_o2: o2 = not o2
            out1 = block.get("out1_ref")
            out2 = block.get("out2_ref")
            if out1 is not None: self.write_bool_out(out1, o1)
            if out2 is not None and n_out >= 2: self.write_bool_out(out2, o2)
            return f"BOOLEAN row={row_idx} O1={int(o1)}" + (f" O2={int(o2)}" if n_out >= 2 else "")

                # ── DV — variable booléenne d'état (source pure) ────────────────────
        if btype == "dv":
            varname = block.get("varname", "dv0").lower()
            default = block.get("default", False)
            if isinstance(default, str):
                default = default.strip().lower() == "true"
            else:
                default = bool(default)
            # Lire depuis dv_vars (valeur opérateur) en priorité
            if not hasattr(self, 'dv_vars'): self.dv_vars = {}
            if varname in self.dv_vars:
                current = bool(self.dv_vars[varname])
            elif hasattr(self, '_backup_store') and varname in self._backup_store:
                current = bool(self._backup_store.get(varname, default))
            else:
                current = default
            if varname.startswith("M"):
                with self._lock: self.memory[varname] = current
            # FIX : écrire dans reg_out RF* si présent (DV câblé vers OR/AND/CONN)
            reg_out_dv = block.get("reg_out")
            if reg_out_dv and str(reg_out_dv).startswith("RF"):
                self.write_register(reg_out_dv, 1.0 if current else 0.0)
            # Écrire la sortie : GPIO int, bit M*, ou variable DV nommée
            if out is not None:
                self.write_bool_out(out, current)
            return f"DV {varname}={'1' if current else '0'} reg={reg_out_dv}={current}"



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

            # ── Paramètres V3V ───────────────────────────────────────
            travel_time_s = float(block.get("travel_time_s", 133.0))
            v3v_deadband  = float(block.get("v3v_deadband",  1.5))
            ctrl_mode = block.get("ctrl_mode", "pid")
            kv3v      = float(block.get("kv3v", 20.0))
            sp_amb    = float(block.get("sp_amb", 19.0))

            if not hasattr(self, '_plancher_state'): self._plancher_state = {}
            st = self._plancher_state.setdefault(bid, {
                "integral": 0.0, "prev_err": 0.0, "v3v_pos": 0.0})

            if ctrl_mode == "prop" and t_depart is not None:
                # ── Mode PROP — proportionnel sur écart T départ ─────────────
                demande   = t_amb < sp_amb
                ecart_dep = sp - t_depart
                pid_out   = max(0.0, min(100.0, ecart_dep * kv3v)) if demande else 0.0
                if t_depart > max_depart: pid_out = 0.0
                st["integral"] = 0.0
            else:
                # ── Mode PID — sur température ambiante ──────────────────────
                error = sp - t_amb
                if error > dead_band:
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

            # ── V3V flottant 3 points — intégrateur de position ──────────────
            pos_step = (100.0 / travel_time_s) * (dt_ms / 1000.0)
            target   = pid_out

            if target > st["v3v_pos"] + v3v_deadband:
                cmd_ouv = True;  cmd_fer = False
                st["v3v_pos"] = min(100.0, st["v3v_pos"] + pos_step)
            elif target < st["v3v_pos"] - v3v_deadband:
                cmd_ouv = False; cmd_fer = True
                st["v3v_pos"] = max(0.0, st["v3v_pos"] - pos_step)
            else:
                cmd_ouv = False; cmd_fer = False

            self.write_dv(out_v3v_ouv, cmd_ouv)
            self.write_dv(out_v3v_fer, cmd_fer)

            circ_active = st["v3v_pos"] > 2.0
            self.write_dv(out_circ, circ_active)

            mode_str = "PROP" if ctrl_mode == "prop" else "PID"
            circ_ok  = not (delta is not None and circ_active and abs(delta) < min_delta)
            dep_str  = f" Tdep={t_depart:.1f}°C" if t_depart is not None else ""
            ret_str  = f" Tret={t_retour:.1f}°C" if t_retour is not None else ""
            dlt_str  = f" Δ={delta:.1f}°C{'⚠' if not circ_ok else ''}" if delta is not None else ""
            return (f"PLANCHER {block.get('name','?')} [{mode_str}]: "
                    f"Tamb={t_amb:.1f}°C SP={sp:.1f}°C OUT={pid_out:.0f}% "
                    f"V3V={st['v3v_pos']:.0f}% {'▲' if cmd_ouv else '▼' if cmd_fer else '■'}"
                    f"{dep_str}{ret_str}{dlt_str} {'ON' if circ_active else 'OFF'}")


        
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

        # ════════════════════════════════════════════════════════════════
        # ── PROGRAMMATION HORAIRE JOUR/NUIT + HEBDOMADAIRE — PROG_H ──
        # ════════════════════════════════════════════════════════════════
        if btype == "prog_h":
            import datetime as _dt
            # ── Paramètres globaux ────────────────────────────────────
            name       = block.get("name", "Planning")
            sp_jour    = float(block.get("sp_jour", 20.0))
            sp_nuit    = float(block.get("sp_nuit", 17.0))
            sp_vac     = float(block.get("sp_vac",  15.0))
            reg_sp     = block.get("reg_sp",    "RF5")
            out_jour   = block.get("out_jour",  "")
            out_vac_dv = block.get("out_vac_dv","")
            out_actif  = block.get("out_actif", "")   # sortie "jour actif ce jour"

            vac_input  = self.eval_cond(block.get("cond_vac"),   default_if_none=False)
            en         = self.eval_cond(block.get("condition"),  default_if_none=True)

            now     = _dt.datetime.now()
            weekday = now.weekday()          # 0=Lun … 6=Dim
            now_min = now.hour * 60 + now.minute

            # ── Mode hebdomadaire ou simple ───────────────────────────
            hebdo = block.get("hebdo_mode", False)   # True = plannings par jour

            def _in_range(h_deb, m_deb, h_fin, m_fin):
                """True si now_min est dans la plage, gère enjambement minuit."""
                deb = int(h_deb) * 60 + int(m_deb)
                fin = int(h_fin) * 60 + int(m_fin)
                if deb == fin:          return False
                if deb <= fin:          return deb <= now_min < fin
                return now_min >= deb or now_min < fin

            if hebdo:
                # ── Planning par jour de semaine ──────────────────────
                # Clés JSON : "d0" … "d6" (Lun … Dim), chacune dict :
                #   {active, h_deb, m_deb, h_fin, m_fin, sp_jour, sp_nuit}
                day_key = f"d{weekday}"
                day_cfg = block.get(day_key, {})
                day_active = bool(day_cfg.get("active", True))

                if day_active:
                    h_deb = day_cfg.get("h_deb", block.get("h_debut_j", 6))
                    m_deb = day_cfg.get("m_deb", block.get("m_debut_j", 30))
                    h_fin = day_cfg.get("h_fin", block.get("h_fin_j",   22))
                    m_fin = day_cfg.get("m_fin", block.get("m_fin_j",    0))
                    sp_j  = float(day_cfg.get("sp_jour", sp_jour))
                    sp_n  = float(day_cfg.get("sp_nuit", sp_nuit))
                    is_jour = _in_range(h_deb, m_deb, h_fin, m_fin)
                else:
                    # Jour inactif (ex: week-end) → consigne nuit toute la journée
                    is_jour   = False
                    day_active = False
                    sp_j, sp_n = sp_jour, sp_nuit
            else:
                # ── Planning simple (même plage tous les jours) ───────
                is_jour = _in_range(
                    block.get("h_debut_j", 6),  block.get("m_debut_j", 30),
                    block.get("h_fin_j",   22), block.get("m_fin_j",    0)
                )
                day_active = True
                sp_j, sp_n = sp_jour, sp_nuit

            # ── Sélection consigne active ──────────────────────────────
            if not en:
                sp_act = sp_n; is_jour = False; vac_input = False
            elif vac_input:
                sp_act = sp_vac
            elif is_jour:
                sp_act = sp_j
            else:
                sp_act = sp_n

            # ── Écriture sorties ──────────────────────────────────────
            if reg_sp:     self.write_register(reg_sp, sp_act)
            if out_jour:   self.write_bool_out(out_jour,  is_jour and not vac_input and en)
            if out_vac_dv: self.write_bool_out(out_vac_dv, vac_input)
            if out_actif:  self.write_bool_out(out_actif,  day_active and en and not vac_input)

            jours_fr = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"]
            mode_str = "VAC" if vac_input else ("JOUR" if is_jour else "NUIT")
            return (f"PROG_H {name}: {jours_fr[weekday]} {mode_str} "
                    f"SP={sp_act:.1f}°C [{now.strftime('%H:%M')}]")

        if btype == "localtime":
            import datetime as _dt
            now = _dt.datetime.now()
            # FIX : le projet utilise reg_hour/reg_wday (nouveaux noms canvas)
            # fallback sur out_hour/out_wday (anciens noms) pour compatibilité
            # FIX : block_editor passe maintenant out_hour/out_wday depuis reg_hour/reg_wday
            # Les deux noms sont acceptés pour compatibilité avec anciens projets
            r_hour = block.get("out_hour") or block.get("reg_hour", "RF13")
            r_mday = block.get("out_mday") or block.get("reg_mday", "RF14")
            r_wday = block.get("out_wday") or block.get("reg_wday", "RF15")
            r_min  = block.get("out_min")  or block.get("reg_min")
            r_sec  = block.get("out_sec")  or block.get("reg_sec")
            self.write_register(r_hour, float(now.hour))
            self.write_register(r_mday, float(now.day))
            # Convention Proview : 0=Dim, 1=Lun, 2=Mar, 3=Mer, 4=Jeu, 5=Ven, 6=Sam
            # P5_JOURS convertit avec (I1-1)%7 pour obtenir 0=Lun..6=Dim
            self.write_register(r_wday, float((now.weekday() + 1) % 7))
            if r_min: self.write_register(r_min, float(now.minute))
            if r_sec: self.write_register(r_sec, float(now.second))

        if btype in ("runtimcnt", "runtimecnt"):
            cond = self.eval_cond(block.get("condition"))
            rst  = self.eval_cond(block.get("reset_condition"), default_if_none=False)
            if bid not in self.pids:
                if not hasattr(self, '_backup_store'):
                    self._backup_store = {}; self._backup_dirty = False; self._load_backup_store()
                self.pids[bid] = {
                    "starts":  float(self._backup_store.get(f"_cnt_{bid}_starts", 0)),
                    "total":   float(self._backup_store.get(f"_cnt_{bid}_total",  0.0)),
                    "runtime": 0.0, "_prev": False}
            c = self.pids[bid]
            if rst:
                c["starts"] = 0; c["total"] = 0.0; c["runtime"] = 0.0; c["_prev"] = False
                self._backup_store[f"_cnt_{bid}_starts"] = 0
                self._backup_store[f"_cnt_{bid}_total"]  = 0.0
                self._backup_dirty = True
            else:
                if cond and not c["_prev"]:
                    c["starts"] += 1
                    self._backup_store[f"_cnt_{bid}_starts"] = c["starts"]
                    self._backup_dirty = True
                if cond:
                    prev_total = c["total"]
                    c["runtime"] += dt_ms / 1000.0; c["total"] += dt_ms / 1000.0
                    # FIX: ne sauvegarder qu'une fois par passage de frontière 30s
                    if int(c["total"]) // 30 != int(prev_total) // 30:
                        self._backup_store[f"_cnt_{bid}_total"] = c["total"]
                        self._backup_dirty = True
                else: c["runtime"] = 0.0
            c["_prev"] = cond
            if block.get("reg_starts"):  self.write_register(block["reg_starts"], float(c["starts"]))
            if block.get("reg_total"):   self.write_register(block["reg_total"],  c["total"] / 3600.0)
            if block.get("reg_runtime"): self.write_register(block["reg_runtime"], c["runtime"])

        if btype == "contactor":
            cond = self.eval_cond(block.get("condition"))
            pin  = block.get("pin")
            if pin is not None: self.write_signal(int(pin), cond)

        if btype == "valve3v":
            # cond_inc/dec sont optionnelles — None = port non câblé = False
            cond_inc = self.eval_cond(block.get("cond_inc"), default_if_none=False)
            cond_dec = self.eval_cond(block.get("cond_dec"), default_if_none=False)
            pin_inc  = block.get("pin_inc")
            pin_dec  = block.get("pin_dec")
            if pin_inc: self.write_signal(int(pin_inc), cond_inc)
            if pin_dec: self.write_signal(int(pin_dec), cond_dec)
            # Propager les sorties logiques Q_OUV / Q_FER
            out_inc = block.get("out_inc")
            out_dec = block.get("out_dec")
            if out_inc is not None: self.write_signal(out_inc, cond_inc)
            if out_dec is not None: self.write_signal(out_dec, cond_dec)
            return f"V3V {block.get('name','V3V')} OUV={'1' if cond_inc else '0'} FER={'1' if cond_dec else '0'}"

        if btype == "carithm":
            self._exec_carithm(block, dt_ms)


        if btype in ("sr", "sr_r", "sr_s"):
            # SR_R : Reset prioritaire (R > S) — miroir du bloc server.py
            s   = self.eval_cond(block.get("set_cond"),   default_if_none=False)
            r   = self.eval_cond(block.get("res_cond"),   default_if_none=False)
            bit = block.get("bit", "M0")
            if bit not in self.memory: self.memory[bit] = False
            if btype in ("sr_r", "sr"):
                if r:    self.memory[bit] = False   # Reset prioritaire
                elif s:  self.memory[bit] = True
            else:   # sr_s : Set prioritaire
                if s:    self.memory[bit] = True    # Set prioritaire
                elif r:  self.memory[bit] = False
            if out is not None: self.write_bool_out(out, self.memory.get(bit, False))

        if btype == "pyblock":
            return self._exec_pyblock(block, dt_ms)

        return None

    # ── CArithm : interpréteur de code C simplifié ─────────────────
    def _exec_carithm(self, block: dict, dt_ms: float):
        """
        Exécute le code embarqué d'un bloc CArithm.
        Variables disponibles : A1..A8, d1..d7, I1..I2
        Sorties : OA1..OA8, od1..od8, OI1
        Syntaxe type C simplifiée (if/else, opérateurs, affectation).
        """
        code = block.get("code", "")
        if not code.strip():
            return

        # Récupérer les entrées depuis les ports
        ctx = {}
        # Entrées analogiques A1..A12 → connectées à des registres RF
        for i in range(1, 13):
            key = f"a{i}_ref"
            ref = block.get(key, f"RF{i-1}")
            ctx[f"A{i}"] = self.read_analog(ref)

        # Entrées booléennes d1..d12 → connectées à bits mémoire ou GPIO
        # FIX : si d{i}_ref est absent mais a{i}_ref existe (fil logique câblé sur port A),
        # interpréter la valeur analogique comme booléenne (!=0).
        for i in range(1, 13):
            key = f"d{i}_ref"
            ref = block.get(key)
            if ref:
                ctx[f"d{i}"] = self.read_signal(ref)
            else:
                # Fallback : lire a{i}_ref comme booléen si défini
                a_ref = block.get(f"a{i}_ref")
                if a_ref:
                    ctx[f"d{i}"] = (self.read_analog(a_ref) != 0.0)
                else:
                    ctx[f"d{i}"] = False

        # Entrées entières I1..I2 → registres
        for i in range(1, 3):
            key = f"i{i}_ref"
            ref = block.get(key, f"RF{12+i}")
            ctx[f"I{i}"] = int(self.read_analog(ref))

        # Sorties — initialisation à 0
        for i in range(1, 13): ctx[f"OA{i}"] = 0.0
        for i in range(1, 13): ctx[f"od{i}"] = 0
        ctx["OI1"] = 0

        try:
            exec(self._c_to_python(code), {"__builtins__": {}}, ctx)
        except Exception as e:
            pass  # Silencieux pour ne pas bloquer le scan

        # Écrire les sorties — seulement les ports déclarés
        n_oa = block.get("n_oa", 0)
        n_od = block.get("n_od", 0)
        n_oi = block.get("n_oi", 0)
        for i in range(1, n_oa + 1):
            ref = block.get(f"oa{i}_ref")
            if ref:
                self.write_register(ref, float(ctx.get(f"OA{i}", 0.0)))
        for i in range(1, n_od + 1):
            ref = block.get(f"od{i}_ref")
            if ref:
                self.write_signal(ref, bool(ctx.get(f"od{i}", 0)))
        if n_oi >= 1:
            oi_ref = block.get("oi1_ref")
            if oi_ref:
                self.write_register(oi_ref, float(ctx.get("OI1", 0)))

    def _exec_pyblock(self, block: dict, dt_ms: float) -> str:
        """
        Exécute le code Python natif d'un bloc PYBLOCK.

        Variables disponibles dans le code :
          Entrées  : A1..A8 (float), d1..d8 (bool), I1..I2 (int)
          Sorties  : OA1..OA8 (float), od1..od8 (bool), OI1 (int)
          Contexte : dt (float, secondes), cycle (int), state (dict persistant)
          Helpers  : read_analog(ref), read_signal(ref),
                     write_register(ref,v), write_signal(ref,v)

        Imports autorisés : math, datetime, time, statistics
        Builtins restreints (pas d'exec/eval/open/import dynamique).
        """
        import math, datetime, time as _time, statistics

        code = block.get("code", "").strip()
        if not code:
            return f"PYBLOCK {block.get('name','?')}: vide"

        bid = block.get("id", "?")

        # ── State persistant entre cycles ──────────────────────────
        if not hasattr(self, '_pyblock_states'):
            self._pyblock_states = {}
        state = self._pyblock_states.setdefault(bid, {})

        # ── Construire le contexte d'exécution ────────────────────
        # FIX : d{i} fallback sur a{i}_ref si d{i}_ref absent (fil logique câblé sur port A)
        def _read_d(i):
            ref = block.get(f"d{i}_ref")
            if ref:
                return bool(self.read_signal(ref))
            a_ref = block.get(f"a{i}_ref")
            if a_ref:
                return self.read_analog(a_ref) != 0.0
            return False

        ctx = {
            # Entrées analogiques
            **{f"A{i}": self.read_analog(block.get(f"a{i}_ref", f"RF{i-1}"))
               for i in range(1, 13)},
            # Entrées booléennes
            **{f"d{i}": _read_d(i) for i in range(1, 13)},
            # Entrées entières
            **{f"I{i}": int(self.read_analog(block.get(f"i{i}_ref", f"RF{12+i}")))
               for i in range(1, 3)},
            # Sorties (initialisées à 0)
            **{f"OA{i}": 0.0 for i in range(1, 13)},
            **{f"od{i}": False for i in range(1, 13)},
            "OI1": 0,
            # Contexte temps
            "dt":    dt_ms / 1000.0,
            "cycle": self.cycle_count,
            "state": state,
            # Helpers accès moteur
            "read_analog":    self.read_analog,
            "read_signal":    self.read_signal,
            "write_register": self.write_register,
            "write_signal":   self.write_signal,
            # Libs math
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
            self.last_error = f"PYBLOCK {bid}: {e}"
            return f"PYBLOCK {block.get('name','?')} ERR: {e}"

        # ── Écrire les sorties dans le moteur ─────────────────────
        n_oa = block.get("n_oa", 0)
        n_od = block.get("n_od", 0)
        n_oi = block.get("n_oi", 0)
        for i in range(1, n_oa + 1):
            ref = block.get(f"oa{i}_ref")
            if ref:
                self.write_register(ref, float(ctx.get(f"OA{i}", 0.0)))
        for i in range(1, n_od + 1):
            ref = block.get(f"od{i}_ref")
            if ref:
                self.write_signal(ref, bool(ctx.get(f"od{i}", False)))
        if n_oi >= 1:
            oi_ref = block.get("oi1_ref")
            if oi_ref:
                self.write_register(oi_ref, float(ctx.get("OI1", 0)))

        # Mise à jour state persistant
        self._pyblock_states[bid] = ctx["state"]

        return (f"PYBLOCK {block.get('name','?')}: "
                f"OA1={ctx.get('OA1',0.0):.2f} "
                f"od1={'1' if ctx.get('od1') else '0'}")

    @staticmethod
    def _c_to_python(code: str) -> str:
        """Convertit syntaxe C simplifiée vers Python exécutable."""
        import re
        # Supprimer les commentaires // et /* */
        code = re.sub(r'//.*', '', code)
        code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
        # Enlever les ; en fin de ligne
        code = re.sub(r';\s*$', '', code, flags=re.MULTILINE)
        code = code.replace(';', '\n')
        # Convertir if (...) en if ...: avec indentation
        # Simple remplacement : if(cond) stmt → if cond:\n    stmt
        lines = code.splitlines()
        result = []
        for line in lines:
            line = line.strip()
            if not line: continue
            # if (...) ... else ...
            m = re.match(r'if\s*\((.+?)\)\s*(.+?),?\s*else\s+(.+)', line)
            if m:
                result.append(f"if {m.group(1).strip()}:")
                result.append(f"    {m.group(2).strip()}")
                result.append(f"else:")
                result.append(f"    {m.group(3).strip()}")
                continue
            # if (...) ...
            m = re.match(r'if\s*\((.+?)\)\s*(.+)', line)
            if m:
                result.append(f"if {m.group(1).strip()}:")
                result.append(f"    {m.group(2).strip()}")
                continue
            # else ...
            m = re.match(r'else\s+(.+)', line)
            if m:
                result.append(f"else:")
                result.append(f"    {m.group(1).strip()}")
                continue
            result.append(line)
        return '\n'.join(result)

    # ════════════════════════════════════════════════════════════════
    # BACKUP STORE — persistance non-volatile
    # ════════════════════════════════════════════════════════════════
    def _backup_store_path(self) -> str:
        import os
        d = os.path.expanduser("~/.rpi-plc-studio")
        os.makedirs(d, exist_ok=True)
        return os.path.join(d, "backup_store.json")

    def _load_backup_store(self):
        """Charge backup + restaure bits M, registres RF et compteurs depuis le JSON."""
        import json, os
        path     = self._backup_store_path()
        tmp_path = path + ".tmp"
        self._backup_store = {}
        # Utiliser le fichier temporaire comme fallback si le principal est corrompu
        target = path if os.path.exists(path) else (tmp_path if os.path.exists(tmp_path) else None)
        if target:
            try:
                raw = json.load(open(target))
                # Dictionnaire temporaire pour assembler les compteurs
                ctr_acc  = {}
                ctr_done = {}
                ctr_qu   = {}
                ctr_qd   = {}
                for k, v in raw.items():
                    if k.startswith('__M__'):
                        bit = k[5:]   # ex: M0
                        with self._lock:
                            self.memory[bit] = bool(v)
                    elif k.startswith('__RF__'):
                        reg = k[6:]   # ex: RF0
                        with self._lock:
                            self.registers[reg] = float(v)
                    elif k.startswith('__CTR__'):
                        # Format : __CTR__<bid>__acc / __done / __qu / __qd
                        rest = k[7:]
                        if rest.endswith('__acc'):
                            ctr_acc[rest[:-5]]  = int(float(v))
                        elif rest.endswith('__done'):
                            ctr_done[rest[:-6]] = bool(v)
                        elif rest.endswith('__qu'):
                            ctr_qu[rest[:-4]]   = bool(v)
                        elif rest.endswith('__qd'):
                            ctr_qd[rest[:-4]]   = bool(v)
                    else:
                        self._backup_store[k] = v
                # Restaurer les compteurs sauvegardés
                all_bids = set(ctr_acc) | set(ctr_done) | set(ctr_qu) | set(ctr_qd)
                for bid in all_bids:
                    with self._lock:
                        if bid not in self.counters:
                            self.counters[bid] = {"preset": 0, "acc": 0, "done": False,
                                                   "qu": False, "qd": False,
                                                   "_prev": False, "_pcu": False, "_pcd": False}
                        c = self.counters[bid]
                        if bid in ctr_acc:  c["acc"]  = ctr_acc[bid]
                        if bid in ctr_done: c["done"] = ctr_done[bid]
                        if bid in ctr_qu:   c["qu"]   = ctr_qu[bid]
                        if bid in ctr_qd:   c["qd"]   = ctr_qd[bid]
                if all_bids:
                    print(f"[BACKUP] Compteurs restaurés : {sorted(all_bids)}")
            except Exception as e:
                print(f"[BACKUP] Erreur chargement : {e}")
                self._backup_store = {}
        self._backup_dirty = False


    def save_backup_store(self):
        """Sauvegarde backup + bits M + registres RF + compteurs (persistance complète état machine)."""
        import json, os
        if not hasattr(self, '_backup_store'):
            self._backup_store = {}
        # Fusionner bits M, registres RF et compteurs dans le store
        # Préfixes __M__, __RF__, __CTR__ pour les distinguer des Backup nommés
        store = dict(self._backup_store)
        with self._lock:
            for k, v in self.memory.items():
                store[f"__M__{k}"] = 1.0 if v else 0.0
            for k, v in self.registers.items():
                store[f"__RF__{k}"] = float(v)
            # ── Sauvegarde des compteurs CTU/CTD/CTUD ──────────────────
            for bid, c in self.counters.items():
                store[f"__CTR__{bid}__acc"]  = float(c.get("acc", 0))
                store[f"__CTR__{bid}__done"] = 1.0 if c.get("done", False) else 0.0
                store[f"__CTR__{bid}__qu"]   = 1.0 if c.get("qu",   False) else 0.0
                store[f"__CTR__{bid}__qd"]   = 1.0 if c.get("qd",   False) else 0.0
        try:
            # Écriture atomique : on écrit dans un fichier temporaire puis on renomme
            # pour éviter la corruption du fichier en cas de coupure de courant pendant l'écriture
            path = self._backup_store_path()
            tmp  = path + ".tmp"
            with open(tmp, 'w') as f:
                json.dump(store, f, indent=2)
                f.flush()
                os.fsync(f.fileno())   # forcer l'écriture sur le disque (SD card)
            os.replace(tmp, path)      # renommage atomique
            self._backup_dirty = False
        except Exception as e:
            print(f"[BACKUP] Erreur sauvegarde : {e}")

    def get_backup_value(self, varname: str, default=0.0):
        """Lit une valeur backup par nom (pour l'interface)."""
        if not hasattr(self, '_backup_store'):
            self._load_backup_store()
        return self._backup_store.get(varname, default)

    def set_backup_value(self, varname: str, value):
        """Écrit une valeur backup par nom (depuis l'interface ou un programme externe).
        Le type est préservé : bool → DV, float/int → AV.
        Clé normalisée en minuscules pour cohérence avec le FBD."""
        varname = varname.lower()
        if not hasattr(self, '_backup_store'):
            self._load_backup_store()
        # Préserver le type exact pour que snapshot() sépare correctement AV/DV
        if isinstance(value, bool):
            # ── Forçage manuel DV : le cycle PLC ne peut pas écraser ─────────
            if varname in self._dv_force:
                value = self._dv_force[varname]
            self._backup_store[varname] = bool(value)
            # Synchroniser dv_vars pour que exec_block DV lise la bonne valeur
            if not hasattr(self, 'dv_vars'): self.dv_vars = {}
            with self._lock: self.dv_vars[varname] = bool(value)
        else:
            self._backup_store[varname] = float(value)
        self._backup_dirty = True

    # ════════════════════════════════════════════════════════════════
    # FORÇAGE MANUEL GPIO / DV (résiste au cycle PLC)
    # ════════════════════════════════════════════════════════════════
    def force_gpio(self, pin: int, value: bool):
        """Force un GPIO de sortie à une valeur fixe — le cycle PLC ne peut pas l'écraser."""
        self._gpio_force[pin] = bool(value)
        with self._lock:
            if pin in self.gpio:
                self.gpio[pin]["value"] = bool(value)

    def unforce_gpio(self, pin: int):
        """Libère le forçage d'un GPIO — le cycle PLC reprend le contrôle."""
        self._gpio_force.pop(pin, None)

    def force_dv(self, varname: str, value: bool):
        """Force une variable DV nommée — résiste aux blocs métiers du cycle PLC."""
        varname = varname.lower()
        self._dv_force[varname] = bool(value)
        if not hasattr(self, '_backup_store'): self._load_backup_store()
        self._backup_store[varname] = bool(value)
        if not hasattr(self, 'dv_vars'): self.dv_vars = {}
        with self._lock: self.dv_vars[varname] = bool(value)

    def unforce_dv(self, varname: str):
        """Libère le forçage d'une DV nommée."""
        self._dv_force.pop(varname.lower(), None)

    def clear_all_forces(self):
        """Libère tous les forçages GPIO et DV."""
        self._gpio_force.clear()
        self._dv_force.clear()

    # ════════════════════════════════════════════════════════════════
    # BOUCLE DE SCAN
    # ════════════════════════════════════════════════════════════════
    def _scan_loop(self):
        self._init_hardware()
        self._watchdog_open()
        prev = time.monotonic()
        last_backup_save    = time.monotonic()
        last_watchdog_kick  = time.monotonic()
        consecutive_errors  = 0
        MAX_CONSEC_ERRORS   = 10   # safe-state après N erreurs consécutives

        while self._running:
            t0 = time.monotonic()

            # dt_ms = période nominale du scan (valeur de consigne)
            # On utilise la valeur configurée pour que timers/pulse soient précis.
            # Le temps réel d'exécution peut varier — on s'ajuste avec le sleep.
            dt_ms = float(self.scan_time_ms)

            # 1. Lire les capteurs analogiques (hors du calcul dt_ms)
            self._read_hardware_analogs()

            logs = []
            try:
                # Détection de scan trop long
                exec_start = time.monotonic()
                with self._lock:
                    prog = list(self.program)
                # Tri par priorité d'exécution (cohérence avec rpi_server/server.py)
                # sources → calculs → blocs métier → sorties → page_out
                _EXEC_PRIO = {
                    'sensor':0,'pt_in':0,'ana_in':0,'av':0,'dv':0,'backup':0,'stoav':0,
                    'and':1,'or':1,'not':1,'xor':1,'inv':1,'nand':1,'nor':1,
                    'add':2,'sub':2,'mul':2,'div':2,'abs':2,'sqrt':2,
                    'min':2,'max':2,'mod':2,'pow':2,'clamp':2,'scale':2,
                    'filt1':2,'avg':2,'integ':2,'deriv':2,'deadb':2,'ramp':2,
                    'pid':3,'plancher':3,'regulech':3,'chaudiere':3,
                    'pyblock':3,'carithm':3,'solaire':3,'zone':3,'ecs':3,
                    'compare_f':4,'compare_i':4,'comph':4,'compl':4,'hyst':4,
                    'coil':5,'set':5,'reset':5,'timer':5,'counter':5,
                    'ctud':5,'runtimcnt':5,'runtimecnt':5,
                    'prog_h':5,'output':5,
                    'conn':6,'conn_tx':6,'conn_rx':6,'backup_out':6,
                }
                prog.sort(key=lambda b: _EXEC_PRIO.get(b.get('type',''), 3))
                # ── Topo-sort pour CARITHM/PYBLOCK enchaînés (même prio=3) ──
                # Garantit que le producteur écrit son RF avant que le consommateur le lise.
                _CHAIN_TYPES = {'carithm','pyblock','pid','plancher','regulech','chaudiere','solaire','zone','ecs'}
                try:
                    # Construire map RF_out → bloc producteur, RF_in → blocs consommateurs
                    _rf_writer = {}  # RF → bid
                    _rf_readers = {} # RF → [bid]
                    for _b in prog:
                        _bt = _b.get('type','').lower()
                        if _bt not in _CHAIN_TYPES: continue
                        # Sorties
                        for _k in ('od1_ref','od2_ref','od3_ref','od4_ref',
                                   'oa1_ref','oa2_ref','oa3_ref','oa4_ref','reg_out'):
                            _rf = _b.get(_k) or _b.get('params',{}).get(_k)
                            if _rf: _rf_writer[_rf] = _b['id']
                        # Entrées
                        for _k in ('d1_ref','d2_ref','d3_ref','d4_ref',
                                   'a1_ref','a2_ref','a3_ref','a4_ref'):
                            _rf = _b.get(_k) or _b.get('params',{}).get(_k)
                            if _rf:
                                _rf_readers.setdefault(_rf,[]).append(_b['id'])
                    # Construire graphe de dépendances parmi les blocs de même prio
                    _bid_to_block = {_b['id']:_b for _b in prog}
                    _deps = {_b['id']:set() for _b in prog}  # bid → set(bid amont)
                    for _rf, _readers in _rf_readers.items():
                        _writer = _rf_writer.get(_rf)
                        if _writer:
                            for _r in _readers:
                                if _r != _writer and _r in _deps:
                                    _deps[_r].add(_writer)
                    # Kahn topo-sort sur les blocs de prio=3 ; les autres gardent leur ordre
                    _prio3 = [_b['id'] for _b in prog if _EXEC_PRIO.get(_b.get('type',''),3)==3]
                    _prio3_set = set(_prio3)
                    _in_deg = {_bid: len(_deps[_bid] & _prio3_set) for _bid in _prio3}
                    from collections import deque as _deque
                    _q = _deque(b for b in _prio3 if _in_deg[b]==0)
                    _sorted3 = []
                    while _q:
                        _cur = _q.popleft()
                        _sorted3.append(_cur)
                        for _other in _prio3:
                            if _cur in _deps[_other]:
                                _in_deg[_other] -= 1
                                if _in_deg[_other] == 0:
                                    _q.append(_other)
                    if len(_sorted3) == len(_prio3):  # pas de cycle → appliquer
                        _others = [_b for _b in prog if _b['id'] not in _prio3_set]
                        _sorted3_blocks = [_bid_to_block[_bid] for _bid in _sorted3]
                        # Réinsérer au bon endroit (garder les non-prio3 en place)
                        _result, _it3 = [], iter(_sorted3_blocks)
                        for _b in prog:
                            if _b['id'] in _prio3_set:
                                _result.append(next(_it3))
                            else:
                                _result.append(_b)
                        prog = _result
                except Exception:
                    pass  # En cas d'erreur, conserver le tri par priorité
                for block in prog:
                    try:
                        r = self.exec_block(block, dt_ms)
                        if r:
                            logs.append(r)
                    except Exception as _be:
                        import traceback as _tbe
                        bid_err   = block.get('id',   '?')
                        btype_err = block.get('type', '?')
                        err_msg   = f"[ERR] bloc {btype_err}({bid_err}): {_be}"
                        if err_msg not in logs:
                            logs.append(err_msg)
                            logs.append(_tbe.format_exc().strip().splitlines()[-1])
                        self.last_error = err_msg
                        # Logger une seule fois par bloc pour éviter le spam
                        _err_key = f'_block_err_{bid_err}'
                        if not getattr(self, _err_key, False):
                            setattr(self, _err_key, True)
                            log.error(f"{err_msg}\n{_tbe.format_exc()}")
                exec_ms = (time.monotonic() - exec_start) * 1000
                if exec_ms > self.scan_time_ms * 2 and self.cycle_count > 5:
                    logs.append(f"[WARN] Exec lent : {exec_ms:.0f}ms (scan={self.scan_time_ms}ms)")

                self.cycle_count += 1
                self.last_error = None
                consecutive_errors = 0

                # Kicker le watchdog uniquement si cycle OK
                now_t = time.monotonic()
                if now_t - last_watchdog_kick >= 5.0:
                    self._watchdog_kick()
                    last_watchdog_kick = now_t

            except Exception as e:
                import traceback as _tb
                self.last_error = str(e)
                consecutive_errors += 1
                if consecutive_errors >= MAX_CONSEC_ERRORS:
                    self._safe_state()
                    full_tb = _tb.format_exc()
                    print(f"[SAFE] ERREUR CRITIQUE : {e}")
                    print(f"[SAFE] Traceback:\n{full_tb}")
                    logs.append(f"[SAFE] {MAX_CONSEC_ERRORS} erreurs consécutives → sorties coupées")
                    logs.append(f"[SAFE] Erreur : {e}")
                    for line in full_tb.strip().splitlines()[-5:]:
                        logs.append(f"[SAFE] {line}")
                    # Ne pas remettre à 0 : bloquer en safe state jusqu'à stop/reload
                    # On ralentit le cycle pour ne pas saturer les logs
                    time.sleep(2.0)
                else:
                    logs.append(f"ERREUR({consecutive_errors}/{MAX_CONSEC_ERRORS}): {e}")

            self.cycle_logs = logs
            if self.on_update:
                self.on_update(self.snapshot(logs))

            # Sauvegarde backup toutes les 5 secondes (réduit la perte en cas de coupure)
            now_t = time.monotonic()
            if now_t - last_backup_save >= 5.0:
                self.save_backup_store()
                last_backup_save = now_t

            # Sleep pour respecter scan_time_ms
            elapsed = (time.monotonic() - t0) * 1000
            wait    = max(0, self.scan_time_ms - elapsed) / 1000
            time.sleep(wait)


        self._watchdog_close()

    # ════════════════════════════════════════════════════════════════
    # CONTRÔLES
    # ════════════════════════════════════════════════════════════════
    # ════════════════════════════════════════════════════════════════
    # WATCHDOG + SAFE STATE
    # ════════════════════════════════════════════════════════════════
    def _watchdog_open(self):
        """Ouvre /dev/watchdog si disponible sur le RPi."""
        self._wdog = None
        try:
            self._wdog = open('/dev/watchdog', 'wb', buffering=0)
            print("[WDG] Watchdog matériel ouvert (/dev/watchdog)")
        except Exception:
            pass  # Pas de watchdog (simulation PC)

    def _watchdog_kick(self):
        """Envoie le signe de vie au watchdog (doit être appelé toutes les <60s)."""
        if self._wdog:
            try:
                self._wdog.write(b'1')
            except Exception:
                self._wdog = None

    def _watchdog_close(self):
        """Désactive le watchdog proprement (écriture 'V')."""
        if self._wdog:
            try:
                self._wdog.write(b'V')
                self._wdog.close()
            except Exception:
                pass
            self._wdog = None

    def _safe_state(self):
        """Met toutes les sorties GPIO à OFF (état sûr en cas d'erreur critique)."""
        if not getattr(self, '_safe_state_logged', False):
            print("[SAFE] Passage en état sûr — toutes sorties OFF")
            self._safe_state_logged = True
        with self._lock:
            for pin, info in self.gpio.items():
                if info.get('mode') == 'output':
                    info['value'] = False
            # Écriture physique si sur RPi
            try:
                import RPi.GPIO as GPIO
                for pin, info in self.gpio.items():
                    if info.get('mode') == 'output':
                        GPIO.output(int(pin), GPIO.LOW)
            except Exception:
                pass

    def start(self):
        if self._running:
            return
        # Attendre que l'ancien thread soit bien terminé avant d'en créer un nouveau
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._running = True
        self.cycle_count = 0
        self._safe_state_logged = False  # reset pour nouveau démarrage
        # Reset per-block error flags
        for attr in list(vars(self).keys()):
            if attr.startswith('_block_err_'):
                setattr(self, attr, False)
        self._thread = threading.Thread(target=self._scan_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        self._watchdog_close()
        self.save_backup_store()
        # Attendre la fin propre du thread de scan
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=3.0)
        self._thread = None

    def load_program(self, blocks: list):
        with self._lock:
            self.program = blocks
            self.timers.clear()
            self.counters.clear()
            self.pids.clear()
            self.cycle_count = 0
        # Restaurer les compteurs depuis le backup (après le clear)
        # On recharge le fichier hors du lock pour éviter un deadlock dans _load_backup_store
        if hasattr(self, '_backup_store'):
            # Le store est déjà chargé → relire le fichier pour récupérer les __CTR__
            self._reload_counters_from_file()
        else:
            self._load_backup_store()

    def _reload_counters_from_file(self):
        """Restaure uniquement les compteurs depuis backup_store.json (sans toucher au reste)."""
        import json, os
        path = self._backup_store_path()
        if not os.path.exists(path):
            return
        try:
            raw = json.load(open(path))
            ctr_acc, ctr_done, ctr_qu, ctr_qd = {}, {}, {}, {}
            for k, v in raw.items():
                if not k.startswith('__CTR__'):
                    continue
                rest = k[7:]
                if rest.endswith('__acc'):   ctr_acc[rest[:-5]]  = int(float(v))
                elif rest.endswith('__done'): ctr_done[rest[:-6]] = bool(v)
                elif rest.endswith('__qu'):   ctr_qu[rest[:-4]]   = bool(v)
                elif rest.endswith('__qd'):   ctr_qd[rest[:-4]]   = bool(v)
            all_bids = set(ctr_acc) | set(ctr_done) | set(ctr_qu) | set(ctr_qd)
            with self._lock:
                for bid in all_bids:
                    if bid not in self.counters:
                        self.counters[bid] = {"preset": 0, "acc": 0, "done": False,
                                               "qu": False, "qd": False,
                                               "_prev": False, "_pcu": False, "_pcd": False}
                    c = self.counters[bid]
                    if bid in ctr_acc:  c["acc"]  = ctr_acc[bid]
                    if bid in ctr_done: c["done"] = ctr_done[bid]
                    if bid in ctr_qu:   c["qu"]   = ctr_qu[bid]
                    if bid in ctr_qd:   c["qd"]   = ctr_qd[bid]
        except Exception as e:
            print(f"[BACKUP] Erreur restauration compteurs : {e}")

    def toggle_input(self, pin: int):
        with self._lock:
            if pin in self.gpio and self.gpio[pin]["mode"] == "input":
                self.gpio[pin]["value"] = not self.gpio[pin]["value"]

    def force_output(self, pin: int, value: bool):
        """Forçage manuel depuis le panneau GPIO.
        Stocke dans _gpio_force pour que le cycle PLC ne puisse pas écraser la valeur."""
        self._gpio_force[pin] = bool(value)
        with self._lock:
            if pin in self.gpio:
                self.gpio[pin]["value"] = bool(value)
        # Chercher aussi les DV nommées pilotant ce pin et les forcer
        for block in getattr(self, 'program', []):
            if block.get('type') == 'dv':
                out = block.get('output')
                try:
                    if out is not None and int(out) == pin:
                        vn = block.get('varname', '').lower()
                        if vn:
                            self._dv_force[vn] = bool(value)
                            if not hasattr(self, 'dv_vars'): self.dv_vars = {}
                            with self._lock: self.dv_vars[vn] = bool(value)
                except (TypeError, ValueError):
                    pass

    def release_force(self, pin: int):
        """Libère le forçage d'un GPIO — le cycle PLC reprend le contrôle."""
        self._gpio_force.pop(pin, None)
        # Libérer aussi les DV nommées associées à ce pin
        for block in getattr(self, 'program', []):
            if block.get('type') == 'dv':
                out = block.get('output')
                try:
                    if out is not None and int(out) == pin:
                        self._dv_force.pop(block.get('varname','').lower(), None)
                except (TypeError, ValueError):
                    pass

    def set_analog_sim(self, ref: str, value: float):
        """Simulation : forcer une tension (V) pour ANA0..ANA11 ou valeur directe pour RF."""
        with self._lock:
            if ref in self.analog:
                # value = tension en V (curseur 0..3.3V dans l'UI)
                self.analog[ref]["sim_value"] = float(value)
                # Recalculer °C immédiatement
                info = self.analog[ref]
                vm   = float(value)
                if vm > 0.001 and vm < info.get("vcc", 3.3) - 0.001:
                    r_ref = info.get("r_ref", 10000.0)
                    vcc   = info.get("vcc", 3.3)
                    probe = info.get("probe", "PT100")
                    rx    = vm * r_ref / (vcc - vm)
                    r0    = 100.0 if probe == "PT100" else 1000.0
                    temp  = (rx - r0) / (r0 * 0.00385)
                    self.analog[ref]["voltage"] = round(vm, 4)
                    self.analog[ref]["celsius"] = round(temp, 2)
            elif ref in self.registers:
                self.registers[ref] = float(value)

    def set_analog_celsius(self, ref: str, celsius: float):
        """Simulation : forcer directement une valeur en °C (ou unité brute) pour ANA* ou RF*."""
        with self._lock:
            if ref in self.analog:
                # Forcer directement la valeur °C — pas de calcul tension
                self.analog[ref]["celsius"]   = round(float(celsius), 2)
                self.analog[ref]["sim_value"] = -1.0  # marqueur "override celsius"
            elif ref in self.registers:
                self.registers[ref] = float(celsius)
            else:
                # Registre RF* non encore initialisé
                self.registers[ref] = float(celsius)

    def reload_analog_config(self, analog_config: dict):
        """Recharge la config des sondes analogiques depuis le dict analog de config.json."""
        r_ref = float(analog_config.get("r_ref_ohm", 10000.0))
        vcc   = float(analog_config.get("vcc", 3.3))
        with self._lock:
            for ads_idx, ads_cfg in enumerate(analog_config.get("ads", [])):
                for ch_idx, ch in enumerate(ads_cfg.get("channels", [])):
                    ana_id = ch.get("id", f"ANA{ads_idx * 4 + ch_idx}")
                    if ana_id in self.analog:
                        self.analog[ana_id]["name"]   = ch.get("name", self.analog[ana_id]["name"])
                        self.analog[ana_id]["probe"]  = ch.get("probe", "NTC10K")
                        self.analog[ana_id]["r_ref"]  = r_ref
                        self.analog[ana_id]["vcc"]    = vcc

    def reload_gpio_config(self, gpio_config: dict):
        """Recharge complètement self.gpio depuis un dict {pin_str: {name, mode, ...}}.
        Préserve les valeurs courantes des pins qui existent encore."""
        with self._lock:
            new_gpio = {}
            for pin_s, cfg in gpio_config.items():
                pin = int(pin_s)
                cur_val = self.gpio.get(pin, {}).get("value", False)
                new_gpio[pin] = {
                    "name":       cfg.get("name", f"GPIO{pin}"),
                    "mode":       cfg.get("mode", "input"),
                    "value":      cur_val if cfg.get("mode") == self.gpio.get(pin, {}).get("mode") else False,
                    "pull":       cfg.get("pull", "up"),
                    "active_low": cfg.get("active_low", True),
                }
            self.gpio = new_gpio

    def set_gpio_config(self, pin: int, mode: str = None, name: str = None):
        with self._lock:
            if pin in self.gpio:
                if mode:
                    self.gpio[pin]["mode"]  = mode
                    self.gpio[pin]["value"] = False
                if name:
                    self.gpio[pin]["name"]  = name

    # ════════════════════════════════════════════════════════════════
    # SNAPSHOT
    # ════════════════════════════════════════════════════════════════
    def snapshot(self, logs=None) -> dict:
        av = {}
        dv = {}
        if hasattr(self, '_backup_store'):
            for k, v in self._backup_store.items():
                if k.startswith('__'):
                    continue
                # Un bool Python est forcément une DV (set_backup_value avec bool)
                # Un float/int est une AV (set_backup_value avec float)
                if isinstance(v, bool):
                    dv[k] = v
                else:
                    av[k] = v
        return {
            "gpio":      {p: {**cfg} for p, cfg in self.gpio.items()},
            "memory":    {**self.memory},
            "analog":    {k: {**v}   for k, v  in self.analog.items()},
            "registers": {**self.registers},
            "av_vars":   av,
            "dv_vars":   dv,
            "pids":      {k: {"output": v.get("output", 0.0)} for k, v in self.pids.items()},
            "timers":    {k: {**v}   for k, v  in self.timers.items()},
            "counters":  {k: {**v}   for k, v  in self.counters.items()},
            "running":   self._running,
            "cycle":     self.cycle_count,
            "error":     self.last_error,
            "logs":      logs or [],
        }

    @property
    def is_running(self) -> bool:
        return self._running
