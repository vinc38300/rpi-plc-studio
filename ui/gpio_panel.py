"""
ui/gpio_panel.py — Panneau GPIO (visualisation + contrôle manuel)
"""

from PyQt5.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QScrollArea, QFrame, QSizePolicy,
    QComboBox
)
from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui import QColor


class GPIORow(QFrame):
    """Une ligne pour un GPIO : numéro, nom, mode, LED, bouton."""
    toggle_requested = pyqtSignal(int)   # pin
    force_requested  = pyqtSignal(int, bool)  # pin, value

    def __init__(self, pin: int, cfg: dict, parent=None):
        super().__init__(parent)
        self.pin = pin
        self.setFrameShape(QFrame.NoFrame)
        self._build(cfg)

    def _build(self, cfg):
        lay = QHBoxLayout(self)
        lay.setContentsMargins(6, 3, 6, 3)
        lay.setSpacing(6)

        # Numéro
        pin_lbl = QLabel(str(self.pin))
        pin_lbl.setFixedWidth(24)
        pin_lbl.setStyleSheet("color: #484f58; font-size: 10px;")
        lay.addWidget(pin_lbl)

        # Nom
        self.name_lbl = QLabel(cfg.get("name", f"GPIO {self.pin}"))
        self.name_lbl.setStyleSheet("font-size: 11px; color: #e6edf3;")
        self.name_lbl.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Preferred)
        lay.addWidget(self.name_lbl, 1)

        # Mode badge
        mode = cfg.get("mode", "input")
        mode_lbl = QLabel("IN" if mode == "input" else "OUT")
        color = "#58a6ff" if mode == "input" else "#f0883e"
        mode_lbl.setStyleSheet(f"color: {color}; font-size: 9px; font-weight: bold;")
        mode_lbl.setFixedWidth(22)
        lay.addWidget(mode_lbl)

        # LED d'état
        self.led = QLabel("●")
        self.led.setFixedWidth(14)
        self.led.setStyleSheet("color: #30363d; font-size: 12px;")
        lay.addWidget(self.led)

        # Bouton d'action
        self.action_btn = QPushButton()
        self.action_btn.setFixedSize(34, 20)
        self.action_btn.setStyleSheet("""
            QPushButton {
                font-size: 9px; padding: 0; border-radius: 3px;
                border: 1px solid #30363d; background: #1c2128; color: #8b949e;
            }
            QPushButton:hover { border-color: #58a6ff; color: #58a6ff; }
        """)
        self._mode = mode
        self._value = cfg.get("value", False)
        self._setup_btn()
        lay.addWidget(self.action_btn)

    def _setup_btn(self):
        if self._mode == "input":
            self.action_btn.setText("⇄")
            self.action_btn.setToolTip("Simuler (basculer)")
            try:
                self.action_btn.clicked.disconnect()
            except Exception:
                pass
            self.action_btn.clicked.connect(lambda: self.toggle_requested.emit(self.pin))
        else:
            val = self._value
            self.action_btn.setText("↑1" if not val else "↓0")
            self.action_btn.setToolTip("Forcer la sortie")
            self.action_btn.setStyleSheet("""
                QPushButton {
                    font-size: 9px; padding: 0; border-radius: 3px;
                    border: 1px solid #f0883e; background: #1c2128; color: #f0883e;
                }
                QPushButton:hover { background: #3d1f0a; }
            """)
            try:
                self.action_btn.clicked.disconnect()
            except Exception:
                pass
            self.action_btn.clicked.connect(lambda: self.force_requested.emit(self.pin, not val))

    def update_state(self, cfg: dict):
        value = bool(cfg.get("value", False))
        self._value = value
        self._mode  = cfg.get("mode", "input")
        self.name_lbl.setText(cfg.get("name", f"GPIO {self.pin}"))

        if value:
            self.led.setStyleSheet("color: #3fb950; font-size: 12px;")
        else:
            self.led.setStyleSheet("color: #30363d; font-size: 12px;")

        self._setup_btn()


class GPIOPanel(QWidget):
    """Panneau latéral affichant tous les GPIO."""
    toggle_requested = pyqtSignal(int)
    force_requested  = pyqtSignal(int, bool)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._rows: dict[int, GPIORow] = {}
        self._build_ui()

    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll.setStyleSheet("QScrollArea { border: none; }")

        self.inner = QWidget()
        self.inner_lay = QVBoxLayout(self.inner)
        self.inner_lay.setContentsMargins(4, 4, 4, 4)
        self.inner_lay.setSpacing(2)
        self.inner_lay.setAlignment(Qt.AlignTop)

        scroll.setWidget(self.inner)
        lay.addWidget(scroll)

    def init_gpio(self, gpio_dict: dict):
        """Initialise les lignes GPIO depuis l'état initial."""
        def _k_sort(item):
            name = item[1].get("name", "")
            mode = item[1].get("mode", "input")
            import re
            # Sorties : triées par numéro Kx dans le nom, sinon par pin
            mk = re.search(r"K(\d+)", name, re.IGNORECASE)
            if mode == "output":
                return (0, int(mk.group(1)) if mk else 1000 + int(item[0]))
            # Entrées : triées par numéro TORx dans le nom, sinon par pin
            mt = re.search(r"TOR\s*(\d+)", name, re.IGNORECASE)
            return (1, int(mt.group(1)) if mt else 1000 + int(item[0]))
        for pin_str, cfg in sorted(gpio_dict.items(), key=_k_sort):
            pin = int(pin_str)
            row = GPIORow(pin, cfg)
            row.toggle_requested.connect(self.toggle_requested)
            row.force_requested.connect(self.force_requested)
            self._rows[pin] = row
            self.inner_lay.addWidget(row)

    def update_state(self, gpio_dict: dict):
        """Met à jour les LED et boutons."""
        for pin_str, cfg in gpio_dict.items():
            pin = int(pin_str)
            if pin in self._rows:
                self._rows[pin].update_state(cfg)
