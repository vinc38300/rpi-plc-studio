"""
ui/synoptic_editor.py — Éditeur de synoptique embarqué via QWebEngineView

Corrections v2 :
  - Plus de boucle _initBridge() côté JS (bloquait le thread)
  - QWebChannel initialisé via loadFinished (signal fiable)
  - _buildSymGrids() différé (setTimeout 0) côté JS
  - canvas_ready déclenché par Python après loadFinished + délai
"""

import os
import json
from PyQt5.QtWidgets import QWidget, QVBoxLayout, QLabel, QHBoxLayout, QPushButton
from PyQt5.QtCore    import Qt, pyqtSignal, QUrl, QObject, pyqtSlot, QTimer
from PyQt5.QtGui     import QFont

try:
    from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineScript, QWebEnginePage

    class _DebugPage(QWebEnginePage):
        def javaScriptConsoleMessage(self, level, message, line, source):
            prefix = ['DBG','INF','WRN','ERR'][min(level,3)]
            print(f"js[{prefix}] {source}:{line} — {message}")
    from PyQt5.QtWebChannel       import QWebChannel
    HAS_WEBENGINE = True
except ImportError:
    HAS_WEBENGINE = False


# ═══════════════════════════════════════════════════════════════════════════════
# BRIDGE JS → PYTHON
# Noms de signaux distincts des noms de slots pour éviter le conflit PyQt5
# ═══════════════════════════════════════════════════════════════════════════════
class SynBridge(QObject):
    synoptic_saved     = pyqtSignal(str)
    canvas_ready       = pyqtSignal()
    sig_gpio_write     = pyqtSignal(str, float)
    sig_register_write = pyqtSignal(str, float)
    sig_memory_write   = pyqtSignal(str, float)
    sig_plc_action     = pyqtSignal(str, str)
    sig_av_write       = pyqtSignal(str, float)   # (varname, value)
    sig_dv_write       = pyqtSignal(str, bool)    # (varname, value)
    sig_analog_celsius = pyqtSignal(str, float)   # (ref, celsius) pour simulation
    sig_open_doc       = pyqtSignal()              # F1 depuis synoptique

    @pyqtSlot(str)
    def on_synoptic_saved(self, json_str: str):
        self.synoptic_saved.emit(json_str)

    @pyqtSlot(str)
    def on_canvas_ready(self, _: str):
        self.canvas_ready.emit()

    @pyqtSlot(str, float)
    def gpio_write(self, pin: str, value: float):
        self.sig_gpio_write.emit(pin, value)

    @pyqtSlot(str, float)
    def register_write(self, ref: str, value: float):
        self.sig_register_write.emit(ref, value)

    @pyqtSlot(str, float)
    def memory_write(self, ref: str, value: float):
        self.sig_memory_write.emit(ref, value)

    @pyqtSlot(str, str)
    def plc_action(self, action: str, var_ref: str):
        self.sig_plc_action.emit(action, var_ref)

    @pyqtSlot(str, float)
    def set_analog_celsius(self, ref: str, celsius: float):
        """Simulation : forcer une valeur °C directement sur une sonde."""
        self.sig_analog_celsius.emit(ref, celsius)

    @pyqtSlot(str)
    def open_doc(self, _section: str = ''):
        """F1 depuis le canvas synoptique → ouvrir la documentation."""
        self.sig_open_doc.emit()

    @pyqtSlot(str, float)
    def av_write(self, varname: str, value: float):
        """Appelé depuis le synoptique quand l'opérateur saisit une consigne AV."""
        self.sig_av_write.emit(varname, value)

    @pyqtSlot(str, 'QVariant')
    def dv_write(self, varname: str, value):
        """Appelé depuis le synoptique quand l'opérateur actionne un bouton DV."""
        # Forcer la conversion bool robuste : '0', 0, False → False ; '1', 1, True → True
        bval = bool(value) if not isinstance(value, str) else (value not in ('0', 'false', 'False', ''))
        self.sig_dv_write.emit(varname, bval)


