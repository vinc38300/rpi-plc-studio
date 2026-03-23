"""
ui/main_window.py — Fenêtre principale de RPi-PLC Studio
"""

import os
import json
import time
from PyQt5.QtWidgets import (
    QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QDockWidget, QToolBar, QAction, QLabel, QStatusBar,
    QFileDialog, QMessageBox, QSplitter, QListWidget, QPushButton,
    QListWidgetItem, QInputDialog, QSlider, QSpinBox,
    QSizePolicy, QTextEdit, QScrollArea, QFrame,
    QTabWidget
)
from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QThread
from PyQt5.QtGui import QFont, QTextCursor, QIcon, QColor
from PyQt5.QtWidgets import QApplication

from core.plc_engine import PLCEngine
from core.project import Project
from ui.block_editor import BlockEditor
from ui.gpio_panel import GPIOPanel
from ui.synoptic_window import SynopticWindow


# ── Palette d'exemples (barre latérale gauche) ────────────────────────────────
class PalettePanel(QWidget):
    """Panneau gauche : exemples rapides. Les blocs sont dans la palette HTML5."""
    block_dropped = pyqtSignal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(6, 6, 6, 6)
        lay.setSpacing(3)

        hdr = QLabel("EXEMPLES RAPIDES")
        hdr.setObjectName("section_label")
        lay.addWidget(hdr)

        info = QLabel("Cliquer pour charger\nun exemple complet")
        info.setStyleSheet("color:#484f58;font-size:9px;padding:2px 4px;")
        info.setWordWrap(True)
        lay.addWidget(info)
        lay.addSpacing(4)

        EXAMPLES = [
            ("💡", "Clignotant",    "blink",        "#bc8cff"),
            ("🔘", "Bouton→Lampe",  "button_lamp",  "#58a6ff"),
            ("🔒", "Bascule SR",    "sr_latch",     "#3fb950"),
            ("🔢", "Compteur ×5",   "counter_ex",   "#39d353"),
            ("⏱",  "Tempo ON",      "ton_ex",       "#bc8cff"),
            ("🔀", "ET logique",    "and_ex",       "#58a6ff"),
            ("🌡", "Alarme PT100",  "pt100_alarm",  "#d29922"),
            ("🔥", "PID Chauffe",   "pid_chauffe",  "#f85149"),
        ]
        for icon, label, key, color in EXAMPLES:
            btn = self._make_btn(icon, label, key, color)
            lay.addWidget(btn)

        lay.addSpacing(8)
        sep = QLabel("─" * 18)
        sep.setStyleSheet("color:#30363d;font-size:9px;")
        lay.addWidget(sep)

        hint = QLabel("Les blocs sont dans la palette\ndu canvas →\n\nDouble-clic pour ajouter.")
        hint.setStyleSheet("color:#484f58;font-size:9px;padding:4px;")
        hint.setWordWrap(True)
        lay.addWidget(hint)
        lay.addStretch()

    def _make_btn(self, icon, label, key, color):
        from PyQt5.QtWidgets import QFrame
        btn = QFrame()
        btn.setFrameShape(QFrame.StyledPanel)
        btn.setStyleSheet(f"""
            QFrame {{
                border:1px solid #21262d;border-radius:6px;
                background:#0d1117;padding:2px;
            }}
            QFrame:hover {{border-color:{color}50;background:#1a2128;}}
        """)
        btn.setCursor(Qt.PointingHandCursor)
        h = QHBoxLayout(btn)
        h.setContentsMargins(8, 5, 8, 5)
        h.setSpacing(6)
        ic = QLabel(icon)
        ic.setStyleSheet("font-size:14px;")
        h.addWidget(ic)
        lbl = QLabel(label)
        lbl.setStyleSheet(f"color:{color};font-size:11px;font-weight:bold;")
        h.addWidget(lbl)
        h.addStretch()
        btn.mousePressEvent = lambda e, k=key: self.block_dropped.emit(f"__example__{k}")
        return btn


