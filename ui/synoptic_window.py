"""
ui/synoptic_window.py — Fenêtre dédiée à l'éditeur de synoptique
Ouverte depuis la toolbar ou le menu RPi, indépendante de la fenêtre principale.
"""

from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QWidget, QSizePolicy
)
from PyQt5.QtCore import Qt, pyqtSignal
from PyQt5.QtGui  import QFont, QKeySequence
from PyQt5.QtWidgets import QShortcut

from ui.synoptic_editor import SynopticEditor


class SynopticWindow(QDialog):
    """
    Fenêtre flottante (non-modale) contenant l'éditeur de synoptique.
    Reste au-dessus de la fenêtre principale mais ne la bloque pas.

    Signaux :
        synoptic_changed(dict) — relayé depuis SynopticEditor
    """

    synoptic_changed = pyqtSignal(dict)

    def keyPressEvent(self, event):
        """Empêche Entrée et Échap de fermer la fenêtre synoptique.
        Ces touches doivent rester disponibles pour les widgets du canvas."""
        if event.key() in (Qt.Key_Return, Qt.Key_Enter, Qt.Key_Escape):
            event.ignore()  # ne pas propager → QDialog ne se ferme pas
        else:
            super().keyPressEvent(event)

    def __init__(self, parent=None):
        super().__init__(parent)
        # Non-modal : l'utilisateur peut continuer à travailler dans le FBD
        self.setWindowModality(Qt.NonModal)
        self.setWindowTitle("RPi-PLC Studio — Éditeur de synoptique")
        self.setMinimumSize(1000, 660)
        self.resize(1280, 800)
        self.setWindowFlags(
            Qt.Window |
            Qt.WindowMinimizeButtonHint |
            Qt.WindowMaximizeButtonHint |
            Qt.WindowCloseButtonHint
        )

        self._build_ui()
        self._build_shortcuts()

    # ── Construction UI ───────────────────────────────────────────────────────
    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ── Bandeau d'en-tête ─────────────────────────────────────────────────
        header = QWidget()
        header.setStyleSheet(
            "background:#161b22; border-bottom:1px solid #30363d;"
        )
        header.setFixedHeight(36)
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 12, 0)
        h_lay.setSpacing(10)

        logo = QLabel("🖥  <b>Éditeur de Synoptique</b>")
        logo.setStyleSheet("color:#58a6ff; font-size:13px;")
        h_lay.addWidget(logo)

        self._info_label = QLabel("Aucun widget")
        self._info_label.setStyleSheet(
            "color:#484f58; font-size:11px; padding:0 8px;"
        )
        h_lay.addWidget(self._info_label)

        h_lay.addStretch()

        # Bouton "Retour FBD" pour les utilisateurs qui ne connaissent pas Alt+Tab
        back_btn = QPushButton("← Retour FBD")
        back_btn.setStyleSheet(
            "QPushButton{background:#1c2128;border:1px solid #30363d;"
            "color:#8b949e;border-radius:5px;padding:3px 12px;font-size:11px;}"
            "QPushButton:hover{border-color:#58a6ff;color:#58a6ff;}"
        )
        back_btn.setToolTip("Fermer cette fenêtre (F8)")
        back_btn.clicked.connect(self.hide)
        h_lay.addWidget(back_btn)

        lay.addWidget(header)

        # ── Éditeur principal ─────────────────────────────────────────────────
        self.editor = SynopticEditor(self)
        self.editor.synoptic_changed.connect(self._on_editor_saved)
        lay.addWidget(self.editor, 1)

    def _build_shortcuts(self):
        # F8 pour ouvrir/fermer depuis n'importe où
        QShortcut(QKeySequence("F8"), self, self.hide)
        # Escape ferme aussi (comportement naturel)
        QShortcut(QKeySequence("Escape"), self, self.hide)

    # ── API publique (appelée depuis MainWindow) ───────────────────────────────
    def load_synoptic(self, data: dict):
        self.editor.load_synoptic(data)
        n = len(data.get("widgets", []))
        self._refresh_info(n)

    def get_synoptic(self) -> dict:
        return self.editor.get_synoptic()

    def update_from_state(self, state: dict):
        """Mise à jour temps réel PLC — seulement si la fenêtre est visible."""
        if self.isVisible():
            self.editor.update_from_state(state)

    def set_operator_mode(self, enabled: bool):
        """Bascule le synoptique en mode Opérateur ou Édition."""
        self.editor.set_operator_mode(enabled)

    # ── Slot interne ──────────────────────────────────────────────────────────
    def _on_editor_saved(self, data: dict):
        n = len(data.get("widgets", []))
        self._refresh_info(n)
        self.synoptic_changed.emit(data)

    def _refresh_info(self, n: int):
        self._info_label.setText(
            f"{n} widget{'s' if n > 1 else ''}" if n else "Aucun widget"
        )

    # ── Surcharger closeEvent pour cacher plutôt que détruire ─────────────────
    def closeEvent(self, event):
        """Cacher la fenêtre au lieu de la détruire — préserve l'état du canvas."""
        event.ignore()
        self.hide()

    def show_and_raise(self):
        """Ouvrir, mettre au premier plan et activer."""
        self.show()
        self.raise_()
        self.activateWindow()