# ═══════════════════════════════════════════════════════════════════════════════
# WIDGET PRINCIPAL
# ═══════════════════════════════════════════════════════════════════════════════
class SynopticEditor(QWidget):
    """
    Éditeur de synoptique via QWebEngineView.
    Utilisé comme enfant de SynopticWindow.
    """

    synoptic_changed = pyqtSignal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._synoptic     = {}
        self._ready        = False
        self._pending_load = None   # données à charger dès que prêt
        self._build_ui()

    # ── Construction ──────────────────────────────────────────────────────────
    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        if not HAS_WEBENGINE:
            lbl = QLabel(
                "QtWebEngine non disponible.\n\n"
                "Installer :\n"
                "  sudo apt install python3-pyqt5.qtwebengine\n"
                "  pip3 install PyQtWebEngine"
            )
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet("color:#f85149;font-size:13px;padding:40px;")
            lay.addWidget(lbl)
            return

        # ── WebEngineView ─────────────────────────────────────────────────────
        self.view    = QWebEngineView()
        if HAS_WEBENGINE:
            self._debug_page = _DebugPage()
            self.view.setPage(self._debug_page)
        self.bridge  = SynBridge()
        self.channel = QWebChannel()
        self.channel.registerObject("synbridge", self.bridge)
        self.view.page().setWebChannel(self.channel)

        # Injection QWebChannel côté JS.
        # On utilise DocumentReady (pas DocumentCreation) + MainWorld
        # pour s'assurer que le DOM est disponible avant l'exécution.
        init_js = QWebEngineScript()
        init_js.setName("qwebchannel_init")
        init_js.setSourceCode("""
            (function() {
                var s = document.createElement('script');
                s.src = 'qrc:///qtwebchannel/qwebchannel.js';
                s.onload = function() {
                    new QWebChannel(qt.webChannelTransport, function(channel) {
                        window.pybridge = channel.objects.synbridge;
                    });
                };
                (document.head || document.documentElement).appendChild(s);
            })();
        """)
        init_js.setInjectionPoint(QWebEngineScript.DocumentReady)
        init_js.setWorldId(QWebEngineScript.MainWorld)
        init_js.setRunsOnSubFrames(False)
        self.view.page().scripts().insert(init_js)

        # loadFinished est le seul signal fiable pour savoir que la page
        # est entièrement chargée ET que QWebChannel a eu le temps de s'init.
        # On ajoute un délai de 300ms de sécurité.
        self.view.loadFinished.connect(self._on_load_finished)

        html_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "synoptic_canvas.html"
        )
        # Copier dans /tmp pour éviter les problèmes de chemin avec espaces/Nextcloud
        import tempfile
        try:
            _ui_dir  = os.path.dirname(os.path.abspath(html_path))
            _js_path = os.path.join(_ui_dir, 'synoptic_canvas.js')
            with open(html_path, 'r', encoding='utf-8') as _f:
                _html = _f.read()
            if os.path.exists(_js_path):
                with open(_js_path, 'r', encoding='utf-8') as _f:
                    _js = _f.read()
                _script_tag = '<script>' + chr(10) + _js + chr(10) + '</script>'
                _html = _html.replace('<script src="synoptic_canvas.js"></script>', _script_tag)
            _tmp_dir  = tempfile.mkdtemp(prefix='rpi_plc_syn_')
            _tmp_html = os.path.join(_tmp_dir, 'synoptic_canvas.html')
            with open(_tmp_html, 'w', encoding='utf-8') as _f:
                _f.write(_html)
            print(f"[SYN] load() HTML inline depuis tmp: {_tmp_html} ({len(_html)} chars)")
            self.view.load(QUrl.fromLocalFile(_tmp_html))
        except Exception as _e:
            print(f"[SYN] Erreur: {_e}")
            self.view.load(QUrl.fromLocalFile(html_path))

        # Connexion bridge
        self.bridge.synoptic_saved.connect(self._on_saved)

        lay.addWidget(self.view, 1)

        # ── Barre de statut ───────────────────────────────────────────────────
        bar = QWidget()
        bar.setStyleSheet("background:#161b22;border-top:1px solid #30363d;")
        bar_lay = QHBoxLayout(bar)
        bar_lay.setContentsMargins(8, 3, 8, 3)
        bar_lay.setSpacing(8)

        self._status = QLabel("Chargement…")
        self._status.setStyleSheet("color:#484f58;font-size:10px;")
        bar_lay.addWidget(self._status)
        bar_lay.addStretch()

        save_btn = QPushButton("💾 Sauvegarder")
        save_btn.setStyleSheet(
            "QPushButton{background:#1a2f45;border:1px solid #58a6ff;color:#58a6ff;"
            "border-radius:5px;padding:2px 10px;font-size:10px;}"
            "QPushButton:hover{background:#1f3a55;}"
        )
        save_btn.clicked.connect(self._force_save)
        bar_lay.addWidget(save_btn)

        lay.addWidget(bar)

    # ── loadFinished → déclenchement réel du ready ────────────────────────────
    def _on_load_finished(self, ok: bool):
        if not ok:
            self._status.setText("⚠ Erreur de chargement du canvas")
            return
        # Laisser 350 ms pour que qwebchannel.js soit chargé et
        # que new QWebChannel() ait eu le temps de s'exécuter.
        QTimer.singleShot(350, self._mark_ready)

    def _mark_ready(self):
        self._ready = True
        self._status.setText("Prêt — glissez des éléments depuis la palette")
        if self._pending_load is not None:
            self._call_js(f"loadSynopticData({self._pending_load})")
            self._pending_load = None

    # ── API publique ───────────────────────────────────────────────────────────
    def load_synoptic(self, data: dict):
        """Charge un synoptique (dict) dans le canvas."""
        self._synoptic = data or {}
        # Forcer toutes les pages en mode normal (pas de popup)
        if isinstance(self._synoptic.get('pages'), list):
            for p in self._synoptic['pages']:
                p['isPopup'] = False
        json_str = json.dumps(self._synoptic)
        if self._ready:
            self._call_js(f"loadSynopticData({json_str})")
        else:
            self._pending_load = json_str

    def get_synoptic(self) -> dict:
        return self._synoptic

    def update_from_state(self, state: dict):
        """Mise à jour temps réel PLC — ignorée si pas prêt."""
        if not self._ready:
            return
        payload = {
            "cycle":     state.get("cycle", 0),
            "gpio":      {str(k): {"value": bool(v.get("value", False))}
                          for k, v in state.get("gpio", {}).items()},
            "analog":    state.get("analog", {}),
            "registers": state.get("registers", {}),
            "memory":    state.get("memory", {}),
            "av_vars":   state.get("av_vars", {}),
            "dv_vars":   state.get("dv_vars", {}),
            "pids":      state.get("pids", {}),
        }
        self._call_js(f"updatePLCState({json.dumps(payload)})")

    def set_gpio_config(self, gpio_config: dict):
        """Pousse la config GPIO dans le canvas synoptique (met à jour les listes déroulantes)."""
        if self._ready:
            import json as _json
            cfg_js = _json.dumps(gpio_config)
            self._call_js(f"window.setGpioConfig && window.setGpioConfig({cfg_js});")

    def set_operator_mode(self, enabled: bool):
        """Bascule le canvas en mode Opérateur (True) ou Édition (False)."""
        if self._ready:
            self._call_js(f"window.setOperatorMode && window.setOperatorMode({'true' if enabled else 'false'})")

    # ── Slots internes ────────────────────────────────────────────────────────
    def _on_saved(self, json_str: str):
        try:
            data = json.loads(json_str)
            self._synoptic = data
            self.synoptic_changed.emit(data)
            # Compter les widgets sur toutes les pages
            if "pages" in data:
                total = sum(len(p.get("widgets", [])) for p in data["pages"])
                npages = len(data["pages"])
                self._status.setText(
                    f"Sauvegardé — {npages} page{'s' if npages > 1 else ''}"
                    f" · {total} widget{'s' if total != 1 else ''}"
                )
            else:
                n = len(data.get("widgets", []))
                self._status.setText(
                    f"Sauvegardé — {n} widget{'s' if n > 1 else ''}"
                )
        except Exception as e:
            self._status.setText(f"Erreur : {e}")

    def _force_save(self):
        self._call_js("saveSynoptic()")

    # ── Helper ────────────────────────────────────────────────────────────────
    def _call_js(self, code: str):
        if hasattr(self, "view"):
            self.view.page().runJavaScript(code)
