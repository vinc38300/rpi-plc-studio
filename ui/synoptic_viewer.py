"""
ui/synoptic_viewer.py — Visionneuse plein écran du synoptique RPi
Affiche http://{host}:{port}/synoptic dans un QWebEngineView plein écran.
Pas d'édition : lecture seule, vue opérateur uniquement.
"""

from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QLabel,
    QPushButton, QWidget, QMessageBox, QApplication
)
from PyQt5.QtCore import Qt, QUrl, QTimer
from PyQt5.QtGui import QKeySequence
from PyQt5.QtWidgets import QShortcut

try:
    from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEnginePage
    _HAS_WEBENGINE = True
except ImportError:
    _HAS_WEBENGINE = False


class SynopticViewer(QDialog):
    """
    Fenêtre plein écran (non-modale) qui ouvre le synoptique du RPi.

    Usage :
        viewer = SynopticViewer(parent)
        viewer.open_rpi(host="192.168.1.50", port=5000)
    """

    def keyPressEvent(self, event):
        if event.key() in (Qt.Key_Return, Qt.Key_Enter):
            event.ignore()
        elif event.key() == Qt.Key_Escape:
            self._close_viewer()
        else:
            super().keyPressEvent(event)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowModality(Qt.NonModal)
        self.setWindowTitle("RPi-PLC Studio — Vue Synoptique")
        self.setWindowFlags(
            Qt.Window |
            Qt.WindowMinimizeButtonHint |
            Qt.WindowMaximizeButtonHint |
            Qt.WindowCloseButtonHint
        )
        self._url = ""
        self._build_ui()
        QShortcut(QKeySequence("Escape"), self, self._close_viewer)
        QShortcut(QKeySequence("F8"),     self, self._close_viewer)
        QShortcut(QKeySequence("F5"),     self, self._reload)

    # ── Construction UI ───────────────────────────────────────────────────────
    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        # ── Bandeau d'en-tête ─────────────────────────────────────────────────
        header = QWidget()
        header.setStyleSheet(
            "background:#0d1117; border-bottom:1px solid #30363d;"
        )
        header.setFixedHeight(38)
        h_lay = QHBoxLayout(header)
        h_lay.setContentsMargins(12, 0, 12, 0)
        h_lay.setSpacing(8)

        logo = QLabel("🖥  <b>Vue Synoptique</b>")
        logo.setStyleSheet("color:#58a6ff; font-size:13px;")
        h_lay.addWidget(logo)

        self._url_label = QLabel("")
        self._url_label.setStyleSheet("color:#484f58; font-size:11px;")
        h_lay.addWidget(self._url_label)

        h_lay.addStretch()

        # Bouton Recharger
        reload_btn = QPushButton("↺ F5")
        reload_btn.setToolTip("Recharger la page (F5)")
        reload_btn.setStyleSheet(self._btn_style())
        reload_btn.clicked.connect(self._reload)
        h_lay.addWidget(reload_btn)

        # Bouton Plein écran
        self._fs_btn = QPushButton("⛶ Plein écran")
        self._fs_btn.setToolTip("Basculer en plein écran")
        self._fs_btn.setStyleSheet(self._btn_style())
        self._fs_btn.clicked.connect(self._toggle_fullscreen)
        h_lay.addWidget(self._fs_btn)

        # Bouton Fermer
        close_btn = QPushButton("✕ Fermer  Esc")
        close_btn.setToolTip("Fermer la visionneuse (Esc)")
        close_btn.setStyleSheet(self._btn_style("#c9356a"))
        close_btn.clicked.connect(self._close_viewer)
        h_lay.addWidget(close_btn)

        lay.addWidget(header)

        # ── Zone principale ───────────────────────────────────────────────────
        if _HAS_WEBENGINE:
            self._view = QWebEngineView(self)
            self._view.setContextMenuPolicy(Qt.NoContextMenu)
            lay.addWidget(self._view, 1)
        else:
            # Fallback : afficher un message avec lien
            self._view = None
            placeholder = QWidget()
            placeholder.setStyleSheet("background:#0d1117;")
            p_lay = QVBoxLayout(placeholder)
            p_lay.setAlignment(Qt.AlignCenter)
            msg = QLabel(
                "<b style='color:#f0f6fc;font-size:16px;'>PyQtWebEngine non disponible</b><br><br>"
                "<span style='color:#8b949e;'>Installez-le avec :<br>"
                "<code style='color:#58a6ff;'>pip3 install PyQtWebEngine</code></span><br><br>"
                "<span style='color:#8b949e;'>En attendant, utilisez le bouton<br>"
                "<b style='color:#58a6ff;'>Ouvrir dans le navigateur</b> ci-dessous.</span>"
            )
            msg.setAlignment(Qt.AlignCenter)
            msg.setTextFormat(Qt.RichText)
            p_lay.addWidget(msg)

            open_btn = QPushButton("🌐 Ouvrir dans le navigateur")
            open_btn.setStyleSheet(
                "QPushButton{background:#1f6feb;color:#fff;border:none;"
                "border-radius:6px;padding:8px 24px;font-size:13px;}"
                "QPushButton:hover{background:#388bfd;}"
            )
            open_btn.clicked.connect(self._open_in_browser)
            p_lay.addWidget(open_btn, alignment=Qt.AlignCenter)

            lay.addWidget(placeholder, 1)

    @staticmethod
    def _btn_style(accent="#30363d"):
        return (
            f"QPushButton{{background:#161b22;border:1px solid {accent};"
            f"color:#8b949e;border-radius:5px;padding:3px 12px;font-size:11px;}}"
            f"QPushButton:hover{{border-color:#58a6ff;color:#58a6ff;}}"
        )

    # ── API publique ──────────────────────────────────────────────────────────
    def open_rpi(self, host: str, port: int = 5000):
        """Ouvre le synoptique du RPi à l'adresse donnée."""
        url = f"http://{host}:{port}/maison"
        self._url = url
        self._url_label.setText(url)

        if _HAS_WEBENGINE and self._view:
            self._view.setUrl(QUrl(url))
        # showMaximized pour un effet plein écran naturel
        self.showMaximized()
        self.raise_()
        self.activateWindow()

    def open_url(self, url: str):
        """Ouvre une URL arbitraire."""
        self._url = url
        self._url_label.setText(url)
        if _HAS_WEBENGINE and self._view:
            self._view.setUrl(QUrl(url))
        self.showMaximized()
        self.raise_()
        self.activateWindow()

    # ── Slots internes ────────────────────────────────────────────────────────
    def _reload(self):
        if _HAS_WEBENGINE and self._view:
            self._view.reload()
        elif self._url:
            self._open_in_browser()

    def _toggle_fullscreen(self):
        if self.isFullScreen():
            self.showMaximized()
            self._fs_btn.setText("⛶ Plein écran")
        else:
            self.showFullScreen()
            self._fs_btn.setText("⊡ Fenêtré")

    def _open_in_browser(self):
        if self._url:
            import webbrowser
            webbrowser.open(self._url)

    def _close_viewer(self):
        if self.isFullScreen():
            self.showMaximized()
        self.hide()

    def closeEvent(self, event):
        event.ignore()
        self.hide()
