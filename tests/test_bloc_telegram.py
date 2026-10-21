#!/usr/bin/env python3
"""Test de bout en bout du bloc FBD TELEGRAM : compilateur de l'éditeur -> moteur RPi -> bot (factice).
Usage : python3 tests/test_bloc_telegram.py [projet.plcproj]   (code retour 0 si tout passe)
Sans argument : construit un mini-schéma INPUT -> TELEGRAM. Avec un .plcproj : y ajoute un bloc TELEGRAM
câblé sur la première entrée INPUT dont le nom contient « larme » (sinon la première INPUT)."""
import os, sys, json, copy, io, contextlib, logging, types
from unittest import mock
logging.disable(logging.CRITICAL)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [root, os.path.join(root, "rpi_server")]

# ── 1. Compilateur de l'éditeur (PyQt5 absent de l'environnement de test : modules factices) ──
for m in ("PyQt5", "PyQt5.QtWidgets", "PyQt5.QtCore", "PyQt5.QtGui", "PyQt5.QtWebEngineWidgets", "PyQt5.QtWebChannel"):
    sys.modules.setdefault(m, mock.MagicMock())
class _Base:                      # QWidget / QObject factices (héritage sans effet)
    def __init__(self, *a, **k): pass
sys.modules["PyQt5.QtWidgets"].QWidget = _Base
sys.modules["PyQt5.QtCore"].QObject = _Base
sys.modules["PyQt5.QtCore"].pyqtSignal = lambda *a, **k: mock.MagicMock()
sys.modules["PyQt5.QtCore"].pyqtSlot = lambda *a, **k: (lambda f: f)
from ui import block_editor as be

if len(sys.argv) > 1:
    diagram = json.load(open(sys.argv[1], encoding="utf-8"))["program"]
    page = diagram["pages"][0]
    ins = [b for b in page["blocks"] if b["type"] == "INPUT"]
    src = next((b for b in ins if "larme" in (b["params"].get("name") or "")), ins[0])
else:
    src = {"id": "IN1", "type": "INPUT", "x": 0, "y": 0, "w": 120, "h": 62,
           "params": {"name": "Alarme", "pin": 14, "pull": "down", "reg_out": "RF448"}}
    page = {"id": "P1", "name": "t", "blocks": [src], "wires": []}
    diagram = {"curPage": "P1", "pages": [page]}
TG = {"id": "TG_TEST", "type": "TELEGRAM", "x": 400, "y": 0, "w": 160, "h": 62,
      "params": {"msg": "Chaudière en défaut ! T={RF247:.1f}°C à {heure}", "msg_clear": "Retour à la normale",
                 "delay_s": 3, "repeat_s": 0, "trigger": "1"}}
page["blocks"].append(TG)
page["wires"].append({"id": "W_TG", "src": {"bid": src["id"], "port": "VAL"}, "dst": {"bid": "TG_TEST", "port": "IN"}})

editor = object.__new__(be.BlockEditor)      # instance réelle sans passer par QWidget.__init__
prog = editor._fbd_to_program(copy.deepcopy(diagram))
blk = next((b for b in prog if b.get("id") == "TG_TEST"), None)

fails = 0
def check(name, cond):
    global fails
    print(("OK    " if cond else "ECHEC "), name); fails += (not cond)

check("compilation : bloc telegram présent dans le programme", blk is not None and blk.get("type") == "telegram")
print("      bloc compilé :", json.dumps(blk, ensure_ascii=False))
check("compilation : condition câblée sur la source", bool(blk and blk.get("condition")))
check("compilation : paramètres recopiés (msg, delay_s…)", blk and blk["msg"].startswith("Chaudière") and blk["delay_s"] == 3.0 and blk["repeat_s"] == 0.0)

# ── 2. Moteur RPi + vrai bot (réseau coupé : _send_async capturé) ──
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    import server as S
    import telegram_bot as tb
clock = {"t": 5000.0}
tb.time = types.SimpleNamespace(time=lambda: clock["t"], sleep=lambda s: None, monotonic=lambda: clock["t"])
cfg = json.load(open(os.path.join(root, "rpi_server", "config.json")))
class A: read_all = lambda self: {}
class D:
    def insert(self, *a): pass
    def insert_vars(self, *a): pass
eng = S.PLCEngine(cfg, A(), D())
bot = tb.TelegramBot({"telegram": {"enabled": True, "token": "x", "chat_ids": ["42"]}}, eng)
sent = []; bot._send_async = lambda t: sent.append(t)
eng.bot = bot
eng.registers["RF247"] = 71.26

def scan(rf_value, n, step=1.0):
    for _ in range(n):
        # la source du bloc compilé : on force la valeur de son registre/signal
        c = blk["condition"]; ref = c.get("ref")
        if isinstance(ref, str) and ref.startswith("RF"): eng.registers[ref] = float(rf_value)
        elif isinstance(ref, str) and ref.startswith("M"): eng.memory[ref] = bool(rf_value)
        elif isinstance(ref, int) or (isinstance(ref, str) and ref.isdigit()): eng.gpio[int(ref)] = dict(eng.gpio.get(int(ref), {"mode": "input"}), mode="input", value=bool(rf_value))
        with contextlib.redirect_stdout(io.StringIO()):
            eng.exec_block(copy.deepcopy(blk), 100.0)
        clock["t"] += step

print("      condition compilée :", blk["condition"])
scan(0, 4);  check("pas de message tant que l'entrée est inactive", sent == [])
scan(1, 2);  check("pas de message avant la fin de l'anti-parasite (2 s < 3 s)", sent == [])
scan(1, 3);  check("message envoyé après 3 s d'état stable", len(sent) == 1)
print("      message :", sent[0] if sent else None)
check("variables remplacées ({RF247:.1f} -> 71.3, {heure})", sent and "T=71.3°C" in sent[0] and "{" not in sent[0])
scan(1, 10); check("un seul message tant que le défaut dure", len(sent) == 1)
scan(0, 4);  check("message « retour à la normale » envoyé", len(sent) == 2 and sent[1] == "Retour à la normale")

# 3. isolation : un message mal formé ne doit jamais planter le scan
blk2 = dict(blk, msg="{RF999:.zz} {", delay_s=0)
try:
    scan(1, 2); eng.exec_block(blk2, 100.0); ok = True
except Exception as e:
    ok = False; print("      exception :", e)
check("message mal formé : pas d'exception dans le moteur", ok)

# 4. sans bot (bot None, ex. --no-web ou import raté) : aucun effet, aucune exception
eng.bot = None
try:
    eng.exec_block(copy.deepcopy(blk), 100.0); ok = True
except Exception as e:
    ok = False
check("sans bot attaché : aucun effet, aucune exception", ok)

print("\nRésultat :", "tous les tests passent" if not fails else f"{fails} échec(s)")
sys.exit(1 if fails else 0)
