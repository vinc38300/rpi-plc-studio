"""
ui/gpio_config_dialog.py — Éditeur de configuration GPIO RPi
Permet de choisir librement les entrées/sorties GPIO
sauf les pins réservés aux sondes (I²C ADS1115).
"""

from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QComboBox, QLineEdit,
    QScrollArea, QWidget, QFrame, QGroupBox,
    QCheckBox, QDialogButtonBox, QMessageBox,
    QSplitter, QToolButton, QSizePolicy
)
from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui import QFont, QColor


# ── Pins RPi BCM réservés (I²C pour ADS1115) ────────────────────────────────
# Seuls GPIO 2 et 3 sont vraiment réservés (I²C pour ADS1115)
# Tous les autres peuvent être utilisés librement
RESERVED_PINS = {
    2: "I²C SDA (ADS1115)",
    3: "I²C SCL (ADS1115)",
}

# ── Pins avec avertissement (informatif seulement, pas bloquant) ─────────────
WARN_PINS = {
    14: "UART TX",
    15: "UART RX",
}

# ── Tous les pins BCM disponibles ────────────────────────────────────────────
ALL_BCM_PINS = [p for p in range(2, 28) if p not in RESERVED_PINS]

# ── Noms BCM ─────────────────────────────────────────────────────────────────
BCM_NAMES = {
    4: "GPIO4", 5: "GPIO5", 6: "GPIO6",
    7: "GPIO7", 8: "GPIO8", 10: "GPIO10(MOSI)",
    12: "GPIO12(PWM)", 13: "GPIO13(PWM)",
    14: "GPIO14(TX)", 15: "GPIO15(RX)",
    16: "GPIO16", 17: "GPIO17", 18: "GPIO18",
    19: "GPIO19", 20: "GPIO20", 21: "GPIO21",
    22: "GPIO22", 23: "GPIO23", 24: "GPIO24",
    25: "GPIO25", 26: "GPIO26", 27: "GPIO27",
}


