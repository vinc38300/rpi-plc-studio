"""
ui/analog_config_dialog.py — Éditeur de configuration des sondes analogiques
Permet de nommer chaque sonde ANA0–ANA11 et de choisir son type (NTC10K, PT100, PT1000).
Les paramètres globaux r_ref_ohm et vcc sont aussi éditables.
"""

from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QPushButton, QComboBox, QLineEdit,
    QScrollArea, QWidget, QFrame, QGroupBox,
    QDialogButtonBox, QMessageBox, QDoubleSpinBox,
    QSizePolicy
)
from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui import QFont

# ── Types de sondes supportés ────────────────────────────────────────────────
PROBE_TYPES = [
    ("NTC10K",      "NTC 10kΩ  (B=3950) — défaut carte"),
    ("NTC10K_3977", "NTC 10kΩ  (B=3977) — précision+"),
    ("PT100",       "PT100     (100Ω  α=0.00385)"),
    ("PT1000",      "PT1000    (1000Ω α=0.00385)"),
]

# ── Adresses ADS1115 et noms des canaux ──────────────────────────────────────
ADS_INFO = [
    {"id": "ADS0", "address": "0x48", "label": "ADS1115 #1  (adresse 0x48)"},
    {"id": "ADS1", "address": "0x49", "label": "ADS1115 #2  (adresse 0x49)"},
    {"id": "ADS2", "address": "0x4A", "label": "ADS1115 #3  (adresse 0x4A)"},
]

STYLE_INPUT = """
    QLineEdit { background:#0d1117; border:1px solid #30363d;
                border-radius:4px; color:#e6edf3; padding:3px 8px; }
    QLineEdit:focus { border-color:#1f6feb; }
"""
STYLE_COMBO = """
    QComboBox { background:#0d1117; border:1px solid #30363d;
                border-radius:4px; color:#e6edf3; padding:3px 6px; }
    QComboBox::drop-down { border:none; }
    QComboBox QAbstractItemView { background:#161b22; color:#e6edf3;
                                   selection-background-color:#1f6feb; }
"""


class SondeRow(QFrame):
    """Ligne de configuration pour une sonde : identifiant, nom, type de sonde."""

    def __init__(self, ana_id: str, ch_cfg: dict, parent=None):
        super().__init__(parent)
        self.ana_id = ana_id
        self.setFrameShape(QFrame.StyledPanel)
        self.setStyleSheet(
            "QFrame { background:#161b22; border:1px solid #30363d;"
            " border-radius:6px; margin:2px; }"
        )
        self._build(ch_cfg)

    def _build(self, cfg: dict):
        lay = QHBoxLayout(self)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(10)

        # Badge identifiant (ANA0…ANA11)
        badge = QLabel(self.ana_id)
        badge.setFixedWidth(42)
        badge.setAlignment(Qt.AlignCenter)
        badge.setStyleSheet(
            "background:#0d2035; color:#58a6ff; border:1px solid #1f6feb;"
            " border-radius:4px; font-size:10px; font-weight:bold; padding:2px 4px;"
        )
        lay.addWidget(badge)

        # Nom personnalisé
        self.name_edit = QLineEdit(cfg.get("name", f"Sonde {self.ana_id[3:]}"))
        self.name_edit.setPlaceholderText("Nom (ex: Ballon ECS)")
        self.name_edit.setStyleSheet(STYLE_INPUT)
        self.name_edit.setFixedWidth(180)
        lay.addWidget(self.name_edit)

        # Type de sonde
        self.probe_combo = QComboBox()
        self.probe_combo.setStyleSheet(STYLE_COMBO)
        self.probe_combo.setFixedWidth(240)
        for val, label in PROBE_TYPES:
            self.probe_combo.addItem(label, val)
        cur_probe = cfg.get("probe", "NTC10K")
        idx = next((i for i, (v, _) in enumerate(PROBE_TYPES) if v == cur_probe), 0)
        self.probe_combo.setCurrentIndex(idx)
        lay.addWidget(self.probe_combo)

        lay.addStretch()

    def get_config(self) -> dict:
        return {
            "id":    self.ana_id,
            "name":  self.name_edit.text().strip() or f"Sonde {self.ana_id[3:]}",
            "probe": self.probe_combo.currentData(),
        }


