"""
RPi-PLC Studio — Lisibilité du thème sombre

1. build_dark_palette()  : palette Qt sombre. Elle sert aux widgets que la feuille
   de style (QSS) ne couvre pas : boîtes de dialogue natives (KDE/GTK « Ouvrir un
   projet »), texte d'indication des champs, texte désactivé, etc.
2. apply_theme_palette() : applique la palette sombre, ou restaure celle du système
   en thème clair.
3. install_contrast_filter() : plusieurs écrans fixent des couleurs grises en dur
   (setStyleSheet("color:#484f58;…")). Un filtre d'événements les éclaircit à
   l'affichage en thème sombre, et les remet à l'identique en thème clair.
"""
import re

from PyQt5.QtCore import QObject, QEvent
from PyQt5.QtGui import QPalette, QColor
from PyQt5.QtWidgets import QApplication, QWidget

_ORIGINAL_PALETTE = None

# ── Palette ──────────────────────────────────────────────────────────────────
def build_dark_palette() -> QPalette:
    p = QPalette()
    bg, bg2, bg3 = QColor("#0d1117"), QColor("#161b22"), QColor("#1c2128")
    text, text2 = QColor("#f0f6fc"), QColor("#c9d1d9")
    dim = QColor("#7d8590")
    accent = QColor("#1f6feb")

    p.setColor(QPalette.Window, bg)
    p.setColor(QPalette.WindowText, text)
    p.setColor(QPalette.Base, bg)
    p.setColor(QPalette.AlternateBase, bg2)
    p.setColor(QPalette.ToolTipBase, bg3)
    p.setColor(QPalette.ToolTipText, text)
    p.setColor(QPalette.Text, text)
    p.setColor(QPalette.Button, QColor("#2d333b"))
    p.setColor(QPalette.ButtonText, text)
    p.setColor(QPalette.BrightText, QColor("#ffffff"))
    p.setColor(QPalette.Link, QColor("#58a6ff"))
    p.setColor(QPalette.LinkVisited, QColor("#bc8cff"))
    p.setColor(QPalette.Highlight, accent)
    p.setColor(QPalette.HighlightedText, QColor("#ffffff"))
    if hasattr(QPalette, "PlaceholderText"):          # Qt >= 5.12
        p.setColor(QPalette.PlaceholderText, QColor("#8b949e"))

    for role in (QPalette.WindowText, QPalette.Text, QPalette.ButtonText):
        p.setColor(QPalette.Disabled, role, dim)
    p.setColor(QPalette.Disabled, QPalette.Highlight, QColor("#30363d"))
    p.setColor(QPalette.Disabled, QPalette.HighlightedText, dim)
    return p


def apply_theme_palette(name: str):
    """name = 'dark' | 'light'. À appeler après (ou avant) setStyleSheet."""
    global _ORIGINAL_PALETTE
    app = QApplication.instance()
    if app is None:
        return
    if _ORIGINAL_PALETTE is None:
        _ORIGINAL_PALETTE = QPalette(app.palette())
    if name == "dark":
        app.setPalette(build_dark_palette())
    else:
        app.setPalette(_ORIGINAL_PALETTE)


# ── Couleurs grises codées en dur ────────────────────────────────────────────
# (valeur d'origine → valeur éclaircie), contraste ≥ 4.5:1 sur #0d1117 / #161b22
_TO_DARK = {"#484f58": "#8b949e", "#8b949e": "#c9d1d9"}
_TO_ORIG = {v: k for k, v in _TO_DARK.items()}
_HEX = re.compile(r"#[0-9a-fA-F]{6}")
_FLAG = "_contrast_retinted"


def _map(css: str, table: dict) -> str:
    return _HEX.sub(lambda m: table.get(m.group(0).lower(), m.group(0)), css)


def retint_widget(w: QWidget, dark: bool):
    css = w.styleSheet()
    if not css:
        return
    flagged = bool(w.property(_FLAG))
    if dark and not flagged:
        new = _map(css, _TO_DARK)
        if new != css:
            w.setProperty(_FLAG, True)
            w.setStyleSheet(new)
    elif not dark and flagged:
        w.setProperty(_FLAG, False)
        w.setStyleSheet(_map(css, _TO_ORIG))


class _ContrastFilter(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.dark = False

    def eventFilter(self, obj, ev):
        if ev.type() == QEvent.Show and isinstance(obj, QWidget):
            retint_widget(obj, self.dark)
        return False


_FILTER = None


def install_contrast_filter(app=None):
    global _FILTER
    app = app or QApplication.instance()
    if _FILTER is None and app is not None:
        _FILTER = _ContrastFilter(app)
        app.installEventFilter(_FILTER)
    return _FILTER


def set_dark_mode(dark: bool):
    """Active/désactive l'éclaircissement et l'applique aux widgets déjà créés."""
    f = install_contrast_filter()
    if f is None:
        return
    f.dark = dark
    for w in QApplication.allWidgets():
        retint_widget(w, dark)