class GPIORow(QFrame):
    """Ligne de configuration pour un GPIO : pin, nom, mode, pull."""
    
    removed = pyqtSignal(object)  # self

    def __init__(self, pin: int, cfg: dict, used_pins: set, parent=None):
        super().__init__(parent)
        self.setFrameShape(QFrame.StyledPanel)
        self.setStyleSheet("""
            QFrame { background: #161b22; border: 1px solid #30363d;
                     border-radius: 6px; margin: 2px; }
        """)
        self._used_pins = used_pins
        self._build(pin, cfg)

    def _build(self, pin: int, cfg: dict):
        lay = QHBoxLayout(self)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(8)

        # ── Sélecteur de pin ─────────────────────────────────────────────────
        self.pin_combo = QComboBox()
        self.pin_combo.setFixedWidth(150)
        self.pin_combo.setStyleSheet("""
            QComboBox { background:#0d1117; border:1px solid #30363d;
                        border-radius:4px; color:#e6edf3; padding:3px 6px; }
            QComboBox::drop-down { border:none; }
            QComboBox QAbstractItemView { background:#161b22; color:#e6edf3;
                                          selection-background-color:#1f6feb; }
        """)
        for p in ALL_BCM_PINS:
            label = f"GPIO {p:2d}"
            if p in WARN_PINS:
                label += f"  ⚠ {WARN_PINS[p]}"
            self.pin_combo.addItem(label, p)
        # Sélectionner le pin actuel
        idx = self.pin_combo.findData(pin)
        if idx >= 0:
            self.pin_combo.setCurrentIndex(idx)
        lay.addWidget(self.pin_combo)

        # ── Nom personnalisé ─────────────────────────────────────────────────
        self.name_edit = QLineEdit(cfg.get("name", f"GPIO{pin}"))
        self.name_edit.setPlaceholderText("Nom (ex: Pompe ECS)")
        self.name_edit.setStyleSheet("""
            QLineEdit { background:#0d1117; border:1px solid #30363d;
                        border-radius:4px; color:#e6edf3; padding:3px 8px; }
            QLineEdit:focus { border-color:#1f6feb; }
        """)
        self.name_edit.setFixedWidth(160)
        lay.addWidget(self.name_edit)

        # ── Mode ─────────────────────────────────────────────────────────────
        self.mode_combo = QComboBox()
        self.mode_combo.setFixedWidth(90)
        self.mode_combo.setStyleSheet(self.pin_combo.styleSheet())
        self.mode_combo.addItem("🔴 Sortie", "output")
        self.mode_combo.addItem("🔵 Entrée", "input")
        idx = 0 if cfg.get("mode", "output") == "output" else 1
        self.mode_combo.setCurrentIndex(idx)
        self.mode_combo.currentIndexChanged.connect(self._on_mode_changed)
        lay.addWidget(self.mode_combo)

        # ── Pull (entrées) ───────────────────────────────────────────────────
        self.pull_combo = QComboBox()
        self.pull_combo.setFixedWidth(90)
        self.pull_combo.setStyleSheet(self.pin_combo.styleSheet())
        self.pull_combo.addItem("Pull-up",   "up")
        self.pull_combo.addItem("Pull-down", "down")
        self.pull_combo.addItem("Flottant",  "off")
        pull = cfg.get("pull", "up")
        idx = {"up": 0, "down": 1, "off": 2}.get(pull, 0)
        self.pull_combo.setCurrentIndex(idx)
        lay.addWidget(self.pull_combo)

        # ── Active-low ───────────────────────────────────────────────────────
        self.active_low_cb = QCheckBox("Active-low")
        self.active_low_cb.setChecked(cfg.get("active_low", True))
        self.active_low_cb.setToolTip(
            "Coché : relais ON quand GPIO LOW (carte relais classique)\n"
            "Décoché : relais ON quand GPIO HIGH"
        )
        self.active_low_cb.setStyleSheet("color: #8b949e; font-size: 10px;")
        lay.addWidget(self.active_low_cb)

        lay.addStretch()

        # ── Bouton supprimer ─────────────────────────────────────────────────
        del_btn = QToolButton()
        del_btn.setText("✕")
        del_btn.setFixedSize(22, 22)
        del_btn.setStyleSheet("""
            QToolButton { background:#2d1b1b; color:#f85149; border:1px solid #3d1b1b;
                          border-radius:4px; font-weight:bold; }
            QToolButton:hover { background:#3d1b1b; }
        """)
        del_btn.clicked.connect(lambda: self.removed.emit(self))
        lay.addWidget(del_btn)

        self._on_mode_changed()

    def _on_mode_changed(self):
        is_input = self.mode_combo.currentData() == "input"
        self.pull_combo.setEnabled(is_input)
        self.pull_combo.setVisible(is_input)
        self.active_low_cb.setEnabled(not is_input)
        self.active_low_cb.setVisible(not is_input)

    def get_config(self) -> tuple[int, dict]:
        pin = self.pin_combo.currentData()
        mode = self.mode_combo.currentData()
        cfg = {
            "name": self.name_edit.text().strip() or f"GPIO{pin}",
            "mode": mode,
        }
        if mode == "input":
            cfg["pull"] = self.pull_combo.currentData()
        else:
            cfg["active_low"] = self.active_low_cb.isChecked()
        return pin, cfg

    def get_pin(self) -> int:
        return self.pin_combo.currentData()