class AnalogConfigDialog(QDialog):
    """Dialogue de configuration des 12 sondes analogiques."""

    config_changed = pyqtSignal(dict)   # émet le nouveau bloc analog complet

    def __init__(self, analog_config: dict, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Configuration Sondes Analogiques — ADS1115")
        self.setMinimumSize(700, 560)
        self.setStyleSheet("""
            QDialog    { background:#0d1117; color:#e6edf3; }
            QLabel     { color:#e6edf3; }
            QGroupBox  { color:#8b949e; border:1px solid #30363d; border-radius:6px;
                         margin-top:8px; padding-top:8px; }
            QGroupBox::title { subcontrol-origin:margin; left:8px; }
            QScrollArea { border:1px solid #30363d; border-radius:6px; }
            QDoubleSpinBox { background:#0d1117; border:1px solid #30363d;
                             border-radius:4px; color:#e6edf3; padding:3px 8px; }
        """)
        self._analog_config = analog_config
        self._rows: list[SondeRow] = []
        self._build_ui()
        self._load_config(analog_config)

    # ── Construction UI ──────────────────────────────────────────────────────
    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setSpacing(10)
        lay.setContentsMargins(14, 14, 14, 14)

        # En-tête
        hdr = QLabel("🌡 Configuration des sondes analogiques (ADS1115)")
        hdr.setStyleSheet("font-size:14px; font-weight:bold; color:#58a6ff;")
        lay.addWidget(hdr)

        info = QLabel(
            "3 modules ADS1115  ·  4 canaux chacun  ·  12 sondes ANA0–ANA11\n"
            "Choisissez le nom et le type de chaque sonde sur votre installation."
        )
        info.setStyleSheet("color:#8b949e; font-size:11px; padding:4px 0;")
        info.setWordWrap(True)
        lay.addWidget(info)

        # ── Paramètres globaux ───────────────────────────────────────────────
        glob_box = QGroupBox("Paramètres du pont diviseur (communs à toutes les sondes)")
        glob_lay = QHBoxLayout(glob_box)
        glob_lay.setSpacing(20)

        glob_lay.addWidget(QLabel("R référence (Ω) :"))
        self.rref_spin = QDoubleSpinBox()
        self.rref_spin.setRange(100, 100000)
        self.rref_spin.setDecimals(0)
        self.rref_spin.setSingleStep(100)
        self.rref_spin.setValue(float(self._analog_config.get("r_ref_ohm", 10000)))
        self.rref_spin.setFixedWidth(90)
        glob_lay.addWidget(self.rref_spin)

        glob_lay.addWidget(QLabel("VCC (V) :"))
        self.vcc_spin = QDoubleSpinBox()
        self.vcc_spin.setRange(1.8, 5.0)
        self.vcc_spin.setDecimals(2)
        self.vcc_spin.setSingleStep(0.1)
        self.vcc_spin.setValue(float(self._analog_config.get("vcc", 3.3)))
        self.vcc_spin.setFixedWidth(70)
        glob_lay.addWidget(self.vcc_spin)

        tip = QLabel("(10kΩ / 3.3V pour NTC10K standard)")
        tip.setStyleSheet("color:#484f58; font-size:10px;")
        glob_lay.addWidget(tip)
        glob_lay.addStretch()

        lay.addWidget(glob_box)

        # ── Zone scrollable des sondes ───────────────────────────────────────
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        self.rows_widget = QWidget()
        self.rows_lay = QVBoxLayout(self.rows_widget)
        self.rows_lay.setContentsMargins(6, 6, 6, 6)
        self.rows_lay.setSpacing(4)
        self.rows_lay.setAlignment(Qt.AlignTop)
        scroll.setWidget(self.rows_widget)
        lay.addWidget(scroll, 1)

        # ── Légende types ────────────────────────────────────────────────────
        legend = QLabel(
            "NTC 10kΩ : thermistance standard (B=3950 ou 3977)   "
            "PT100/PT1000 : sonde platine industrielle"
        )
        legend.setStyleSheet("color:#484f58; font-size:10px;")
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

    # ── Chargement ───────────────────────────────────────────────────────────
    def _load_config(self, analog_config: dict):
        # Vider les lignes existantes
        for row in self._rows:
            row.setParent(None)
            row.deleteLater()
        self._rows.clear()

        ads_list = analog_config.get("ads", [])

        for ads_idx, ads_info in enumerate(ADS_INFO):
            # Séparateur de groupe ADS
            sep = QLabel(f"  {ads_info['label']}")
            sep.setStyleSheet(
                "color:#58a6ff; font-size:11px; font-weight:bold;"
                " padding:6px 4px 2px; background:transparent;"
            )
            self.rows_lay.addWidget(sep)

            # Trouver les données config pour ce ADS
            ads_cfg = next(
                (a for a in ads_list if a.get("address") == ads_info["address"]),
                {"channels": []}
            )
            channels = ads_cfg.get("channels", [])

            for ch_idx in range(4):
                ana_id = f"ANA{ads_idx * 4 + ch_idx}"
                ch_cfg = channels[ch_idx] if ch_idx < len(channels) else {}
                row = SondeRow(ana_id, ch_cfg)
                self._rows.append(row)
                self.rows_lay.addWidget(row)

    # ── Validation ───────────────────────────────────────────────────────────
    def _on_accept(self):
        """Construit le nouveau dict analog et émet config_changed."""
        r_ref = self.rref_spin.value()
        vcc   = self.vcc_spin.value()

        new_ads = []
        for ads_idx, ads_info in enumerate(ADS_INFO):
            channels = []
            for ch_idx in range(4):
                row_idx = ads_idx * 4 + ch_idx
                row = self._rows[row_idx]
                channels.append(row.get_config())
            new_ads.append({
                "id":       ads_info["id"],
                "address":  ads_info["address"],
                "channels": channels,
            })

        new_config = dict(self._analog_config)
        new_config["r_ref_ohm"] = r_ref
        new_config["vcc"]       = vcc
        new_config["ads"]       = new_ads

        self._analog_config = new_config
        self.config_changed.emit(new_config)
        self.accept()

    def get_config(self) -> dict:
        return self._analog_config
