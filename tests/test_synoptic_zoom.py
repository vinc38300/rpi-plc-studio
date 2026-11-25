#!/usr/bin/env python3
"""La page synoptique (téléphone) doit pouvoir être agrandie : viewport sans blocage du zoom,
boutons + / − / ⌖, et zoom conservé après un redimensionnement (rotation, zoom du navigateur)."""
import os, re, sys, threading, time
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(ROOT, "rpi_server", "templates", "synoptic.html"), encoding="utf-8").read()
ok = True
def check(label, cond):
    global ok; print(("OK    " if cond else "ECHEC "), label); ok &= bool(cond)

meta = re.search(r'<meta name="viewport" content="([^"]*)"', html).group(1)
check("viewport : zoom du navigateur autorisé", "user-scalable=no" not in meta and "maximum-scale=1.0" not in meta)
check("gabarit compatible Jinja (pas de « {# » : la page invité le rend avec Jinja)", "{#" not in html)
check("boutons de zoom + / − / ⌖ présents", all(s in html for s in ("_synZoomBy(1.4)", "_synZoomBy(1/1.4)", "_synResetView()")))
check("zoom utilisateur conservé par le re-calage", "_baseRatio * _userZoom" in html and "_userZoom === 1" in html)

try:
    from playwright.sync_api import sync_playwright
    from flask import Flask
    from werkzeug.serving import make_server
    import logging; logging.getLogger("werkzeug").setLevel(logging.ERROR)
    sys.path.insert(0, os.path.join(ROOT, "rpi_server")); import guest  # noqa
except Exception as e:
    print("(test navigateur ignoré :", e, ")"); sys.exit(0 if ok else 1)

import json, tempfile, shutil
tmp = tempfile.mkdtemp()
shutil.copytree(os.path.join(ROOT, "rpi_server", "templates"), os.path.join(tmp, "templates"))
shutil.copytree(os.path.join(ROOT, "rpi_server", "static"), os.path.join(tmp, "static"))
syn = {"showNavBar": False, "pages": [{"name": "Invité", "widgets": [
    {"id": "r", "type": "rect", "x": 20, "y": 39, "w": 1460, "h": 740, "fill": "#222"},
    {"id": "t", "type": "dyn_text", "x": 300, "y": 300, "w": 300, "h": 60, "varRef": "RF1", "prefix": "T ", "fontSize": 30}]}]}
json.dump(syn, open(os.path.join(tmp, "synoptic.json"), "w"))
app = guest.create_app(tmp, Flask("main"), lambda: {"registers": {"RF1": 1}}, None)
srv = make_server("127.0.0.1", 5097, app, threaded=True); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True)
    pg = c.new_page(); pg.goto("http://127.0.0.1:5097/?mobile=1"); time.sleep(2.5)
    z = lambda: float(pg.evaluate("parseFloat(document.getElementById('canvasWrap').style.zoom)"))
    z0 = z()
    check("démarrage : page ajustée à la largeur (zoom < 1)", 0.1 <= z0 < 0.5)
    check("boutons de zoom visibles sur téléphone", pg.is_visible("#syn-zoom-ctl"))
    pg.click("#syn-zoom-ctl button:nth-child(1)"); z1 = z()
    check("+ agrandit", z1 > z0 * 1.3)
    pg.click("#syn-zoom-ctl button:nth-child(1)"); z2 = z()
    check("+ encore : continue d'agrandir", z2 > z1 * 1.3)
    pg.set_viewport_size({"width": 400, "height": 780}); time.sleep(0.6)       # simule un re-calage (zoom navigateur, rotation)
    check("zoom conservé après redimensionnement", z() > z0 * 1.8)
    pg.click("#syn-zoom-ctl button:nth-child(2)")
    check("− réduit", z() < z2)
    pg.click("#syn-zoom-ctl button:nth-child(3)")
    check("⌖ revient à la vue d'ensemble", abs(z() - 400 / 1480) < 0.02 or z() < z0 * 1.1)
    check("barre des pages masquée sur la page invité", not pg.is_visible("#pages-bar"))
    b.close()
srv.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
print("\nRésultat :", "tous les tests passent" if ok else "ECHEC"); sys.exit(0 if ok else 1)