class GPIOConfigDialog(QDialog):
    """Dialogue de configuration complète des GPIO RPi."""

    config_changed = pyqtSignal(dict)  # émet le nouveau config.gpio dict

    def __init__(self, gpio_config: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Configuration GPIO — Raspberry Pi")
        self.setMinimumSize(780, 560)
        self.setStyleSheet("""
            QDialog { background: #0d1117; color: #e6edf3; }
            QLabel  { color: #e6edf3; }
            QGroupBox { color: #8b949e; border: 1px solid #30363d;
                        border-radius: 6px; margin-top: 8px; padding-top: 8px; }
            QGroupBox::title { subcontrol-origin: margin; left: 8px; }
        """)
        self._gpio_config = dict(gpio_config)
        self._rows: list[GPIORow] = []
        self._build_ui()
        self._load_config(gpio_config)

    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setSpacing(10)
        lay.setContentsMargins(14, 14, 14, 14)

        # ── En-tête ──────────────────────────────────────────────────────────
        hdr = QLabel("📌 Configuration des broches GPIO")
        hdr.setStyleSheet("font-size: 14px; font-weight: bold; color: #58a6ff;")
        lay.addWidget(hdr)

        info = QLabel(
            "⚠  GPIO 2 et 3 réservés (I²C ADS1115).  "
            "Choisissez librement les autres broches pour vos entrées/sorties."
        )
        info.setStyleSheet("color: #d29922; font-size: 11px; padding: 4px 0;")
        info.setWordWrap(True)
        lay.addWidget(info)

        # ── Zone scrollable des GPIO ─────────────────────────────────────────
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setStyleSheet("QScrollArea { border: 1px solid #30363d; border-radius:6px; }")
        self.rows_widget = QWidget()
        self.rows_lay = QVBoxLayout(self.rows_widget)
        self.rows_lay.setContentsMargins(6, 6, 6, 6)
        self.rows_lay.setSpacing(4)
        self.rows_lay.setAlignment(Qt.AlignTop)
        scroll.setWidget(self.rows_widget)
        lay.addWidget(scroll, 1)

        # ── Boutons d'ajout rapide ────────────────────────────────────────────
        add_row = QHBoxLayout()
        add_row.setSpacing(8)

        btn_add_out = QPushButton("＋ Ajouter une Sortie")
        btn_add_out.setStyleSheet("""
            QPushButton { background:#1a2f1a; color:#3fb950; border:1px solid #238636;
                          border-radius:5px; padding:6px 14px; font-weight:bold; }
            QPushButton:hover { background:#238636; color:#fff; }
        """)
        btn_add_out.clicked.connect(lambda: self._add_row(mode="output"))
        add_row.addWidget(btn_add_out)

        btn_add_in = QPushButton("＋ Ajouter une Entrée")
        btn_add_in.setStyleSheet("""
            QPushButton { background:#0d1f35; color:#58a6ff; border:1px solid #1f6feb;
                          border-radius:5px; padding:6px 14px; font-weight:bold; }
            QPushButton:hover { background:#1f6feb; color:#fff; }
        """)
        btn_add_in.clicked.connect(lambda: self._add_row(mode="input"))
        add_row.addWidget(btn_add_in)

        btn_clear = QPushButton("🗑 Tout effacer")
        btn_clear.setStyleSheet("""
            QPushButton { background:#2d1b1b; color:#f85149; border:1px solid #6e1c1c;
                          border-radius:5px; padding:6px 14px; }
            QPushButton:hover { background:#6e1c1c; color:#fff; }
        """)
        btn_clear.clicked.connect(self._clear_all)
        add_row.addWidget(btn_clear)

        add_row.addStretch()

        # Compteur
        self.count_lbl = QLabel("0 GPIO configurés")
        self.count_lbl.setStyleSheet("color: #8b949e; font-size: 11px;")
        add_row.addWidget(self.count_lbl)

        lay.addLayout(add_row)

        # ── Légende ──────────────────────────────────────────────────────────
        legend = QLabel(
            "🔴 Sortie = relais/actionneur   🔵 Entrée = capteur/bouton   "
            "Active-low = relais ON quand GPIO=LOW (carte relais classique)"
        )
        legend.setStyleSheet("color: #484f58; font-size: 10px;")
        lay.addWidget(legend)

        # ── Boutons OK/Annuler ───────────────────────────────────────────────
        btns = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        btns.accepted.connect(self._on_accept)
        btns.rejected.connect(self.reject)
        btns.button(QDialogButtonBox.Ok).setText("✓ Appliquer")
        btns.button(QDialogButtonBox.Ok).setStyleSheet("""
            QPushButton { background:#1a2f1a; color:#3fb950; border:1px solid #238636;
                          border-radius:5px; padding:6px 20px; font-weight:bold; }
            QPushButton:hover { background:#238636; color:#fff; }
        """)
        btns.button(QDialogButtonBox.Cancel).setStyleSheet("""
            QPushButton { background:#1c2128; color:#8b949e; border:1px solid #30363d;
                          border-radius:5px; padding:6px 14px; }
            QPushButton:hover { background:#30363d; }
        """)
        lay.addWidget(btns)

    def _load_config(self, gpio_config: dict):
        """Charge la configuration existante (vide d'abord pour éviter les doublons)."""
        # Vider les lignes existantes
        for row in list(self._rows):
            row.setParent(None)
            row.deleteLater()
        self._rows.clear()
        # Trier : sorties d'abord, puis entrées, par numéro de pin
        import re as _re
        def _sort_key(item):
            mode = item[1].get("mode", "input")
            name = item[1].get("name", "")
            m = _re.search(r"K(\d+)", name)
            if mode == "output" and m:
                return (0, int(m.group(1)))
            # entrées TOR : par numéro
            t = _re.search(r"TOR(\d+)|Entr.e TOR (\d+)", name)
            if t:
                n = int(t.group(1) or t.group(2))
                return (1, n)
            return (2, int(item[0]))
        items = sorted(gpio_config.items(), key=_sort_key)
        for pin_s, cfg in items:
            self._add_row(int(pin_s), cfg)

    def _add_row(self, pin: int = None, cfg: dict = None, mode: str = "output"):
        """Ajoute une ligne GPIO."""
        used = {r.get_pin() for r in self._rows}
        if pin is None:
            # Trouver le premier pin libre
            for p in ALL_BCM_PINS:
                if p not in used:
                    pin = p
                    break
            if pin is None:
                QMessageBox.warning(self, "Plus de pins", "Tous les GPIO sont déjà utilisés.")
                return
        cfg = cfg or {"name": f"GPIO{pin}", "mode": mode,
                      "pull": "up", "active_low": True}
        row = GPIORow(pin, cfg, used)
        row.removed.connect(self._remove_row)
        row.pin_combo.currentIndexChanged.connect(self._update_count)
        self._rows.append(row)
        self.rows_lay.addWidget(row)
        self._update_count()

    def _remove_row(self, row: GPIORow):
        self._rows.remove(row)
        row.setParent(None)
        row.deleteLater()
        self._update_count()

    def _clear_all(self):
        if QMessageBox.question(
            self, "Confirmer", "Effacer toute la configuration GPIO ?",
            QMessageBox.Yes | QMessageBox.No
        ) == QMessageBox.Yes:
            for row in list(self._rows):
                row.setParent(None)
                row.deleteLater()
            self._rows.clear()
            self._update_count()

    def _update_count(self):
        n = len(self._rows)
        out = sum(1 for r in self._rows if r.mode_combo.currentData() == "output")
        inp = n - out
        self.count_lbl.setText(f"{n} GPIO  ({out} sorties, {inp} entrées)")

    def _on_accept(self):
        """Valide et collecte la config."""
        # Vérifier les doublons
        pins = [r.get_pin() for r in self._rows]
        if len(pins) != len(set(pins)):
            dupes = [p for p in pins if pins.count(p) > 1]
            QMessageBox.warning(
                self, "Doublon détecté",
                f"Les GPIO suivants sont assignés plusieurs fois : {list(set(dupes))}\n"
                "Corrigez avant de valider."
            )
            return

        # Construire le dict config
        new_config = {}
        for row in self._rows:
            pin, cfg = row.get_config()
            new_config[str(pin)] = cfg

        self._gpio_config = new_config
        self.config_changed.emit(new_config)
        self.accept()

    def get_config(self) -> dict:
        return self._gpio_config