# ── Terminal de log ────────────────────────────────────────────────────────────
class LogTerminal(QTextEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setFont(QFont("JetBrains Mono", 9))
        self.document().setMaximumBlockCount(500)
        self._colors = {
            "[OK]":    "#3fb950",
            "[ERR]":   "#f85149",
            "[SSH]":   "#58a6ff",
            "[SFTP]":  "#58a6ff",
            "[DEPLOY]":"#d29922",
            "[PROG]":  "#bc8cff",
            "[SVC]":   "#39d353",
            "[PIP]":   "#8b949e",
            "ERREUR":  "#f85149",
            "TON":     "#bc8cff",
            "CTU":     "#39d353",
            "COIL":    "#f0883e",
            "SET":     "#3fb950",
            "RST":     "#f85149",
            "CMP":     "#d29922",
        }

    def append_log(self, msg: str, level: str = ""):
        color = "#3fb950"  # vert par défaut
        for key, c in self._colors.items():
            if key in msg:
                color = c
                break
        t = time.strftime("%H:%M:%S")
        self.append(f'<span style="color:#484f58">[{t}]</span> '
                    f'<span style="color:{color}">{msg.strip()}</span>')
        self.moveCursor(QTextCursor.End)


# ═══════════════════════════════════════════════════════════════════════════════
# FENÊTRE PRINCIPALE
# ═══════════════════════════════════════════════════════════════════════════════
def _make_fbd(page_name, blocks, wires):
    """Crée un diagramme FBD mono-page."""
    return {"pages":[{"id":"P1","name":page_name,"blocks":blocks,"wires":wires}],"curPage":0}

EXAMPLES_DATA = {
    "button_lamp": _make_fbd("Bouton→Lampe", [
        {"id":"B1","type":"INPUT", "x":40, "y":80,"params":{"pin":22,"name":"Bouton"}},
        {"id":"B2","type":"COIL",  "x":200,"y":80,"params":{}},
        {"id":"B3","type":"OUTPUT","x":360,"y":80,"params":{"pin":17,"name":"Lampe"}},
    ],[
        {"id":"W1","src":{"bid":"B1","port":"VAL"},"dst":{"bid":"B2","port":"EN"}},
        {"id":"W2","src":{"bid":"B2","port":"Q"},  "dst":{"bid":"B3","port":"VAL"}},
    ]),

    "blink": _make_fbd("Clignotant", [
        {"id":"B1","type":"INPUT", "x":40, "y":80, "params":{"pin":22,"name":"Activer"}},
        {"id":"B2","type":"NOT",   "x":200,"y":160,"params":{}},
        {"id":"B3","type":"TON",   "x":200,"y":80, "params":{"preset_ms":500}},
        {"id":"B4","type":"MEM",   "x":360,"y":80, "params":{"bit":"M0"}},
        {"id":"B5","type":"COIL",  "x":360,"y":160,"params":{}},
        {"id":"B6","type":"OUTPUT","x":520,"y":160,"params":{"pin":17,"name":"LED"}},
    ],[
        {"id":"W1","src":{"bid":"B1","port":"VAL"},"dst":{"bid":"B3","port":"IN"}},
        {"id":"W2","src":{"bid":"B4","port":"R"},  "dst":{"bid":"B2","port":"IN"}},
        {"id":"W3","src":{"bid":"B2","port":"OUT"},"dst":{"bid":"B3","port":"PT"}},
        {"id":"W4","src":{"bid":"B3","port":"Q"},  "dst":{"bid":"B4","port":"W"}},
        {"id":"W5","src":{"bid":"B4","port":"R"},  "dst":{"bid":"B5","port":"EN"}},
        {"id":"W6","src":{"bid":"B5","port":"Q"},  "dst":{"bid":"B6","port":"VAL"}},
    ]),

    "sr_latch": _make_fbd("Bascule SR", [
        {"id":"B1","type":"INPUT", "x":40, "y":60, "params":{"pin":22,"name":"SET btn"}},
        {"id":"B2","type":"INPUT", "x":40, "y":160,"params":{"pin":23,"name":"RST btn"}},
        {"id":"B3","type":"SET",   "x":200,"y":60, "params":{}},
        {"id":"B4","type":"RESET", "x":200,"y":160,"params":{}},
        {"id":"B5","type":"MEM",   "x":360,"y":60, "params":{"bit":"M1"}},
        {"id":"B6","type":"COIL",  "x":360,"y":160,"params":{}},
        {"id":"B7","type":"OUTPUT","x":520,"y":160,"params":{"pin":17,"name":"Sortie"}},
    ],[
        {"id":"W1","src":{"bid":"B1","port":"VAL"},"dst":{"bid":"B3","port":"S"}},
        {"id":"W2","src":{"bid":"B2","port":"VAL"},"dst":{"bid":"B4","port":"R"}},
        {"id":"W3","src":{"bid":"B3","port":"Q"},  "dst":{"bid":"B5","port":"W"}},
        {"id":"W4","src":{"bid":"B4","port":"Q"},  "dst":{"bid":"B5","port":"W"}},
        {"id":"W5","src":{"bid":"B5","port":"R"},  "dst":{"bid":"B6","port":"EN"}},
        {"id":"W6","src":{"bid":"B6","port":"Q"},  "dst":{"bid":"B7","port":"VAL"}},
    ]),

    "counter_ex": _make_fbd("Compteur ×5", [
        {"id":"B1","type":"INPUT", "x":40, "y":60, "params":{"pin":22,"name":"Impulsion"}},
        {"id":"B2","type":"INPUT", "x":40, "y":160,"params":{"pin":23,"name":"Reset"}},
        {"id":"B3","type":"CTU",   "x":200,"y":80, "params":{"preset":5}},
        {"id":"B4","type":"COIL",  "x":380,"y":80, "params":{}},
        {"id":"B5","type":"OUTPUT","x":540,"y":80, "params":{"pin":17,"name":"Sortie"}},
    ],[
        {"id":"W1","src":{"bid":"B1","port":"VAL"},"dst":{"bid":"B3","port":"CU"}},
        {"id":"W2","src":{"bid":"B2","port":"VAL"},"dst":{"bid":"B3","port":"R"}},
        {"id":"W3","src":{"bid":"B3","port":"Q"},  "dst":{"bid":"B4","port":"EN"}},
        {"id":"W4","src":{"bid":"B4","port":"Q"},  "dst":{"bid":"B5","port":"VAL"}},
    ]),

    "ton_ex": _make_fbd("Tempo ON", [
        {"id":"B1","type":"INPUT", "x":40, "y":80,"params":{"pin":22,"name":"Départ"}},
        {"id":"B2","type":"TON",   "x":200,"y":80,"params":{"preset_ms":2000}},
        {"id":"B3","type":"COIL",  "x":380,"y":80,"params":{}},
        {"id":"B4","type":"OUTPUT","x":540,"y":80,"params":{"pin":17,"name":"Sortie"}},
    ],[
        {"id":"W1","src":{"bid":"B1","port":"VAL"},"dst":{"bid":"B2","port":"IN"}},
        {"id":"W2","src":{"bid":"B2","port":"Q"},  "dst":{"bid":"B3","port":"EN"}},
        {"id":"W3","src":{"bid":"B3","port":"Q"},  "dst":{"bid":"B4","port":"VAL"}},
    ]),

    "and_ex": _make_fbd("ET logique", [
        {"id":"B1","type":"INPUT", "x":40, "y":60, "params":{"pin":22,"name":"Entrée 1"}},
        {"id":"B2","type":"INPUT", "x":40, "y":160,"params":{"pin":23,"name":"Entrée 2"}},
        {"id":"B3","type":"AND",   "x":200,"y":100,"params":{}},
        {"id":"B4","type":"COIL",  "x":360,"y":100,"params":{}},
        {"id":"B5","type":"OUTPUT","x":520,"y":100,"params":{"pin":17,"name":"Sortie"}},
    ],[
        {"id":"W1","src":{"bid":"B1","port":"VAL"},"dst":{"bid":"B3","port":"IN1"}},
        {"id":"W2","src":{"bid":"B2","port":"VAL"},"dst":{"bid":"B3","port":"IN2"}},
        {"id":"W3","src":{"bid":"B3","port":"OUT"},"dst":{"bid":"B4","port":"EN"}},
        {"id":"W4","src":{"bid":"B4","port":"Q"},  "dst":{"bid":"B5","port":"VAL"}},
    ]),

    "pt100_alarm": _make_fbd("🌡 Alarme PT100", [
        {"id":"A1","type":"ANA_IN",    "x":40, "y":80, "params":{"ref":"ANA0","name":"Sonde 1","reg":"RF0"}},
        {"id":"A2","type":"COMPARE_F", "x":220,"y":80, "params":{"ref":"RF0","threshold":80.0,"hysteresis":2.0,"op":"gt","reg":"M5"}},
        {"id":"A3","type":"COIL",      "x":420,"y":80, "params":{}},
        {"id":"A4","type":"OUTPUT",    "x":580,"y":80, "params":{"pin":22,"name":"Alarme K6"}},
    ],[
        {"id":"W1","src":{"bid":"A1","port":"OUT"},"dst":{"bid":"A2","port":"IN"}},
        {"id":"W2","src":{"bid":"A2","port":"OUT"},"dst":{"bid":"A3","port":"EN"}},
        {"id":"W3","src":{"bid":"A3","port":"Q"},  "dst":{"bid":"A4","port":"VAL"}},
    ]),

    "pid_chauffe": _make_fbd("🔥 PID Chauffe", [
        {"id":"P1","type":"ANA_IN", "x":40, "y":80, "params":{"ref":"ANA0","name":"Sonde 1","reg":"RF0"}},
        {"id":"P2","type":"CONST",  "x":40, "y":180,"params":{"value":75.0,"reg":"RF1","name":"Consigne"}},
        {"id":"P3","type":"PID",    "x":220,"y":80, "params":{"pv":"RF0","sp":"RF1","kp":2.0,"ki":0.1,"kd":0.5,
                                                               "out_min":0,"out_max":100,"reg":"RF2"}},
        {"id":"P4","type":"COMPARE_F","x":420,"y":80,"params":{"ref":"RF2","threshold":50.0,"hysteresis":5.0,"op":"gt","reg":"M0"}},
        {"id":"P5","type":"COIL",  "x":600,"y":80, "params":{}},
        {"id":"P6","type":"OUTPUT","x":760,"y":80, "params":{"pin":17,"name":"Chauffage K1"}},
    ],[
        {"id":"W1","src":{"bid":"P1","port":"OUT"},"dst":{"bid":"P3","port":"PV"}},
        {"id":"W2","src":{"bid":"P2","port":"OUT"},"dst":{"bid":"P3","port":"SP"}},
        {"id":"W3","src":{"bid":"P3","port":"OUT"},"dst":{"bid":"P4","port":"IN"}},
        {"id":"W4","src":{"bid":"P4","port":"OUT"},"dst":{"bid":"P5","port":"EN"}},
        {"id":"W5","src":{"bid":"P5","port":"Q"},  "dst":{"bid":"P6","port":"VAL"}},
    ]),
}


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.project  = Project()
        self.engine   = PLCEngine(on_update=self._on_plc_update)
        self._pending_state = None

        # Fenêtre synoptique — créée une seule fois, cachée/montrée
        self._synoptic_win = SynopticWindow(self)
        self._synoptic_win.synoptic_changed.connect(self._on_synoptic_changed)

        self.setWindowTitle("RPi-PLC Studio")
        self.resize(1280, 800)
        self._build_ui()
        self._build_menu()
        self._build_toolbar()
        # Charger la préférence de thème sauvegardée
        _saved_theme = "light"
        try:
            import json, os
            _prefs_path = os.path.expanduser("~/.rpi-plc-studio/preferences.json")
            if os.path.exists(_prefs_path):
                _saved_theme = json.load(open(_prefs_path)).get("theme", "light")
        except Exception:
            pass
        self._current_theme = _saved_theme
        self._load_theme(self._current_theme)
        # Stocker le thème en attente pour le canvas FBD (chargé en async)
        if hasattr(self, 'editor') and hasattr(self.editor, '_pending_theme'):
            self.editor._pending_theme = _saved_theme
        self._connect_signals()

        # ── Sauvegarde automatique toutes les 2 minutes ─────────────────
        self._autosave_timer = QTimer(self)
        self._autosave_timer.timeout.connect(self._autosave)
        self._autosave_timer.start(120_000)  # 120 secondes

        # Timer pour appliquer les mises à jour PLC dans le thread UI
        self._ui_timer = QTimer()
        self._ui_timer.timeout.connect(self._apply_pending_state)
        self._ui_timer.start(80)

        self.statusBar().showMessage("Prêt — mode SIMULATION")

    # ── Construction de l'interface ────────────────────────────────────────────
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        main_lay = QHBoxLayout(central)
        main_lay.setContentsMargins(0, 0, 0, 0)
        main_lay.setSpacing(0)

        # Splitter principal : Palette | Éditeur | Panneau droit
        splitter = QSplitter(Qt.Horizontal)

        # ── Palette (gauche) ───────────────────────────────────────────────────
        self.palette = PalettePanel()
        self.palette.setFixedWidth(190)
        self.palette.block_dropped.connect(self._on_palette_drop)
        splitter.addWidget(self.palette)

        # ── Zone centrale : éditeur de blocs ─────────────────────────────────
        center = QWidget()
        center_lay = QVBoxLayout(center)
        center_lay.setContentsMargins(0, 0, 0, 0)
        center_lay.setSpacing(0)

        # Barre d'outils du canvas
        canvas_bar = QFrame()
        self._canvas_bar = canvas_bar  # référence pour mise à jour du thème
        canvas_bar.setStyleSheet("background: #161b22; border-bottom: 1px solid #30363d;")
        cb_lay = QHBoxLayout(canvas_bar)
        cb_lay.setContentsMargins(8, 4, 8, 4)
        cb_lay.setSpacing(8)

        self.sim_label = QLabel("◉ SIMULATION")
        self.sim_label.setStyleSheet("color: #3fb950; font-size: 11px; font-weight: bold;")
        cb_lay.addWidget(self.sim_label)

        cb_lay.addWidget(QLabel("Cycle:"))
        self.scan_spin = QSpinBox()
        self.scan_spin.setRange(10, 5000)
        self.scan_spin.setValue(100)
        self.scan_spin.setSuffix(" ms")
        self.scan_spin.setFixedWidth(90)
        self.scan_spin.valueChanged.connect(self._on_scan_time_changed)
        cb_lay.addWidget(self.scan_spin)

        cb_lay.addStretch()

        self.cycle_label = QLabel("Cycle #0")
        self.cycle_label.setStyleSheet("color: #8b949e; font-size: 10px;")
        cb_lay.addWidget(self.cycle_label)

        # Affichage valeurs analogiques
        self.analog_label = QLabel("Analogiques : —")
        self.analog_label.setStyleSheet("color: #00d4ff; font-size: 10px; padding: 0 8px;")
        cb_lay.addWidget(self.analog_label)

        self.error_label = QLabel("")
        self.error_label.setStyleSheet("color: #f85149; font-size: 10px;")
        cb_lay.addWidget(self.error_label)

        center_lay.addWidget(canvas_bar)

        # Éditeur de blocs
        self.editor = BlockEditor()
        self.editor.program_changed.connect(self._on_program_changed)
        center_lay.addWidget(self.editor, 1)

        splitter.addWidget(center)

        # ── Panneau droit : GPIO + Log ────────────────────────────────────────
        right = QWidget()
        right.setFixedWidth(220)
        right_lay = QVBoxLayout(right)
        right_lay.setContentsMargins(0, 0, 0, 0)
        right_lay.setSpacing(0)

        right_tabs = QTabWidget()

        # Onglet GPIO
        self.gpio_panel = GPIOPanel()
        right_tabs.addTab(self.gpio_panel, "GPIO")

        # Onglet mémoires
        self.mem_panel = QTextEdit()
        self.mem_panel.setReadOnly(True)
        self.mem_panel.setFont(QFont("JetBrains Mono", 9))
        right_tabs.addTab(self.mem_panel, "Mémoires")

        right_lay.addWidget(right_tabs, 2)

        # Terminal de log
        log_header = QLabel(" JOURNAL")
        log_header.setStyleSheet(
            "background:#161b22; color:#8b949e; font-size:9px; "
            "letter-spacing:1px; padding:4px 6px; border-top:1px solid #30363d;"
        )
        right_lay.addWidget(log_header)
        self.log_terminal = LogTerminal()
        self.log_terminal.setMaximumHeight(160)
        right_lay.addWidget(self.log_terminal, 1)

        splitter.addWidget(right)
        splitter.setStretchFactor(0, 0)
        splitter.setStretchFactor(1, 1)
        splitter.setStretchFactor(2, 0)

        main_lay.addWidget(splitter)

        # Initialiser le panneau GPIO avec les valeurs par défaut du moteur
        self.gpio_panel.init_gpio({str(p): cfg for p, cfg in self.engine.gpio.items()})

    def _fbd_undo(self):
        self.editor.view.page().runJavaScript("typeof undo==='function' && undo();")

    def _fbd_redo(self):
        self.editor.view.page().runJavaScript("typeof redo==='function' && redo();")

    def _build_menu(self):
        mb = self.menuBar()

        # Fichier
        file_menu = mb.addMenu("Fichier")
        for label, shortcut, slot in [
            ("Nouveau projet",    "Ctrl+N", self._new_project),
            ("Ouvrir…",           "Ctrl+O", self._open_project),
            ("Enregistrer",       "Ctrl+S", self._save_project),
            ("Enregistrer sous…", "Ctrl+Shift+S", self._save_project_as),
        ]:
            a = QAction(label, self)
            a.setShortcut(shortcut)
            a.triggered.connect(slot)
            file_menu.addAction(a)
        file_menu.addSeparator()
        file_menu.addAction("Quitter", self.close)

        # Édition — Undo/Redo
        edit_menu = mb.addMenu("Édition")
        self._act_undo = QAction("↩ Annuler", self)
        self._act_undo.setShortcut("Ctrl+Z")
        self._act_undo.triggered.connect(self._fbd_undo)
        edit_menu.addAction(self._act_undo)

        self._act_redo = QAction("↪ Rétablir", self)
        self._act_redo.setShortcut("Ctrl+Y")
        self._act_redo.triggered.connect(self._fbd_redo)
        edit_menu.addAction(self._act_redo)

        # Ctrl+Shift+Z = redo aussi (convention Linux)
        from PyQt5.QtWidgets import QShortcut
        from PyQt5.QtGui import QKeySequence
        QShortcut(QKeySequence("Ctrl+Shift+Z"), self).activated.connect(self._fbd_redo)

        # Simulation
        sim_menu = mb.addMenu("Simulation")
        self.act_start = QAction("▶ Démarrer", self)
        self.act_start.setShortcut("F5")
        self.act_start.triggered.connect(self._start_sim)
        sim_menu.addAction(self.act_start)

        self.act_stop = QAction("■ Arrêter", self)
        self.act_stop.setShortcut("F6")
        self.act_stop.triggered.connect(self._stop_sim)
        sim_menu.addAction(self.act_stop)

        act_rpi = QAction("↗ Envoyer au RPI", self)
        act_rpi.setShortcut("F7")
        act_rpi.triggered.connect(self._send_to_rpi)
        sim_menu.addAction(act_rpi)

        # RPi
        rpi_menu = mb.addMenu("Raspberry Pi")
        rpi_menu.addAction("Déployer…", self._open_deploy, "F7")
        rpi_menu.addAction("📌 Configurer les GPIO…", self._open_gpio_config, "Ctrl+G")
        rpi_menu.addAction("🌡 Configurer les sondes…", self._open_analog_config, "Ctrl+T")
        rpi_menu.addAction("Ouvrir interface web RPi", self._open_rpi_web)

        # Synoptique
        syn_menu = mb.addMenu("Synoptique")
        syn_menu.addAction("Ouvrir l'éditeur de synoptique", self._open_synoptic, "F8")
        syn_menu.addAction("🌡 Synoptique Régulation (web)", self._open_regulech, "F9")
        syn_menu.addSeparator()
        syn_menu.addAction("Réinitialiser le synoptique", self._reset_synoptic)

        # Affichage — sélecteur de thème
        view_menu = mb.addMenu("Affichage")
        self._act_theme_light = QAction("☀ Thème clair", self)
        self._act_theme_light.setCheckable(True)
        self._act_theme_light.triggered.connect(lambda: self._set_theme("light"))
        view_menu.addAction(self._act_theme_light)

        self._act_theme_dark = QAction("🌙 Thème sombre", self)
        self._act_theme_dark.setCheckable(True)
        self._act_theme_dark.triggered.connect(lambda: self._set_theme("dark"))
        view_menu.addAction(self._act_theme_dark)

        self._act_theme_light.setChecked(True)

        # Aide
        help_menu = mb.addMenu("Aide")
        from PyQt5.QtGui import QKeySequence as QKS
        help_menu.addAction("📖 Documentation  F1", self._open_doc).setShortcut(QKS("F1"))
        help_menu.addSeparator()
        help_menu.addAction("À propos", self._about)
        # Raccourci global F1
        from PyQt5.QtWidgets import QShortcut
        QShortcut(QKS("F1"), self).activated.connect(self._open_doc)

    def _build_toolbar(self):
        tb = QToolBar("Principale")
        tb.setMovable(False)
        self.addToolBar(tb)

        actions = [
            ("Nouveau",     "Ctrl+N", self._new_project),
            ("Ouvrir",      "Ctrl+O", self._open_project),
            ("Enregistrer", "Ctrl+S", self._save_project),
            None,
            ("↩ Annuler",   "Ctrl+Z", self._fbd_undo),
            ("↪ Rétablir",  "Ctrl+Y", self._fbd_redo),
            None,
            ("▶ START",     "F5",     self._start_sim),
            ("■ STOP",      "F6",     self._stop_sim),
            ("↗ RPI",      "F7",     self._send_to_rpi),
            None,
            ("⊡ Ajuster",  "F",      self._fit_view),
            None,
            ("🖥 Synoptique", "F8",   self._open_synoptic),
            ("🌡 Régulation","F9",    self._open_regulech),
            None,
            ("🚀 Déployer", "F7",     self._open_deploy),
            None,
            ("☀ Clair",     None,     lambda: self._set_theme("light")),
            ("🌙 Sombre",   None,     lambda: self._set_theme("dark")),
        ]

        for item in actions:
            if item is None:
                tb.addSeparator()
                continue
            label, shortcut, slot = item
            btn_widget = self._tb_button(label, shortcut, slot)
            tb.addWidget(btn_widget)
        # ── Bouton documentation ───────────────────────────────────────
        tb.addSeparator()
        doc_btn = QPushButton("📖 Doc")
        doc_btn.setToolTip("Documentation complète — F1")
        doc_btn.setStyleSheet(
            "QPushButton{background:#1a2f45;border:1px solid #58a6ff;color:#58a6ff;"            "border-radius:4px;padding:3px 10px;font-size:12px;}"            "QPushButton:hover{background:#1e3d5a;}")
        doc_btn.clicked.connect(self._open_doc)
        tb.addWidget(doc_btn)

    def _tb_button(self, label, shortcut, slot):
        from PyQt5.QtWidgets import QToolButton
        btn = QToolButton()
        btn.setText(label)
        btn.setToolTip(f"{label} ({shortcut})")

        # Styles spéciaux
        if "START" in label:
            btn.setObjectName("btn_start")
        elif "STOP" in label:
            btn.setObjectName("btn_stop")
        elif "Déployer" in label:
            btn.setObjectName("btn_deploy")
        elif "Synoptique" in label:
            btn.setObjectName("btn_synoptic")
        elif "Régulation" in label:
            btn.setObjectName("btn_regulech")

        btn.clicked.connect(slot)
        return btn

    # ── Connexions de signaux ──────────────────────────────────────────────────
    def _connect_signals(self):
        self.gpio_panel.toggle_requested.connect(self.engine.toggle_input)
        self.gpio_panel.force_requested.connect(self.engine.force_output)
        # Curseurs analogiques de simulation
        self.editor.bridge.analog_sim_set.connect(self.engine.set_analog_sim)
        # Documentation F1 depuis canvas FBD
        self.editor.bridge.open_doc_requested.connect(self._open_doc)
        self.editor.bridge.analog_sim_celsius.connect(self.engine.set_analog_celsius)
        # Synoptique → moteur PLC desktop
        syn_bridge = self._synoptic_win.editor.bridge
        syn_bridge.sig_gpio_write.connect(
            lambda pin, val: self.engine.write_signal(int(pin), bool(val)))
        syn_bridge.sig_register_write.connect(
            lambda ref, val: self.engine.write_register(ref, val))
        syn_bridge.sig_memory_write.connect(
            lambda ref, val: self.engine.memory.__setitem__(ref, bool(val)))
        syn_bridge.sig_av_write.connect(
            lambda varname, val: self.engine.set_backup_value(varname.lower(), val))
        syn_bridge.sig_dv_write.connect(
            lambda varname, val: self._on_dv_write(varname, bool(val)))
        syn_bridge.sig_plc_action.connect(self._on_synoptic_plc_action)
        # Simulation directe °C depuis panneau simulation synoptique
        syn_bridge.sig_analog_celsius.connect(self.engine.set_analog_celsius)
        # Documentation F1 depuis synoptique
        syn_bridge.sig_open_doc.connect(self._open_doc)

    def _on_synoptic_plc_action(self, action: str, var_ref: str):
        """Gère les actions PLC déclenchées depuis le synoptique (boutons action)."""
        if action == 'plc_start':
            self._start_sim()
        elif action == 'plc_stop':
            self._stop_sim()
        elif action == 'set_mem':
            if var_ref.startswith('M'):
                self.engine.memory[var_ref] = True
        elif action == 'reset_mem':
            if var_ref.startswith('M'):
                self.engine.memory[var_ref] = False

    # ── Gestion du projet ──────────────────────────────────────────────────────
    def _new_project(self):
        if self.project.dirty:
            r = QMessageBox.question(self, "Nouveau projet",
                "Des modifications non sauvegardées seront perdues. Continuer ?")
            if r != QMessageBox.Yes:
                return
        self._stop_sim()
        self.project = Project()
        self.editor.clear()
        self.setWindowTitle("RPi-PLC Studio — Nouveau projet")

    def _open_project(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Ouvrir un projet", os.path.expanduser("~"),
            "Projets PLC (*.plcproj);;JSON (*.json)"
        )
        if not path:
            return
        proj = Project.load(path)
        if not proj:
            QMessageBox.critical(self, "Erreur", "Impossible de charger le projet.")
            return
        self._stop_sim()
        self.project = proj

        # ── Appliquer la config GPIO sauvegardée dans le projet ───────────────
        _saved_gpio = proj.data.get("plc", {}).get("gpio_config", {})
        if not _saved_gpio:
            # Fallback : lire config.json local
            import os as _os, json as _json
            _cfg_path = _os.path.join(_os.path.dirname(__file__), "..", "rpi_server", "config.json")
            try:
                _saved_gpio = _json.load(open(_cfg_path)).get("gpio", {})
            except Exception:
                pass
        if _saved_gpio:
            self.engine.reload_gpio_config(_saved_gpio)
            self._reload_gpio_panel(_saved_gpio)
        # Charger la config sondes sauvegardée dans le projet
        _saved_analog = proj.data.get("plc", {}).get("analog_config", {})
        if not _saved_analog:
            try:
                _saved_analog = _json.load(open(_cfg_path)).get("analog", {})
            except Exception:
                pass
        if _saved_analog:
            self.engine.reload_analog_config(_saved_analog)

        # ── Chargement FBD sans race condition ────────────────────────────────
        # loadDiagram côté JS déclenche notifyChange → program_changed →
        # _on_program_changed → project.program = get_program() qui peut retourner
        # l'ancien _diagram (pas encore mis à jour par JS).
        # Solution : déconnecter le signal le temps que le canvas charge,
        # puis reconnecter et forcer la sauvegarde du bon diagramme.
        try:
            self.editor.program_changed.disconnect(self._on_program_changed)
        except TypeError:
            pass  # déjà déconnecté
        self.editor.load_program(proj.program)

        def _reconnect():
            try:
                self.editor.program_changed.connect(self._on_program_changed)
            except TypeError:
                pass
            # _do_load a déjà mis _diagram à jour en Python (synchrone)
            # get_program() retourne ce bon diagramme sans passer par JS
            self.project.program = self.editor.get_program()

        QTimer.singleShot(800, _reconnect)
        # ─────────────────────────────────────────────────────────────────────

        self.scan_spin.setValue(proj.scan_time_ms)
        # Charger le synoptique du projet
        syn = proj.data.get("synoptic", {})
        self._synoptic_win.load_synoptic(syn)
        self.setWindowTitle(f"RPi-PLC Studio — {proj.name}")
        # Compter les widgets (format multi-pages ou ancien format)
        if syn.get('pages'):
            nw = sum(len(p.get('widgets',[])) for p in syn['pages'])
            np = len(syn['pages'])
            syn_info = f", synoptique : {np} page(s) · {nw} widget(s)" if nw or np > 1 else ""
        else:
            nw = len(syn.get('widgets', []))
            syn_info = f", synoptique : {nw} widget(s)" if nw else ""
        self.log_terminal.append_log(
            f"Projet chargé : {proj.name} ({proj.program_block_count} blocs){syn_info}"
        )

    def _save_project(self):
        if not self.project.filepath:
            self._save_project_as()
            return
        def _do_save(diagram):
            self.project.program = diagram
            self.project.scan_time_ms = self.scan_spin.value()
            self.project.data["synoptic"] = self._synoptic_win.get_synoptic()
            ok = self.project.save()
            if ok:
                self.statusBar().showMessage(f"Sauvegardé : {self.project.filepath}", 3000)
                self.log_terminal.append_log(f"💾 Projet sauvegardé : {self.project.name}")
        self.editor.sync_and_save(_do_save)

    def _save_project_as(self):
        path, _ = QFileDialog.getSaveFileName(
            self, "Enregistrer sous…",
            Project.default_path(self.project.name),
            "Projets PLC (*.plcproj)"
        )
        if path:
            def _do_save_as(diagram):
                self.project.program = diagram
                self.project.data["synoptic"] = self._synoptic_win.get_synoptic()
                self.project.save(path)
                self.setWindowTitle(f"RPi-PLC Studio — {self.project.name}")
                self.log_terminal.append_log(f"💾 Projet enregistré sous : {path}")
            self.editor.sync_and_save(_do_save_as)

    # ── Palette : ajout de blocs ───────────────────────────────────────────────
    def _fit_view(self):
        self.editor.fit_view()

    def _on_palette_drop(self, type_or_example: str):
        if type_or_example.startswith("__example__"):
            key = type_or_example.replace("__example__", "")
            data = EXAMPLES_DATA.get(key)
            if data:
                # Ajouter les blocs à la page courante (pas remplacer le projet)
                self.editor.import_blocks(data)
                self.log_terminal.append_log(f"Exemple ajouté : {key}")
        # Les blocs FBD sont ajoutés directement depuis le double-clic dans le canvas

    # ── Programme modifié ─────────────────────────────────────────────────────
    def _on_dv_write(self, varname: str, val: bool):
        """Écriture DV depuis synoptique → backup_store + GPIO direct si câblé."""
        vn = varname.lower()
        self.engine.set_backup_value(vn, val)
        self.engine.dv_vars[vn] = val
        # Écriture directe sur les GPIOs câblés à ce DV dans le programme
        # → fonctionne même sans scan loop actif
        try:
            for block in self.engine.program:
                if block.get('type') == 'dv' and block.get('varname','').lower() == vn:
                    out = block.get('output')
                    if out is not None:
                        self.engine.write_bool_out(out, val)
        except Exception:
            pass

    def _on_program_changed(self, program: list):
        # program = liste plate (pour le moteur)
        # On sauvegarde le diagramme complet (dict multi-pages) dans project
        self.project.program = self.editor.get_program()
        self.project.dirty = True
        self.engine.load_program(program)
        # Synchroniser la config GPIO dans le canvas FBD et le synoptique
        self._push_gpio_config_to_fbd()
        self._push_gpio_config_to_synoptic()


    def _on_scan_time_changed(self, ms: int):
        self.engine.scan_time_ms = ms
        self.project.scan_time_ms = ms

    # ── Simulation ────────────────────────────────────────────────────────────
    def _validate_program(self) -> tuple:
        """Valide le programme FBD avant démarrage.
        Retourne (ok: bool, warnings: list[str])
        """
        warnings = []
        diagram = self.project.program if self.project else {}
        # Extraire tous les blocs depuis le format multi-pages
        if isinstance(diagram, dict) and 'pages' in diagram:
            prog = [b for pg in diagram['pages'] for b in pg.get('blocks', [])
                    if isinstance(b, dict)]
        elif isinstance(diagram, list):
            prog = [b for b in diagram if isinstance(b, dict)]
        else:
            prog = []

        if not prog:
            return True, []  # Programme vide → pas d'erreur bloquante, moteur gère

        # Vérifier les blocs sans configuration minimale
        for blk in prog:
            btype = blk.get('type', '')
            bid   = blk.get('id', '?')
            # CARITHM/PYBLOCK sans code
            if btype in ('carithm', 'pyblock') and not blk.get('code', '').strip():
                warnings.append(f"⚠ {btype.upper()} '{blk.get('name', bid)}' : code vide")
            # Contacteur sans GPIO
            if btype == 'contactor':
                pin = blk.get('pin')
                if not pin and pin != 0:
                    warnings.append(f"⚠ CONTACTOR '{blk.get('name', bid)}' : GPIO non configuré")
            # Plancher sans sonde ambiance
            if btype == 'plancher' and not blk.get('pv_ref_amb'):
                warnings.append(f"⚠ PLANCHER '{blk.get('name', bid)}' : sonde ambiance manquante")
            # PYBLOCK : vérification syntaxe Python rapide
            if btype == 'pyblock':
                code = blk.get('code', '')
                if code.strip():
                    try:
                        import ast; ast.parse(code)
                    except SyntaxError as e:
                        warnings.append(f"✗ PYBLOCK '{blk.get('name', bid)}' ligne {e.lineno}: {e.msg}")

        # Vérifier doublons d'ID
        ids = [b.get('id') for b in prog]
        dupes = {i for i in ids if ids.count(i) > 1}
        if dupes:
            warnings.append(f"⚠ ID dupliqués : {dupes}")

        # Séparer erreurs critiques (✗) et avertissements (⚠)
        errors   = [w for w in warnings if w.startswith('✗')]
        ok = len(errors) == 0
        return ok, warnings

    def _start_sim(self):
        # ── Validation avant démarrage ────────────────────────────────
        self.project.program = self.editor.get_program()
        ok, warnings = self._validate_program()
        # Bloquer uniquement sur erreurs critiques (✗) — programme vide ou syntaxe invalide
        errors = [w for w in warnings if w.startswith('✗')]
        if errors:
            msg = "\n".join(errors[:10])
            QMessageBox.critical(self, "Erreur programme",
                f"Programme invalide :\n\n{msg}\n\nCorrigez avant de démarrer.")
            return
        # Avertissements non bloquants : les afficher dans le terminal uniquement
        for w in [x for x in warnings if not x.startswith('✗')]:
            self.log_terminal.append_log(f"[WARN] {w}")
        self.engine.load_program(self.editor.get_engine_program())
        self.engine.start()
        self.sim_label.setText("◉ SIMULATION EN MARCHE")
        self.sim_label.setStyleSheet("color: #3fb950; font-size:11px; font-weight:bold;")
        self.statusBar().showMessage("Simulation en cours…")
        self.log_terminal.append_log("Simulation démarrée")
        # Basculer le synoptique en mode Opérateur automatiquement
        self._synoptic_win.set_operator_mode(True)
        # ── Propager plc_start vers le vrai RPi (si URL configurée) ──
        self._rpi_plc_action("plc_start")

    def _stop_sim(self):
        self.engine.stop()
        self.sim_label.setText("◎ SIMULATION ARRÊTÉE")
        self.sim_label.setStyleSheet("color: #8b949e; font-size:11px;")
        self.statusBar().showMessage("Simulation arrêtée")
        self.log_terminal.append_log("Simulation arrêtée")
        # Repasser en mode Édition quand la simulation s'arrête
        self._synoptic_win.set_operator_mode(False)
        # ── Propager plc_stop vers le vrai RPi (si URL configurée) ──
        self._rpi_plc_action("plc_stop")

    def _rpi_plc_action(self, action: str):
        """Envoie plc_start ou plc_stop au vrai RPi en arrière-plan si une URL est configurée."""
        import json, threading, urllib.request
        try:
            syn_data = self.project.data.get("synoptic", {}) if self.project else {}
            if isinstance(syn_data, str):
                try: syn_data = json.loads(syn_data)
                except: syn_data = {}
            rpi_url = syn_data.get("rpiUrl", "").strip().rstrip("/")
            if not rpi_url:
                return
            url_map = {"plc_start": "/api/plc/start", "plc_stop": "/api/plc/stop"}
            endpoint = url_map.get(action)
            if not endpoint:
                return
            def _do():
                try:
                    req = urllib.request.Request(
                        rpi_url + endpoint,
                        data=b"{}",
                        headers={"Content-Type": "application/json"},
                        method="POST"
                    )
                    with urllib.request.urlopen(req, timeout=5):
                        pass
                    self.log_terminal.append_log(f"[RPI] ✓ {action} envoyé vers {rpi_url}")
                except Exception as e:
                    self.log_terminal.append_log(f"[RPI] ✗ {action} échoué : {e}")
            threading.Thread(target=_do, daemon=True).start()
        except Exception as e:
            self.log_terminal.append_log(f"[RPI] ✗ _rpi_plc_action erreur : {e}")

    def _send_to_rpi(self):
        """Envoie le programme FBD compilé au moteur RPI via HTTP /api/program."""
        import json, threading
        # Récupérer l'URL RPI depuis le JSON du synoptique
        syn_data = self.project.data.get("synoptic", {}) if self.project else {}
        if isinstance(syn_data, str):
            try: syn_data = json.loads(syn_data)
            except: syn_data = {}
        rpi_url = syn_data.get("rpiUrl", "").strip().rstrip("/")
        if not rpi_url:
            from PyQt5.QtWidgets import QInputDialog
            rpi_url, ok = QInputDialog.getText(self, "IP du RPI",
                "Entrez l'URL du RPI (ex: http://192.168.1.50:5000) :",
                text="http://")
            if not ok or not rpi_url.strip():
                return
            rpi_url = rpi_url.strip().rstrip("/")
        # Compiler le programme
        prog = self.editor.get_engine_program()
        if not prog:
            self.log_terminal.append_log("[RPI] Programme vide — rien à envoyer")
            return
        self.log_terminal.append_log(f"[RPI] Envoi de {len(prog)} blocs vers {rpi_url}…")
        self.statusBar().showMessage(f"Envoi programme → {rpi_url}…")

        def _do_send():
            try:
                import urllib.request
                data = json.dumps(prog).encode("utf-8")
                req = urllib.request.Request(
                    rpi_url + "/api/program",
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    result = json.loads(resp.read())
                ok_msg = f"[RPI] ✓ Programme chargé : {result.get('blocks','?')} blocs"
                self.log_terminal.append_log(ok_msg)
                self.statusBar().showMessage(ok_msg, 4000)
            except Exception as e:
                err_msg = f"[RPI] ✗ Erreur envoi : {e}"
                self.log_terminal.append_log(err_msg)
                self.statusBar().showMessage(err_msg, 5000)

        threading.Thread(target=_do_send, daemon=True).start()

    # ── Réception des mises à jour du moteur PLC (thread moteur) ─────────────
    def _on_plc_update(self, state: dict):
        # On stocke l'état, le timer UI l'appliquera dans le bon thread
        self._pending_state = state

    def _apply_pending_state(self):
        state = self._pending_state
        if state is None:
            return
        self._pending_state = None

        # Mettre à jour le compteur de cycle
        self.cycle_label.setText(f"Cycle #{state['cycle']}")

        # Erreur
        err = state.get("error")
        self.error_label.setText(f"⚠ {err}" if err else "")

        # GPIO
        self.gpio_panel.update_state({str(p): cfg for p, cfg in state["gpio"].items()})

        # Mémoires
        mem_lines = []
        for k, v in sorted(state.get("memory", {}).items()):
            mem_lines.append(f"{k}: {'1' if v else '0'}")
        self.mem_panel.setText("\n".join(mem_lines))

        # Blocs visuels FBD
        self.editor.update_from_state(state)

        # Synoptique — mise à jour temps réel
        self._synoptic_win.update_from_state(state)

        # Valeurs analogiques dans la barre de statut (4 premières sondes)
        if state.get("analog"):
            parts = []
            for ref, info in sorted(state["analog"].items(),
                                    key=lambda x: int(x[0][3:]) if x[0][3:].isdigit() else 0):
                t    = info.get("celsius")
                name = info.get("name", ref)
                if t is not None:
                    parts.append(f"{name}: {t:.1f}°C")
                else:
                    parts.append(f"{name}: N/C")
            if parts and hasattr(self, 'analog_label'):
                self.analog_label.setText("  |  ".join(parts[:4]))


        # Registres PID
        if state.get("pids") and hasattr(self, 'analog_label'):
            for pid_id, pdata in state["pids"].items():
                out = pdata.get("output", 0)
                if parts := []:
                    pass  # déjà affiché

        # Logs PLC
        for log in state.get("logs", []):
            self.log_terminal.append_log(log)

    # ── Synoptique ────────────────────────────────────────────────────────────
    def _open_synoptic(self):
        """Ouvre la fenêtre dédiée de l'éditeur de synoptique."""
        self._synoptic_win.show_and_raise()
        # Pousser la config GPIO dans le synoptique à l'ouverture
        self._push_gpio_config_to_synoptic()
        # Appliquer le thème courant après chargement (délai 200 ms)
        from PyQt5.QtCore import QTimer
        QTimer.singleShot(200, lambda: self._apply_theme_to_synoptic(self._current_theme))

    def _reset_synoptic(self):
        from PyQt5.QtWidgets import QMessageBox
        r = QMessageBox.question(
            self, "Réinitialiser",
            "Effacer tous les widgets du synoptique ?"
        )
        if r == QMessageBox.Yes:
            self._synoptic_win.load_synoptic({})
            self.project.data["synoptic"] = {}
            self.project.dirty = True
            self.log_terminal.append_log("[OK] Synoptique réinitialisé")

    def _on_synoptic_changed(self, data: dict):
        """Appelé quand l'utilisateur sauvegarde dans le canvas synoptique."""
        self.project.data["synoptic"] = data
        self.project.dirty = True
        n = len(data.get("widgets", []))
        self.log_terminal.append_log(
            f"[OK] Synoptique mis à jour — {n} widget(s)"
        )
        self.statusBar().showMessage("Synoptique sauvegardé", 2000)

    # ── Déploiement ───────────────────────────────────────────────────────────
    def _open_gpio_config(self):
        """Ouvre le dialogue de configuration GPIO."""
        from ui.gpio_config_dialog import GPIOConfigDialog
        import os, json
        # Source unique : config.json RPi (référence principale)
        cfg_path = os.path.join(os.path.dirname(__file__), "..", "rpi_server", "config.json")
        current = {}
        try:
            rpi_cfg = json.load(open(cfg_path))
            current = rpi_cfg.get("gpio", {})
        except Exception:
            pass
        # Fallback projet si config.json vide
        if not current:
            current = self.project.data.get("plc", {}).get("gpio_config", {})
        dlg = GPIOConfigDialog(current, self)
        dlg.config_changed.connect(self._on_gpio_config_changed)
        dlg.exec_()

    def _on_gpio_config_changed(self, gpio_config: dict):
        """Applique la nouvelle config GPIO : projet + config.json RPi + FBD canvas."""
        import os, json
        # Sauvegarder dans le projet
        self.project.data.setdefault("plc", {})["gpio_config"] = gpio_config
        self.project.dirty = True
        # Mettre à jour config.json RPi
        cfg_path = os.path.join(os.path.dirname(__file__), "..", "rpi_server", "config.json")
        try:
            rpi_cfg = json.load(open(cfg_path))
            rpi_cfg["gpio"] = gpio_config
            json.dump(rpi_cfg, open(cfg_path, "w"), indent=2, ensure_ascii=False)
            n_out = sum(1 for c in gpio_config.values() if c.get('mode') == 'output')
            n_in  = sum(1 for c in gpio_config.values() if c.get('mode') == 'input')
            self.log_terminal.append_log(
                f"✅ GPIO configurés : {len(gpio_config)} pins — "
                f"{n_out} sorties, {n_in} entrées"
            )
            self.statusBar().showMessage("Configuration GPIO sauvegardée — redéployez pour appliquer", 5000)
        except Exception as e:
            self.log_terminal.append_log(f"⚠ GPIO config sauvegarde : {e}")
        # Mettre à jour le moteur PLC en mémoire (engine.gpio)
        self.engine.reload_gpio_config(gpio_config)
        # Recharger le panneau GPIO du studio
        self._reload_gpio_panel(gpio_config)
        # Mettre à jour le canvas FBD immédiatement
        self._push_gpio_config_to_fbd(gpio_config)
        # Mettre à jour le canvas Synoptique immédiatement
        self._push_gpio_config_to_synoptic(gpio_config)

    def _push_gpio_config_to_fbd(self, gpio_config: dict = None):
        """Envoie la config GPIO au canvas FBD (mise à jour des listes et blocs)."""
        import json as _json
        if gpio_config is None:
            # Charger depuis config.json
            import os
            cfg_path = os.path.join(os.path.dirname(__file__), "..", "rpi_server", "config.json")
            try:
                gpio_config = _json.load(open(cfg_path)).get("gpio", {})
            except Exception:
                return
        cfg_js = _json.dumps(gpio_config)
        js = f"typeof fbdAPI !== 'undefined' && fbdAPI.setGpioConfig({cfg_js});"
        self.editor.view.page().runJavaScript(js)

    def _reload_gpio_panel(self, gpio_config: dict):
        """Recharge complètement le panneau GPIO latéral avec la nouvelle config."""
        # Vider les lignes existantes
        for row in list(self.gpio_panel._rows.values()):
            row.setParent(None)
            row.deleteLater()
        self.gpio_panel._rows.clear()
        # Vider le layout inner
        while self.gpio_panel.inner_lay.count():
            item = self.gpio_panel.inner_lay.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        # Reconnexion des signaux après reinit
        self.gpio_panel.toggle_requested.disconnect()
        self.gpio_panel.force_requested.disconnect()
        self.gpio_panel.toggle_requested.connect(self.engine.toggle_input)
        self.gpio_panel.force_requested.connect(self.engine.force_output)
        # Réinitialiser avec la nouvelle config (préserve les valeurs courantes du moteur)
        live_gpio = {str(p): cfg for p, cfg in self.engine.gpio.items()}
        self.gpio_panel.init_gpio(live_gpio)

    def _push_gpio_config_to_synoptic(self, gpio_config: dict = None):
        """Envoie la config GPIO au canvas Synoptique (mise à jour des listes de widgets)."""
        import json as _json, os
        if gpio_config is None:
            cfg_path = os.path.join(os.path.dirname(__file__), '..', 'rpi_server', 'config.json')
            try:
                gpio_config = _json.load(open(cfg_path)).get('gpio', {})
            except Exception:
                return
        try:
            self._synoptic_win.editor.set_gpio_config(gpio_config)
        except Exception as e:
            self.log_terminal.append_log(f"⚠ Synoptique GPIO config : {e}")

    def _open_analog_config(self):
        """Ouvre le dialogue de configuration des sondes analogiques."""
        from ui.analog_config_dialog import AnalogConfigDialog
        import os, json
        cfg_path = os.path.join(os.path.dirname(__file__), '..', 'rpi_server', 'config.json')
        try:
            rpi_cfg  = json.load(open(cfg_path))
            cur_analog = rpi_cfg.get('analog', {})
        except Exception:
            cur_analog = {}
        dlg = AnalogConfigDialog(cur_analog, self)
        dlg.config_changed.connect(self._on_analog_config_changed)
        dlg.exec_()

    def _on_analog_config_changed(self, analog_config: dict):
        """Applique la nouvelle config sondes : config.json + moteur PLC + projet."""
        import os, json
        # Sauvegarder dans le projet
        self.project.data.setdefault('plc', {})['analog_config'] = analog_config
        self.project.dirty = True
        # Mettre à jour config.json RPi
        cfg_path = os.path.join(os.path.dirname(__file__), '..', 'rpi_server', 'config.json')
        try:
            rpi_cfg = json.load(open(cfg_path))
            rpi_cfg['analog'] = analog_config
            json.dump(rpi_cfg, open(cfg_path, 'w'), indent=2, ensure_ascii=False)
        except Exception as e:
            self.log_terminal.append_log(f'⚠ Sondes config sauvegarde : {e}')
            return
        # Mettre à jour le moteur PLC en mémoire
        self.engine.reload_analog_config(analog_config)
        # Log
        n = sum(len(a.get('channels', [])) for a in analog_config.get('ads', []))
        self.log_terminal.append_log(
            f'✅ Sondes configurées : {n} canaux — '
            f'R_ref={analog_config.get("r_ref_ohm",10000)}Ω  '
            f'VCC={analog_config.get("vcc",3.3)}V'
        )
        self.statusBar().showMessage('Configuration sondes sauvegardée — redéployez pour appliquer', 5000)

    def _open_deploy(self):
        from ui.deploy_dialog import DeployDialog
        prog = self.editor.get_engine_program()
        if not prog:
            QMessageBox.warning(self, "Programme vide",
                "Ajouter au moins un bloc avant de déployer.")
            return
        syn = self._synoptic_win.get_synoptic()
        dlg = DeployDialog(self.project.rpi, prog, self, synoptic=syn)
        dlg.deploy_done.connect(lambda ok: self._on_deploy_done(ok, dlg.rpi_config))
        dlg.exec_()

    def _on_deploy_done(self, success: bool, rpi_config: dict):
        if success:
            self.project.data["rpi"].update(rpi_config)
            # Persister la config telegram dans le projet pour les prochains déploiements
            if "telegram" in rpi_config:
                self.project.data["rpi"]["telegram"] = rpi_config["telegram"]
            if "security" in rpi_config:
                self.project.data["rpi"]["security"] = rpi_config["security"]
            self.project.dirty = True
            host = rpi_config.get("host", "")
            self.log_terminal.append_log(f"[OK] Déployé sur {host} — http://{host}:5000")
            self.statusBar().showMessage(f"Déployé sur {host}", 5000)

    def _open_rpi_web(self):
        import webbrowser
        host = self.project.rpi.get("host", "192.168.1.100")
        webbrowser.open(f"http://{host}:5000")

    def _open_regulech(self):
        """Ouvre le synoptique natif PLC Studio (F8 → mode opérateur)."""
        self._open_synoptic()
        self.statusBar().showMessage(
            "Synoptique régulation — éditeur natif PLC Studio (F8)", 3000
        )

    # ── À propos ─────────────────────────────────────────────────────────────
    def _autosave(self):
        """Sauvegarde automatique silencieuse si le projet a des modifications."""
        if not self.project or not self.project.dirty:
            return
        import os, tempfile
        # Sauvegarder dans un fichier autosave séparé (ne pas écraser le fichier principal)
        try:
            # Utiliser filepath (attribut correct du projet)
            filepath = self.project.filepath
            if filepath:
                autosave_path = filepath.replace('.plcproj', '.autosave.plcproj')
            else:
                d = os.path.expanduser('~/.rpi-plc-studio')
                os.makedirs(d, exist_ok=True)
                autosave_path = os.path.join(d, 'autosave.plcproj')
            # Synchroniser programme ET synoptique avant sauvegarde
            self.project.program = self.editor.get_program()
            self.project.data["synoptic"] = self._synoptic_win.get_synoptic()
            self.project.save(autosave_path)
            self.statusBar().showMessage(
                f"💾 Autosauvegarde — {os.path.basename(autosave_path)}", 3000)
            self.log_terminal.append_log(f"Autosauvegarde : {autosave_path}")
        except Exception as e:
            self.log_terminal.append_log(f"[WARN] Autosauvegarde échouée : {e}")

    def _open_doc(self):
        """Ouvre la documentation HTML dans une fenêtre Qt flottante."""
        import os
        doc_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "..", "resources", "rpi-plc-studio-doc.html"
        )
        doc_path = os.path.normpath(doc_path)
        if not os.path.exists(doc_path):
            QMessageBox.warning(self, "Documentation",
                f"Fichier documentation introuvable :\n{doc_path}")
            return
        # Réutiliser la fenêtre si déjà ouverte
        if hasattr(self, '_doc_window') and self._doc_window and                 self._doc_window.isVisible():
            self._doc_window.raise_()
            self._doc_window.activateWindow()
            return
        try:
            from PyQt5.QtWebEngineWidgets import QWebEngineView
            from PyQt5.QtCore import QUrl
            win = QWidget()
            win.setWindowTitle("RPi-PLC Studio — Documentation")
            win.resize(1100, 780)
            layout = QVBoxLayout(win)
            layout.setContentsMargins(0, 0, 0, 0)
            view = QWebEngineView()
            view.load(QUrl.fromLocalFile(doc_path))
            layout.addWidget(view)
            # Barre fermer
            bar = QHBoxLayout()
            bar.setContentsMargins(8, 4, 8, 4)
            lbl = QLabel("📖 Documentation RPi-PLC Studio")
            lbl.setStyleSheet("color:#58a6ff;font-weight:bold;font-size:13px;")
            close_btn = QPushButton("✕ Fermer")
            close_btn.setStyleSheet(
                "background:#f85149;border:none;color:#fff;"                "border-radius:4px;padding:3px 10px;")
            close_btn.clicked.connect(win.close)
            bar.addWidget(lbl)
            bar.addStretch()
            bar.addWidget(close_btn)
            bar_widget = QWidget()
            bar_widget.setLayout(bar)
            bar_widget.setStyleSheet("background:#161b22;border-bottom:1px solid #30363d;")
            layout.insertWidget(0, bar_widget)
            self._doc_window = win
            win.show()
        except ImportError:
            # Fallback : ouvrir dans le navigateur système
            import webbrowser
            webbrowser.open(f"file://{doc_path}")

    def _about(self):
        QMessageBox.about(self, "RPi-PLC Studio",
            "<b>RPi-PLC Studio v1.0</b><br>"
            "Environnement de développement pour automate Raspberry Pi<br><br>"
            "Licence MIT — Logiciel libre<br><br>"
            "Pile technique : Python 3 · PyQt5 · Flask · paramiko"
        )

    # ── Gestion des thèmes ───────────────────────────────────────────────────
    def _load_theme(self, name: str):
        """Charge et applique un fichier QSS + propage le thème aux canvas JS."""
        import os
        base = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "..", "resources")
        path = os.path.join(base, f"theme_{name}.qss")
        if not os.path.exists(path):
            path = os.path.join(base, "style.qss")
        try:
            qss = open(path, encoding="utf-8").read()
            QApplication.instance().setStyleSheet(qss)
        except Exception as e:
            print(f"[Thème] Erreur QSS {path}: {e}")

        # Canvas bar
        if name == "light":
            self._canvas_bar.setStyleSheet(
                "background:#ffffff;border-bottom:2px solid #e2e8f0;")
            self.sim_label.setStyleSheet(
                "color:#059669;font-size:11px;font-weight:bold;")
        else:
            self._canvas_bar.setStyleSheet(
                "background:#161b22;border-bottom:1px solid #30363d;")
            self.sim_label.setStyleSheet(
                "color:#3fb950;font-size:11px;font-weight:bold;")

        # Propager au canvas FBD
        # _pending_theme : appliqué par loadFinished si page pas encore prête
        # apply_theme    : appliqué immédiatement si page déjà chargée
        try:
            if hasattr(self.editor, '_pending_theme'):
                self.editor._pending_theme = name   # fallback si page pas prête
            if hasattr(self.editor, 'apply_theme'):
                self.editor.apply_theme(name)       # immédiat si page prête
        except Exception:
            pass

        # Propager au synoptique si la fenêtre est visible
        if self._synoptic_win.isVisible():
            self._apply_theme_to_synoptic(name)

    def _apply_theme_to_synoptic(self, name: str):
        """Applique le thème au canvas synoptique (avec délai pour attendre le chargement)."""
        js_syn = f"window.setSynopticTheme && window.setSynopticTheme('{name}');"
        try:
            editor = getattr(self._synoptic_win, 'editor', None)
            if editor and hasattr(editor, 'view'):
                editor.view.page().runJavaScript(js_syn)
        except Exception:
            pass

    def _set_theme(self, name: str):
        """Bascule vers le thème donné et met à jour les actions menu."""
        self._current_theme = name
        self._load_theme(name)
        # Cocher/décocher les actions menu
        if hasattr(self, "_act_theme_light"):
            self._act_theme_light.setChecked(name == "light")
            self._act_theme_dark.setChecked(name == "dark")
        # Sauvegarder la préférence
        try:
            import json, os
            prefs_dir = os.path.expanduser("~/.rpi-plc-studio")
            os.makedirs(prefs_dir, exist_ok=True)
            prefs_path = os.path.join(prefs_dir, "preferences.json")
            prefs = {}
            if os.path.exists(prefs_path):
                prefs = json.load(open(prefs_path))
            prefs["theme"] = name
            json.dump(prefs, open(prefs_path, "w"))
        except Exception:
            pass
        self.statusBar().showMessage(
            f"Thème {'clair ☀' if name=='light' else 'sombre 🌙'} appliqué", 2000)

    def closeEvent(self, event):
        if self.project.dirty:
            r = QMessageBox.question(
                self, "Modifications non sauvegardées",
                "Des modifications n'ont pas été sauvegardées.\n\nSauvegarder avant de quitter ?",
                QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel,
                QMessageBox.Save
            )
            if r == QMessageBox.Cancel:
                event.ignore()
                return
            if r == QMessageBox.Save:
                # Sauvegarder synchrone avant fermeture
                self.project.program = self.editor.get_program()
                self.project.data["synoptic"] = self._synoptic_win.get_synoptic()
                if self.project.filepath:
                    saved = self.project.save()
                else:
                    from PyQt5.QtWidgets import QFileDialog
                    path, _ = QFileDialog.getSaveFileName(
                        self, "Sauvegarder le projet",
                        Project.default_path(self.project.name),
                        "Projet RPi-PLC (*.plcproj)"
                    )
                    if path:
                        self.project.save(path)
                    else:
                        event.ignore()
                        return
        self._stop_sim()
        self._autosave_timer.stop()
        event.accept()
