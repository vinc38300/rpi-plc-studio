#!/usr/bin/env python3
"""
RPi-PLC Studio — Environnement de développement pour automate Raspberry Pi
Licence MIT
Lancer : python3 main.py
"""

import sys
import os
import logging

# Ajouter le dossier racine au chemin
sys.path.insert(0, os.path.dirname(__file__))

# ── Logging : fichier + console ──────────────────────────────────────────────
_log_dir  = os.path.expanduser("~/.rpi-plc-studio")
os.makedirs(_log_dir, exist_ok=True)
_log_file = os.path.join(_log_dir, "rpi-plc-studio.log")

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.FileHandler(_log_file, encoding="utf-8"),
        logging.StreamHandler(sys.stderr),
    ]
)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("PyQt5").setLevel(logging.WARNING)
log = logging.getLogger("main")

from PyQt5.QtWidgets import QApplication
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont, QIcon
from ui.main_window import MainWindow


def main():
    # Activer le High-DPI pour les écrans KDE
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    app = QApplication(sys.argv)
    app.setApplicationName("RPi-PLC Studio")
    app.setApplicationVersion("1.0.0")
    app.setOrganizationName("RPi-PLC")

    # Icône application (fenêtre + taskbar + raccourci bureau)
    icon_path = os.path.join(os.path.dirname(__file__), "resources", "rpi-plc-studio-icon.svg")
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))

    # Police globale monospace pour le style industriel
    font = QFont("JetBrains Mono", 10)
    font.setStyleHint(QFont.Monospace)
    app.setFont(font)

    # Chargement du thème (préférence sauvegardée ou thème clair par défaut)
    import json as _json
    _base = os.path.join(os.path.dirname(__file__), "resources")
    _theme = "light"
    try:
        _prefs = os.path.expanduser("~/.rpi-plc-studio/preferences.json")
        if os.path.exists(_prefs):
            _theme = _json.load(open(_prefs)).get("theme", "light")
    except Exception:
        pass
    _qss_path = os.path.join(_base, f"theme_{_theme}.qss")
    if not os.path.exists(_qss_path):
        _qss_path = os.path.join(_base, "style.qss")
    app.setStyleSheet(open(_qss_path, encoding="utf-8").read())

    log.info(f"RPi-PLC Studio démarré — Python {sys.version.split()[0]}")
    log.info(f"Logs : {_log_file}")

    window = MainWindow()
    window.show()

    try:
        ret = app.exec_()
    except Exception as e:
        log.critical(f"Exception non capturée : {e}", exc_info=True)
        ret = 1
    finally:
        log.info("RPi-PLC Studio arrêté")

    sys.exit(ret)


if __name__ == "__main__":
    main()
