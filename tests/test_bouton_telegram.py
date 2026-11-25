#!/usr/bin/env python3
"""Test de bout en bout du bloc FBD « Bouton Telegram » : compilateur de l'éditeur -> moteur RPi -> bot (factice).
Usage : python3 tests/test_bouton_telegram.py [projet.plcproj]   (code retour 0 si tout passe)
Sans argument : mini-schéma DV « booster » + TELEGRAM_BTN. Avec un .plcproj : ajoute le bloc dans le projet
et vérifie que le reste du programme compilé est strictement identique (rien n'est cassé)."""
import os, sys, json, copy, io, contextlib, logging
from unittest import mock
logging.disable(logging.CRITICAL)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [root, os.path.join(root, "rpi_server")]
for m in ("PyQt5", "PyQt5.QtWidgets", "PyQt5.QtCore", "PyQt5.QtGui", "PyQt5.QtWebEngineWidgets", "PyQt5.QtWebChannel"):
    sys.modules.setdefault(m, mock.MagicMock())
class _Base:
    def __init__(self, *a, **k): pass
sys.modules["PyQt5.QtWidgets"].QWidget = _Base
sys.modules["PyQt5.QtCore"].QObject = _Base
sys.modules["PyQt5.QtCore"].pyqtSignal = lambda *a, **k: mock.MagicMock()
sys.modules["PyQt5.QtCore"].pyqtSlot = lambda *a, **k: (lambda f: f)
from ui import block_editor as be

fails = 0
def check(name, cond):
    global fails
    print(("OK    " if cond else "ECHEC "), name); fails += (not cond)

if len(sys.argv) > 1:
    diagram = json.load(open(sys.argv[1], encoding="utf-8"))["program"]
    page = diagram["pages"][0]
else:
    page = {"id": "P1", "name": "t", "wires": [], "blocks": [
        {"id": "DV1", "type": "DV", "x": 0, "y": 0, "w": 120, "h": 62,
         "params": {"default": False, "reg_out": "RF414", "varname": "booster"}}]}
    diagram = {"curPage": "P1", "pages": [page]}

editor = object.__new__(be.BlockEditor)
base = editor._fbd_to_program(copy.deepcopy(diagram))

BTN = {"id": "BTN_TEST", "type": "TELEGRAM_BTN", "x": 900, "y": 900, "w": 120, "h": 62,
       "params": {"label": "Booster", "target": "booster", "cmd": "booster"}}
BTN2 = {"id": "BTN_RF", "type": "TELEGRAM_BTN", "x": 900, "y": 1000, "w": 120, "h": 62,
        "params": {"label": "Mode test", "target": "RF450", "cmd": "mode_test"}}
BTN3 = {"id": "BTN_VIDE", "type": "TELEGRAM_BTN", "x": 900, "y": 1100, "w": 120, "h": 62,
        "params": {"label": "Sans cible", "target": "", "cmd": "vide"}}
# a) un bouton sur une DV nommée : le reste du programme doit rester strictement identique
page["blocks"].append(BTN)
prog1 = editor._fbd_to_program(copy.deepcopy(diagram))
# b) tous les boutons (RFx cité : le compilateur le réserve, comme pour tout bloc qui cite un RF,
#    ce qui peut décaler l'allocation automatique de registres libres — sans effet fonctionnel)
page["blocks"] += [BTN2, BTN3]
prog = editor._fbd_to_program(copy.deepcopy(diagram))
blk = next((b for b in prog if b.get("id") == "BTN_TEST"), None)

# ── 1. Compilateur ──
check("compilation : bloc telegram_btn présent", blk is not None and blk.get("type") == "telegram_btn")
print("      bloc compilé :", json.dumps(blk, ensure_ascii=False))
check("compilation : label / target / cmd recopiés", blk and (blk["label"], blk["target"], blk["cmd"]) == ("Booster", "booster", "booster"))
check("compilation : bloc sans variable pilotée ignoré", not any(b.get("id") == "BTN_VIDE" for b in prog))
others = [b for b in prog1 if b.get("id") != "BTN_TEST"]
check("compilation : le reste du programme est strictement identique (bouton sur une DV)", others == base)

# ── 2. Moteur RPi + vrai bot (réseau coupé) ──
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    import server as S
    import telegram_bot as tb
cfg = json.load(open(os.path.join(root, "rpi_server", "config.json")))
class A: read_all = lambda self: {}
class D:
    def insert(self, *a): pass
    def insert_vars(self, *a): pass
