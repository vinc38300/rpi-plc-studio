"""
ui/regulech_view.py — Vue embarquée du synoptique de régulation thermique.
Charge synoptique_regulech.html via QWebEngineView avec l'URL RPi configurée.
Permet l'interaction complète (consignes, forçages, horaires) sans quitter PLC Studio.
"""

from PyQt5.QtWidgets import QWidget, QVBoxLayout, QHBoxLayout, QLabel, QPushButton, QLineEdit
from PyQt5.QtCore    import Qt, QUrl, QTimer
from PyQt5.QtGui     import QFont

try:
    from PyQt5.QtWebEngineWidgets import QWebEngineView
    WEBENGINE_OK = True
except ImportError:
    WEBENGINE_OK = False


class RegulationView(QWidget):
    """
    Onglet de synoptique de régulation thermique embarqué.
    Charge la page /regulech du serveur RPi dans un QWebEngineView.
    """

    def __init__(self, parent=None):
        super().__init__(parent)
        self._host = "192.168.1.49"
        self._port = 5000
        self._build_ui()

    # ── Construction UI ───────────────────────────────────────────────────────
    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ── Bandeau de connexion ──────────────────────────────────────────────
        header = QWidget()
        header.setStyleSheet(
            "background:#0d1117; border-bottom:1px solid #30363d;"
        )
        header.setFixedHeight(38)
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(10, 0, 10, 0)
        h_lay.setSpacing(8)

        logo = QLabel("🌡  <b>Synoptique Régulation</b>")
        logo.setStyleSheet("color:#3fb950; font-size:13px;")
        h_lay.addWidget(logo)

        h_lay.addStretch()

        lbl = QLabel("Serveur RPi :")
        lbl.setStyleSheet("color:#8b949e; font-size:11px;")
        h_lay.addWidget(lbl)

        self._url_edit = QLineEdit(f"http://{self._host}:{self._port}/regulech")
        self._url_edit.setStyleSheet(
            "QLineEdit{background:#161b22;border:1px solid #30363d;"
            "border-radius:4px;color:#e6edf3;padding:2px 8px;"
            "font-family:'JetBrains Mono';font-size:11px;}"
            "QLineEdit:focus{border-color:#3fb950;}"
        )
        self._url_edit.setFixedWidth(320)
        self._url_edit.returnPressed.connect(self._navigate)
        h_lay.addWidget(self._url_edit)

        btn_go = QPushButton("Connecter")
        btn_go.setStyleSheet(
            "QPushButton{background:#1a3a2a;border:1px solid #2ea043;"
            "color:#3fb950;border-radius:4px;padding:3px 14px;font-size:11px;}"
            "QPushButton:hover{background:#2ea043;color:#fff;}"
        )
        btn_go.clicked.connect(self._navigate)
        h_lay.addWidget(btn_go)

        btn_reload = QPushButton("↻")
        btn_reload.setToolTip("Recharger la page")
        btn_reload.setFixedWidth(32)
        btn_reload.setStyleSheet(
            "QPushButton{background:#161b22;border:1px solid #30363d;"
            "color:#8b949e;border-radius:4px;font-size:14px;}"
            "QPushButton:hover{border-color:#58a6ff;color:#58a6ff;}"
        )
        btn_reload.clicked.connect(self._reload)
        h_lay.addWidget(btn_reload)

        lay.addWidget(header)

        # ── Contenu principal ─────────────────────────────────────────────────
        if WEBENGINE_OK:
            self.view = QWebEngineView()
            self.view.setStyleSheet("background:#0d1117;")
            lay.addWidget(self.view, 1)
            # Charger immédiatement
            self._navigate()
        else:
            # Fallback : message d'erreur si QtWebEngine non dispo
            err = QLabel(
                "⚠ PyQtWebEngine non installé.\n\n"
                "Installer avec : pip3 install PyQtWebEngine"
            )
            err.setAlignment(Qt.AlignCenter)
            err.setStyleSheet("color:#f85149; font-size:14px;")
            err.setFont(QFont("Outfit", 12))
            lay.addWidget(err, 1)

    # ── Navigation ────────────────────────────────────────────────────────────
    def _navigate(self):
        if not WEBENGINE_OK:
            return
        url = self._url_edit.text().strip()
        if not url.startswith("http"):
            url = "http://" + url
        self.view.load(QUrl(url))

    def _reload(self):
        if WEBENGINE_OK:
            self.view.reload()

    # ── API publique (appelée depuis MainWindow) ───────────────────────────────
    def set_rpi_config(self, host: str, port: int = 5000):
        """Met à jour l'URL quand la config RPi change."""
        self._host = host
        self._port = port
        url = f"http://{host}:{port}/regulech"
        self._url_edit.setText(url)
        # Recharger si l'onglet est visible
        if self.isVisible() and WEBENGINE_OK:
            self.view.load(QUrl(url))