eng = S.PLCEngine(cfg, A(), D())
eng.program = copy.deepcopy(prog)
bot = tb.TelegramBot({"telegram": {"enabled": True, "token": "x", "chat_ids": ["42"]}}, eng)
out = []
bot.send = lambda t, c=None, parse_mode="Markdown", reply_markup=None: out.append(("send", t, reply_markup))
bot._req = lambda m, _warn=True, **k: out.append((m, k)) or {"ok": True}

try:
    with contextlib.redirect_stdout(io.StringIO()):
        r = eng.exec_block(copy.deepcopy(blk), 100.0)
    check("moteur : exec_block(telegram_btn) sans effet ni exception", r is None)
except Exception as e:
    check("moteur : exec_block(telegram_btn) sans effet ni exception (%s)" % e, False)

def dv_scan():
    for b in eng.program:
        if b.get("type") == "dv":
            with contextlib.redirect_stdout(io.StringIO()):
                eng.exec_block(copy.deepcopy(b), 100.0)

def msg(text, chat="42"): bot._handle({"chat": {"id": int(chat)}, "text": text})
def cb(data, rows=2, chat=42):
    bot._handle_callback({"id": "q1", "data": data, "message": {"chat": {"id": chat}, "message_id": 7,
                          "reply_markup": {"inline_keyboard": [[{}, {}]] * rows}}})

# /boutons : liste + boutons
out.clear(); msg("/boutons")
kb = out[-1][2]["inline_keyboard"]
check("/boutons : un rang de boutons ON/OFF par bloc", len(kb) == 2 and kb[0][0]["callback_data"] == "tgb:BTN_TEST:on")
check("/boutons : état courant affiché (off)", "off" in out[-1][1])

# /booster
out.clear(); msg("/booster")
check("/booster : un seul bouton avec son état", len(out[-1][2]["inline_keyboard"]) == 1 and "off" in out[-1][1])
msg("/booster on"); dv_scan()
check("/booster on : DV « booster » = True (même chemin que le SCADA)", eng.dv_vars.get("booster") is True)
check("/booster on : le bloc DV recopie l'état dans RF414", eng.registers.get("RF414") == 1.0)
out.clear(); msg("/booster")
check("/booster : l'état affiché passe à ON", "ON" in out[-1][1])
msg("/booster off"); dv_scan()
check("/booster off : DV = False et RF414 = 0", eng.dv_vars.get("booster") is False and eng.registers.get("RF414") == 0.0)

# callbacks
out.clear(); cb("tgb:BTN_TEST:on", rows=1); dv_scan()
check("clic ON : variable écrite", eng.dv_vars.get("booster") is True and eng.registers.get("RF414") == 1.0)
edit = next(o for o in out if o[0] == "editMessageText")[1]
check("clic : message mis à jour sur place (un seul bouton)", edit["message_id"] == 7 and len(edit["reply_markup"]["inline_keyboard"]) == 1 and "ON" in edit["text"])
out.clear(); cb("tgb:BTN_TEST:off", rows=2); dv_scan()
edit = next(o for o in out if o[0] == "editMessageText")[1]
check("clic OFF depuis /boutons : liste complète rafraîchie", eng.dv_vars.get("booster") is False and len(edit["reply_markup"]["inline_keyboard"]) == 2)
out.clear(); cb("tgb:BTN_RF:on")
check("cible RFx : registre écrit à 1.0", eng.registers.get("RF450") == 1.0)

# sécurité
before = dict(eng.dv_vars)
out.clear(); cb("tgb:INCONNU:on")
check("clic sur un bloc absent du programme : refusé, rien écrit", out[0][1].get("show_alert") and eng.dv_vars == before)
out.clear(); cb("dv:autre:on")
check("ancienne forme de callback / variable quelconque : rien écrit", eng.dv_vars == before)
out.clear(); bot._handle({"chat": {"id": 999}, "text": "/booster on"}); dv_scan()
check("chat non autorisé : refusé", eng.dv_vars.get("booster") is False)

# menu / sans bouton
out.clear(); msg("/menu")
check("/menu : liste des commandes de boutons ajoutée", "/booster" in out[-1][1] and "/mode\\_test" in out[-1][1])
eng.program = [b for b in eng.program if b.get("type") != "telegram_btn"]
out.clear(); msg("/boutons")
check("/boutons sans bloc : message d'aide", "Aucun bouton" in out[-1][1])
out.clear(); msg("/booster")
check("/booster sans bloc : commande inconnue (comportement d'origine)", "inconnue" in out[-1][1].lower())

print("\nRésultat :", "tous les tests passent" if not fails else f"{fails} échec(s)")
sys.exit(1 if fails else 0)
