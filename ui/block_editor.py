"""
ui/block_editor.py — Éditeur FBD (Function Block Diagram) style Proview/IEC 61131-3
Utilise QWebEngineView + canvas HTML5 pour le dessin interactif.
"""

import os
import json
from PyQt5.QtWidgets import QWidget, QVBoxLayout, QLabel
from PyQt5.QtCore    import Qt, pyqtSignal, QUrl, QObject, pyqtSlot
from PyQt5.QtGui     import QFont

try:
    from PyQt5.QtWebEngineWidgets import QWebEngineView, QWebEngineScript, QWebEnginePage

    class _DebugPage(QWebEnginePage):
        def javaScriptConsoleMessage(self, level, message, line, source):
            prefix = ['DBG','INF','WRN','ERR'][min(level,3)]
            print(f"fbd[{prefix}] {source}:{line} — {message}")
    from PyQt5.QtWebChannel       import QWebChannel
    HAS_WEBENGINE = True
except ImportError:
    HAS_WEBENGINE = False


class PyBridge(QObject):
    """Pont JS → Python exposé via QWebChannel sous le nom 'pybridge'."""
    diagram_changed  = pyqtSignal(str)
    analog_sim_set   = pyqtSignal(str, float)   # (ref, value en V)
    analog_sim_celsius = pyqtSignal(str, float) # (ref, value en °C direct)
    open_doc_requested  = pyqtSignal()              # demande d'ouverture doc

    @pyqtSlot(str)
    def on_diagram_changed(self, json_str: str):
        self.diagram_changed.emit(json_str)

    @pyqtSlot(str, float)
    def set_analog_sim(self, ref: str, value: float):
        """Appelé depuis le curseur de simulation dans le canvas."""
        self.analog_sim_set.emit(ref, value)

    @pyqtSlot(str, float)
    def set_analog_celsius(self, ref: str, celsius: float):
        self.analog_sim_celsius.emit(ref, celsius)

    @pyqtSlot(str)
    def open_doc(self, _section: str = ''):
        """Ouvre la documentation depuis un canvas HTML (F1)."""
        self.open_doc_requested.emit()

    def set_pending_diagram(self, json_str: str):
        """Stocke un diagramme JSON en attente de récupération par get_pending_diagram."""
        self._pending_diagram = json_str

    @pyqtSlot(result=str)
    def get_pending_diagram(self) -> str:
        """Retourne le diagramme JSON en attente (appelé depuis JS via QWebChannel)."""
        d = getattr(self, '_pending_diagram', None) or '{}'
        self._pending_diagram = None
        return d

    def set_pending_state(self, json_str: str):
        """Stocke un état PLC en attente."""
        self._pending_state = json_str

    @pyqtSlot(result=str)
    def get_pending_state(self) -> str:
        """Retourne l'état PLC en attente."""
        s = getattr(self, '_pending_state', None) or '{}'
        self._pending_state = None
        return s

    @pyqtSlot(str, result=str)
    def check_pyblock_syntax(self, code: str) -> str:
        """Vérifie la syntaxe Python + analyse statique basique du code PYBLOCK.
        Retourne un JSON : {"ok": true} ou {"ok": false, "line": N, "msg": "..."}
        """
        import json, ast, tokenize, io
        if not code.strip():
            return json.dumps({"ok": True, "warnings": []})
        warnings = []
        # 1. Vérification syntaxe
        try:
            tree = ast.parse(code)
        except SyntaxError as e:
            return json.dumps({
                "ok": False,
                "line": e.lineno or 1,
                "col":  e.offset or 1,
                "msg":  str(e.msg),
                "text": str(e.text or "").strip(),
            })
        # 2. Analyse statique : détecter problèmes courants
        class _Checker(ast.NodeVisitor):
            def __init__(self):
                self.warns = []
            def visit_Import(self, node):
                for alias in node.names:
                    if alias.name not in ('math','datetime','statistics','time'):
                        self.warns.append({
                            "line": node.lineno,
                            "msg": f"import '{alias.name}' non autorisé en PYBLOCK"
                        })
            def visit_ImportFrom(self, node):
                if node.module not in ('math','datetime','statistics','time'):
                    self.warns.append({
                        "line": node.lineno,
                        "msg": f"from {node.module} import non autorisé"
                    })
            def visit_Call(self, node):
                if isinstance(node.func, ast.Name):
                    if node.func.id in ('exec','eval','open','__import__','compile'):
                        self.warns.append({
                            "line": node.lineno,
                            "msg": f"Appel interdit : {node.func.id}()"
                        })
                self.generic_visit(node)
        chk = _Checker()
        chk.visit(tree)
        # 3. Vérif variables PYBLOCK non définies (heuristique)
        known_vars = set()
        for n in ast.walk(tree):
            if isinstance(n, ast.Assign):
                for t in n.targets:
                    if isinstance(t, ast.Name): known_vars.add(t.id)
        return json.dumps({"ok": True, "warnings": chk.warns})

    @pyqtSlot(str, int, int, result=str)
    def run_pyblock_test(self, code: str, n_a: int, n_d: int) -> str:
        """Exécute le code PYBLOCK avec des valeurs test et retourne le résultat.
        Retourne un JSON avec les valeurs de sortie ou l'erreur.
        """
        import json, math, datetime, statistics, traceback
        if not code.strip():
            return json.dumps({"ok": False, "error": "Code vide"})
        # Valeurs test par défaut
        ctx = {
            **{f"A{i}": float(20 + i * 5) for i in range(1, 9)},
            **{f"d{i}": (i % 2 == 1) for i in range(1, 9)},
            **{f"I{i}": i * 10 for i in range(1, 3)},
            **{f"OA{i}": 0.0 for i in range(1, 9)},
            **{f"od{i}": False for i in range(1, 9)},
            "OI1": 0,
            "dt": 0.1, "cycle": 1,
            "state": {},
            "read_analog":    lambda ref: 25.0,
            "read_signal":    lambda ref: False,
            "write_register": lambda ref, v: None,
            "write_signal":   lambda ref, v: None,
            "math": math, "datetime": datetime, "statistics": statistics,
            "abs": abs, "min": min, "max": max, "round": round,
            "int": int, "float": float, "bool": bool, "str": str,
            "len": len, "range": range, "list": list, "dict": dict,
            "sum": sum, "sorted": sorted, "any": any, "all": all,
            "print": print,
        }
        output_lines = []
        import io, sys
        old_stdout = sys.stdout
        sys.stdout = buf = io.StringIO()
        try:
            exec(compile(code, "<test>", "exec"), {"__builtins__": {}}, ctx)
            sys.stdout = old_stdout
            output_lines = buf.getvalue().strip().splitlines()
        except Exception as e:
            sys.stdout = old_stdout
            tb = traceback.extract_tb(e.__traceback__)
            line = tb[-1].lineno if tb else 1
            return json.dumps({
                "ok": False,
                "line": line,
                "error": f"{type(e).__name__}: {e}",
                "print": buf.getvalue().strip().splitlines(),
            })
        outputs = {}
        for i in range(1, 9):
            v = ctx.get(f"OA{i}", 0.0)
            if v != 0.0: outputs[f"OA{i}"] = round(float(v), 4)
        for i in range(1, 9):
            v = ctx.get(f"od{i}", False)
            if v: outputs[f"od{i}"] = bool(v)
        if ctx.get("OI1", 0) != 0: outputs["OI1"] = int(ctx["OI1"])
        return json.dumps({
            "ok": True,
            "outputs": outputs,
            "state": {k: str(v)[:80] for k, v in ctx["state"].items()},
            "print": output_lines,
        })

    @pyqtSlot(str)
    def save_group_library(self, json_str: str):
        """Sauvegarde la bibliothèque de groupes dans un fichier JSON."""
        import os, json
        lib_dir = os.path.join(os.path.expanduser('~'), '.rpi-plc-studio')
        os.makedirs(lib_dir, exist_ok=True)
        lib_path = os.path.join(lib_dir, 'group_library.json')
        try:
            with open(lib_path, 'w', encoding='utf-8') as f:
                f.write(json_str)
        except Exception as e:
            print(f"[Library] Erreur sauvegarde: {e}")

    @pyqtSlot(result=str)
    def load_group_library(self) -> str:
        """Charge la bibliothèque de groupes. Retourne le JSON (max 60KB)
        ou un chemin /tmp si le JSON est trop grand pour QWebChannel."""
        import os, json, tempfile, shutil
        lib_path = os.path.join(os.path.expanduser('~'), '.rpi-plc-studio', 'group_library.json')
        try:
            if os.path.exists(lib_path):
                with open(lib_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                # QWebChannel limite les retours à ~64KB
                # Si la bibliothèque est trop grande, passer par un fichier /tmp
                if len(content) < 60000:
                    return content
                else:
                    # Copier dans /tmp et retourner un marqueur spécial
                    tmp_lib = os.path.join(tempfile.gettempdir(), 'rpi_plc_group_lib.json')
                    shutil.copy(lib_path, tmp_lib)
                    return '__FILE__:' + tmp_lib
        except Exception as e:
            print(f"[Library] Erreur chargement: {e}")
        return '{}'  


class BlockEditor(QWidget):
    """
    Éditeur FBD embarqué via QWebEngineView.
    Émet program_changed(list) à chaque modification.
    """
    program_changed = pyqtSignal(list)
    diagram_changed = pyqtSignal(dict)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._diagram = {"blocks": [], "wires": []}
        self._build_ui()

    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)

        if not HAS_WEBENGINE:
            lbl = QLabel(
                "QtWebEngine non disponible.\n\n"
                "Installer avec :\n"
                "  sudo apt install python3-pyqt5.qtwebengine\n"
                "  pip3 install PyQtWebEngine"
            )
            lbl.setAlignment(Qt.AlignCenter)
            lbl.setStyleSheet("color:#f85149;font-size:13px;padding:40px;")
            lay.addWidget(lbl)
            return

        self.view   = QWebEngineView()
        # Forcer une taille minimale pour que QtWebEngine alloue le viewport
        self.view.setMinimumSize(200, 200)
        from PyQt5.QtWidgets import QSizePolicy
        self.view.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        if HAS_WEBENGINE:
            self._debug_page = _DebugPage()
            self.view.setPage(self._debug_page)
        # Activer localStorage pour la bibliothèque de groupes
        try:
            from PyQt5.QtWebEngineWidgets import QWebEngineSettings
            settings = self.view.page().settings()
            settings.setAttribute(QWebEngineSettings.LocalStorageEnabled, True)
            settings.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
            # Définir un dossier persistant pour le profil
            profile = self.view.page().profile()
            import os
            lib_dir = os.path.join(os.path.expanduser('~'), '.rpi-plc-studio')
            os.makedirs(lib_dir, exist_ok=True)
            profile.setPersistentStoragePath(lib_dir)
            profile.setPersistentCookiesPolicy(profile.AllowPersistentCookies)
        except Exception as _e:
            pass
        self.bridge = PyBridge()
        self.channel = QWebChannel()
        self.channel.registerObject("pybridge", self.bridge)
        self.view.page().setWebChannel(self.channel)

        # Injecter le script qui initialise QWebChannel côté JS
        init_js = QWebEngineScript()
        init_js.setSourceCode("""
            (function() {
                function _injectQWC() {
                    var s = document.createElement('script');
                    s.src = 'qrc:///qtwebchannel/qwebchannel.js';
                    s.onload = function() {
                        new QWebChannel(qt.webChannelTransport, function(ch) {
                            window.pybridge = ch.objects.pybridge;
                        });
                    };
                    (document.head || document.documentElement).appendChild(s);
                }
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', _injectQWC);
                } else {
                    _injectQWC();
                }
            })();
        """)
        init_js.setInjectionPoint(QWebEngineScript.DocumentReady)
        init_js.setWorldId(QWebEngineScript.MainWorld)
        self.view.page().scripts().insert(init_js)

        html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fbd_canvas.html")
        try:
            _size = os.path.getsize(html_path)
            print(f"[FBD] Chargement canvas: {html_path} ({_size} octets)")
        except Exception:
            pass
        # Charger via setHtml() avec base_url pour éviter les problèmes de chemin
        # (espaces, partages réseau, Nextcloud, etc.)
        # Copier dans /tmp pour éviter les problèmes de chemin avec espaces/Nextcloud
        # Inliner le JS dans le HTML et sauver dans /tmp (évite pb CORS fichiers locaux)
        import tempfile
        try:
            _ui_dir   = os.path.dirname(os.path.abspath(html_path))
            _js_path  = os.path.join(_ui_dir, 'fbd_canvas.js')
            with open(html_path, 'r', encoding='utf-8') as _f:
                _html = _f.read()
            if os.path.exists(_js_path):
                with open(_js_path, 'r', encoding='utf-8') as _f:
                    _js = _f.read()
                # Pré-charger la bibliothèque de groupes directement dans le HTML
                # (évite la limite de taille de QWebChannel)
                _lib_path = os.path.join(os.path.expanduser('~'), '.rpi-plc-studio', 'group_library.json')
                _lib_json = '{}'
                try:
                    if os.path.exists(_lib_path):
                        with open(_lib_path, 'r', encoding='utf-8') as _lf:
                            _lib_json = _lf.read().strip() or '{}'
                except Exception:
                    pass
                # Injecter la bibliothèque AVANT le JS principal
                _preload = (f'<script>window._preloadedGroupLib={_lib_json};</script>\n')
                # Remplacer <script src="fbd_canvas.js"> par le JS inline
                _script_tag = '<script>' + chr(10) + _js + chr(10) + '</script>'
                _html = _html.replace('<script src="fbd_canvas.js"></script>',
                                      _preload + _script_tag)
            _tmp_dir  = tempfile.mkdtemp(prefix='rpi_plc_fbd_')
            _tmp_html = os.path.join(_tmp_dir, 'fbd_canvas.html')
            with open(_tmp_html, 'w', encoding='utf-8') as _f:
                _f.write(_html)
            print(f"[FBD] load() HTML inline depuis tmp: {_tmp_html} ({len(_html)} chars)")
            self.view.load(QUrl.fromLocalFile(_tmp_html))
        except Exception as _e:
            print(f"[FBD] Erreur: {_e}")
            self.view.load(QUrl.fromLocalFile(html_path))
        self.bridge.diagram_changed.connect(self._on_js_change)
        self.view.loadFinished.connect(self._on_canvas_loaded)
        self._pending_theme = None   # thème à appliquer quand le canvas sera prêt
        self._pending_load  = None   # diagramme à charger quand le canvas sera prêt
        self._canvas_ready  = False  # True après loadFinished
        lay.addWidget(self.view)

    # ── Thème : appliqué dès que la page est chargée ─────────────────────────
    def _on_canvas_loaded(self, ok: bool):
        """Appelé par loadFinished — appliquer thème et diagramme en attente."""
        from PyQt5.QtCore import QTimer
        self._canvas_ready = True

        # Forcer buildPalette à plusieurs délais (Qt WebEngine timing)
        _bp = "typeof buildPalette==='function' && buildPalette(); typeof buildLibraryPanel==='function' && buildLibraryPanel();"
        self.view.page().runJavaScript(_bp)
        QTimer.singleShot(100,  lambda: self.view.page().runJavaScript(_bp))
        QTimer.singleShot(400,  lambda: self.view.page().runJavaScript(_bp))
        QTimer.singleShot(1000, lambda: self.view.page().runJavaScript(_bp))

        if self._pending_theme:
            name = self._pending_theme
            self._pending_theme = None
            QTimer.singleShot(300, lambda: self.apply_theme(name))
            QTimer.singleShot(500, lambda: self.apply_theme(name))
        if self._pending_load is not None:
            data = self._pending_load
            self._pending_load = None
            QTimer.singleShot(50, lambda: self._do_load(data))

    def _do_load(self, data):
        """Effectue le chargement réel du diagramme dans le canvas JS."""
        import json as _j
        if isinstance(data, dict) and "pages" in data:
            diagram = data
        elif isinstance(data, dict) and "blocks" in data:
            diagram = {"pages": [{"id":"P1","name":"Page 1",
                                   "blocks": data["blocks"],
                                   "wires":  data["wires"]}], "curPage":0}
        elif isinstance(data, list):
            diagram = self._program_to_fbd(data)
        else:
            return
        self._diagram = diagram
        # Stocker le diagramme dans le bridge, JS l'appelle via callback
        self.bridge.set_pending_diagram(_j.dumps(diagram))
        self.view.page().runJavaScript(
            "if(window.pybridge && window.pybridge.get_pending_diagram){"
            "  window.pybridge.get_pending_diagram(function(d){"
            "    if(d && window.fbdAPI) window.fbdAPI.loadDiagram(JSON.parse(d));"
            "  });"
            "}"
        )
        # Plusieurs passes pour couvrir la latence variable de QtWebEngine
        from PyQt5.QtCore import QTimer
        _js_refresh = ("typeof _initCanvas==='function'&&_initCanvas(); "
                       "typeof resize==='function'&&resize(); "
                       "typeof fitView==='function'&&fitView(); "
                       "typeof render==='function'&&render();")
        QTimer.singleShot(200,  lambda: self.view.page().runJavaScript(_js_refresh))
        QTimer.singleShot(600,  lambda: self.view.page().runJavaScript(_js_refresh))
        QTimer.singleShot(1200, lambda: self.view.page().runJavaScript(_js_refresh))
        QTimer.singleShot(2500, lambda: self.view.page().runJavaScript(
            "typeof resize==='function'&&resize(); "
            "typeof render==='function'&&(pages&&pages.length>0)&&render();"
        ))

    def apply_theme(self, name: str):
        """Applique le thème au canvas FBD (appeler après loadFinished)."""
        js = f"window.setFbdTheme && window.setFbdTheme('{name}');"
        try:
            self.view.page().runJavaScript(js)
        except Exception:
            pass

    # ── Réception depuis JS ───────────────────────────────────────────────────
    def _on_js_change(self, json_str: str):
        try:
            data = json.loads(json_str)
            self._diagram = data
            self.diagram_changed.emit(data)
            prog = self._fbd_to_program(data)
            self.program_changed.emit(prog)
        except Exception as e:
            print(f"[FBD] Erreur : {e}")

    # ── FBD → Programme PLC linéaire ─────────────────────────────────────────
    def _flatten_page(self, page: dict) -> dict:
        """Aplatit récursivement les blocs GROUP d'une page.

        Chaque bloc GROUP encapsule un sous-programme dans params._inner_blocks.
        Cette méthode remplace chaque GROUP par ses blocs internes réels et
        reconnecte les fils qui traversaient la frontière du groupe.
        L'opération est récursive : les groupes imbriqués sont aussi aplatis.

        Returns une nouvelle page dict (sans modifier l'originale).
        """
        import json as _json, copy as _copy

        def _flatten_once(page_dict):
            """Un seul passage d'aplatissement — retourne (nouvelle_page, changed)."""
            blocks = list(page_dict.get("blocks", []))
            wires  = list(page_dict.get("wires",  []))
            changed = False

            new_blocks = []
            new_wires  = list(wires)

            for b in blocks:
                if b.get("type") != "GROUP":
                    new_blocks.append(b)
                    continue

                # ── Ce bloc est un GROUP — on l'aplatit ──────────────────
                changed = True
                gid   = b["id"]
                inner_raw = b.get("params", {}).get("_inner_blocks")
                if not inner_raw:
                    # Groupe vide — juste le supprimer
                    new_wires = [w for w in new_wires
                                 if w["src"]["bid"] != gid and w["dst"]["bid"] != gid]
                    continue

                try:
                    saved = _json.loads(inner_raw)
                except Exception:
                    new_blocks.append(b)   # JSON corrompu — garder tel quel
                    continue

                inner_all    = saved.get("blocks", [])
                inner_wires  = saved.get("wires",  [])

                # Blocs réels (sans les ports de groupe)
                real_blocks = [ib for ib in inner_all
                               if ib.get("type") not in ("GROUP_IN", "GROUP_OUT")]

                # Fils internes réels (entre blocs non-GROUP_IN/OUT)
                inner_bid_set = {ib["id"] for ib in inner_all}
                gin_ids  = {ib["id"] for ib in inner_all if ib.get("type") == "GROUP_IN"}
                gout_ids = {ib["id"] for ib in inner_all if ib.get("type") == "GROUP_OUT"}
                real_inner_wires = [
                    iw for iw in inner_wires
                    if iw["src"]["bid"] not in gin_ids
                    and iw["dst"]["bid"] not in gout_ids
                ]

                # Table GROUP_IN : label → {bid, port} destination réelle
                gin_map = {}
                for gin in inner_all:
                    if gin.get("type") != "GROUP_IN":
                        continue
                    label = gin.get("params", {}).get("label") or gin["id"]
                    # fil interne : src=gin.id/SIG → dst=bloc_réel/port
                    for iw in inner_wires:
                        if iw["src"]["bid"] == gin["id"]:
                            gin_map[label] = {"bid": iw["dst"]["bid"],
                                              "port": iw["dst"]["port"]}
                            break

                # Table GROUP_OUT : label → {bid, port} source réelle
                gout_map = {}
                for gout in inner_all:
                    if gout.get("type") != "GROUP_OUT":
                        continue
                    label = gout.get("params", {}).get("label") or gout["id"]
                    # fil interne : src=bloc_réel/port → dst=gout.id/IN
                    for iw in inner_wires:
                        if iw["dst"]["bid"] == gout["id"]:
                            gout_map[label] = {"bid": iw["src"]["bid"],
                                               "port": iw["src"]["port"]}
                            break

                # Fils externes pointant vers / depuis ce GROUP
                ext_wires_in  = [w for w in new_wires if w["dst"]["bid"] == gid]
                ext_wires_out = [w for w in new_wires if w["src"]["bid"] == gid]

                # Supprimer les fils externes du GROUP
                new_wires = [w for w in new_wires
                             if w["src"]["bid"] != gid and w["dst"]["bid"] != gid]

                # Reconnecter : fil externe → GROUP.portLabel  →  fil externe → bloc_réel
                for ew in ext_wires_in:
                    port_label = ew["dst"]["port"]
                    inner_dst  = gin_map.get(port_label)
                    if inner_dst:
                        new_wires.append({
                            "id":  "fg_" + ew["id"],
                            "src": _copy.deepcopy(ew["src"]),
                            "dst": _copy.deepcopy(inner_dst),
                        })

                # Reconnecter : GROUP.portLabel → fil externe  →  bloc_réel → fil externe
                for ew in ext_wires_out:
                    port_label = ew["src"]["port"]
                    inner_src  = gout_map.get(port_label)
                    if inner_src:
                        new_wires.append({
                            "id":  "fg_" + ew["id"],
                            "src": _copy.deepcopy(inner_src),
                            "dst": _copy.deepcopy(ew["dst"]),
                        })

                # Ajouter les blocs et fils réels du groupe
                new_blocks.extend(_copy.deepcopy(real_blocks))
                new_wires.extend(_copy.deepcopy(real_inner_wires))

            return {**page_dict, "blocks": new_blocks, "wires": new_wires}, changed

        # Aplatissement récursif jusqu'à ce qu'il n'y ait plus de GROUP
        flat = _copy.deepcopy(page)
        for _ in range(32):   # limite de sécurité pour les imbrications profondes
            flat, changed = _flatten_once(flat)
            if not changed:
                break

        return flat

    def _fbd_to_program(self, diagram: dict) -> list:
        """Convertit toutes les pages du diagramme en un seul programme linéaire."""
        all_prog = []
        # Nouveau format multi-pages
        if "pages" in diagram:
            for pg in diagram["pages"]:
                flat_pg  = self._flatten_page(pg)   # ← aplatit les GROUP avant conversion
                pg_prog  = self._page_to_program(flat_pg)
                all_prog.extend(pg_prog)
        else:
            # Ancien format (rétro-compatibilité)
            flat_pg  = self._flatten_page(diagram)
            all_prog = self._page_to_program(flat_pg)
        return all_prog


    def _page_to_program(self, page: dict) -> list:
        """Convertit une page FBD en programme PLC linéaire.
        Gère tous les types de blocs définis dans fbd_canvas.html.
        """
        blocks = {b["id"]: b for b in page.get("blocks", [])}
        wires  = page.get("wires", [])

        # ── Helpers ───────────────────────────────────────────────────────
        def wire_src(dst_bid, dst_port):
            """Retourne (bloc_source, port_source) pour une entrée donnée."""
            for w in wires:
                if w["dst"]["bid"] == dst_bid and w["dst"]["port"] == dst_port:
                    sb = blocks.get(w["src"]["bid"])
                    return sb, w["src"]["port"]
            return None, None

        def signal_ref(src_b):
            """Retourne la référence signal d'un bloc source (INPUT/MEM/CONST)."""
            if not src_b: return None
            t = src_b["type"]; p = src_b.get("params", {})
            if t == "INPUT":  return int(p.get("pin", 22))
            if t == "MEM":    return p.get("bit", "M0")
            if t == "CONST":  return p.get("value", 0)
            if t in ("PT_IN","ANA_IN","SENSOR"): return p.get("reg_out", "RF0")
            if t == "BACKUP": return p.get("varname", "backup0")
            if t == "AV":     return p.get("varname", "av0")
            # Blocs analogiques → leur sortie registre
            if t in ("ADD","SUB","MUL","DIV","SCALE","PID","FILT1","AVG",
                     "INTEG","DERIV","DEADB","RAMP","ABS","MIN","MAX","MOD",
                     "SQRT","POW","CLAMP","CLAMP_A","SEL","MUX","COMPH","COMPL"):
                return p.get("reg_out", "RF0")
            return None

        def bool_ref(src_b):
            """Retourne la référence booléenne d'un bloc source."""
            if not src_b: return None
            t = src_b["type"]; p = src_b.get("params", {})
            if t == "INPUT": return int(p.get("pin", 22))
            if t == "MEM":   return p.get("bit", "M0")
            if t == "DV":    return p.get("varname", "dv0")
            if t == "BACKUP" and p.get("bktype") == "bool": return p.get("varname", "backup0")
            return None

        def build_cond(src_b):
            """Construit une condition booléenne récursive à partir d'un bloc."""
            if not src_b: return None
            t = src_b["type"]; p = src_b.get("params", {})
            if t == "INPUT":
                return {"type": "input", "ref": int(p.get("pin", 22))}
            if t == "MEM":
                return {"type": "input", "ref": p.get("bit", "M0")}
            if t == "DV":
                return {"type": "input", "ref": p.get("varname", "M0")}
            if t in ("NOT", "INV"):
                isb, _ = wire_src(src_b["id"], "IN")
                c = build_cond(isb)
                return {"type": "not", "condition": c} if c else None
            if t == "AND":
                i1, _ = wire_src(src_b["id"], "IN1")
                i2, _ = wire_src(src_b["id"], "IN2")
                conds = [c for c in [build_cond(i1), build_cond(i2)] if c]
                return {"type": "and", "conditions": conds} if conds else None
            if t == "OR":
                i1, _ = wire_src(src_b["id"], "IN1")
                i2, _ = wire_src(src_b["id"], "IN2")
                conds = [c for c in [build_cond(i1), build_cond(i2)] if c]
                return {"type": "or", "conditions": conds} if conds else None
            if t == "XOR":
                i1, _ = wire_src(src_b["id"], "IN1")
                i2, _ = wire_src(src_b["id"], "IN2")
                c1 = build_cond(i1); c2 = build_cond(i2)
                if c1 and c2:
                    return {"type": "or", "conditions": [
                        {"type": "and", "conditions": [c1, {"type": "not", "condition": c2}]},
                        {"type": "and", "conditions": [{"type": "not", "condition": c1}, c2]},
                    ]}
                return None
            # Sortie timer/compteur → condition indirecte
            if t in ("TON","TOF","TP","WAIT","WAITH","PULSE"):
                return {"type": "timer_done", "id": src_b["id"]}
            if t in ("CTU","CTD","CTUD","RUNTIMCNT"):
                return {"type": "counter_done", "id": src_b["id"]}
            # Sorties COMPH/COMPL/HYST → bit mémoire ou signal direct
            if t in ("COMPH", "COMPL", "HYST"):
                reg = p.get("reg_out", "M0")
                if reg.startswith("M"):
                    return {"type": "input", "ref": reg}
            # SR_R / SR_S → lire le bit
            if t in ("SR_R", "SR_S"):
                return {"type": "input", "ref": p.get("bit", "M0")}
            return None

        def resolve_bool_out(bid, port="Q"):
            """Résout la destination booléenne d'un port de sortie."""
            for w in wires:
                if w["src"]["bid"] == bid and w["src"]["port"] == port:
                    db = blocks.get(w["dst"]["bid"])
                    if db:
                        t = db["type"]; pp = db.get("params", {})
                        if t == "OUTPUT": return int(pp.get("pin", 17))
                        if t == "MEM":    return pp.get("bit", "M0")
                        if t == "DV":     return pp.get("varname", "dv0")
            return None

        def resolve_reg_out(bid, port="OUT"):
            """Résout la destination registre d'un port de sortie analogique."""
            for w in wires:
                if w["src"]["bid"] == bid and w["src"]["port"] == port:
                    db = blocks.get(w["dst"]["bid"])
                    if db:
                        t = db["type"]; pp = db.get("params", {})
                        if t in ("BACKUP","AV","STOAV"): return pp.get("varname","RF0")
                        if t == "MEM":   return pp.get("bit","M0")
                        if t == "OUTPUT": return int(pp.get("pin",17))
            return None

        # ── Tri topologique simplifié (gauche → droite) ───────────────────
        sorted_b = sorted(blocks.values(), key=lambda b: b.get("x", 0))
        done = set()
        prog = []

        for b in sorted_b:
            bid = b["id"]; bt = b["type"]; p = b.get("params", {})

            # Blocs purement graphiques — pas de code moteur
            if bt in ("INPUT","OUTPUT","CONST","MEM","AND","OR","NOT",
                      "XOR","INV","PAGE_IN","PAGE_OUT","CONN"):
                continue
            if bid in done:
                continue
            done.add(bid)
            blk = {"id": bid}

            # ── Bobines ──────────────────────────────────────────────────
            if bt in ("COIL","SET","RESET"):
                ep = {"COIL":"EN","SET":"S","RESET":"R"}[bt]
                isb, _ = wire_src(bid, ep)
                cond = build_cond(isb)
                blk["type"] = bt.lower()
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── MOVE ────────────────────────────────────────────────────
            elif bt == "MOVE":
                isb, _  = wire_src(bid, "IN")
                ensb, _ = wire_src(bid, "EN")
                cond = build_cond(ensb)
                blk["type"] = "coil"
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "OUT")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── Temporisations ───────────────────────────────────────────
            elif bt == "TON":
                isb, _ = wire_src(bid, "IN")
                cond = build_cond(isb) or p.get("condition")
                blk["type"] = "timer"
                blk["preset_ms"] = p.get("preset_ms", 1000)
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "TOF":
                isb, _ = wire_src(bid, "IN")
                cond = build_cond(isb)
                blk["type"] = "tof"
                blk["preset_ms"] = p.get("preset_ms", 1000)
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "TP":
                isb, _ = wire_src(bid, "IN")
                cond = build_cond(isb)
                blk["type"] = "tp"
                blk["preset_ms"] = p.get("preset_ms", 1000)
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "WAIT":
                isb, _ = wire_src(bid, "IN")
                cond = build_cond(isb) or p.get("condition")
                blk["type"] = "wait"
                blk["delay_s"] = p.get("delay_s", 5)
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "WAITH":
                isb, _ = wire_src(bid, "IN")
                cond = build_cond(isb) or p.get("condition")
                blk["type"] = "waith"
                blk["delay_s"] = p.get("delay_s", 5)
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "STS")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "PULSE":
                isb, _ = wire_src(bid, "IN")
                cond = build_cond(isb) or p.get("condition")
                blk["type"] = "pulse"
                blk["duration_s"] = p.get("duration_s", 3)
                if cond: blk["condition"] = cond
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── Compteurs ────────────────────────────────────────────────
            elif bt == "CTU":
                cusb, _ = wire_src(bid, "CU")
                rsb,  _ = wire_src(bid, "R")
                blk["type"]   = "counter"
                blk["preset"] = p.get("preset", 10)
                cond = build_cond(cusb)
                rst  = build_cond(rsb)
                if cond: blk["condition"]       = cond
                if rst:  blk["reset_condition"] = rst
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "CTD":
                cdsb, _ = wire_src(bid, "CD")
                ldsb, _ = wire_src(bid, "LD")
                blk["type"]   = "ctd"
                blk["preset"] = p.get("preset", 10)
                cd = build_cond(cdsb)
                ld = build_cond(ldsb)
                if cd: blk["cd_cond"] = cd
                if ld: blk["ld_cond"] = ld
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "CTUD":
                cusb, _ = wire_src(bid, "CU")
                cdsb, _ = wire_src(bid, "CD")
                rsb,  _ = wire_src(bid, "R")
                ldsb, _ = wire_src(bid, "LD")
                blk["type"]   = "ctud"
                blk["preset"] = p.get("preset", 10)
                cu = build_cond(cusb); cd = build_cond(cdsb)
                rst = build_cond(rsb); ld = build_cond(ldsb)
                if cu:  blk["cu_cond"]          = cu
                if cd:  blk["cd_cond"]          = cd
                if rst: blk["reset_condition"]  = rst
                if ld:  blk["ld_cond"]          = ld
                out = resolve_bool_out(bid, "Q")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── Comparaison ──────────────────────────────────────────────
            elif bt in ("GT","GE","LT","EQ","NE"):
                i1sb, _ = wire_src(bid, "IN1")
                i2sb, _ = wire_src(bid, "IN2")
                op_map = {"GT":"gt","GE":"ge","LT":"lt","EQ":"eq","NE":"ne"}
                blk["type"] = "compare"
                blk["op"]   = op_map[bt]
                ref_a = signal_ref(i1sb)
                ref_b = signal_ref(i2sb)
                if ref_a is not None: blk["ref_a"] = ref_a
                if ref_b is not None: blk["ref_b"] = ref_b
                else: blk["val_b"] = 0
                out = resolve_bool_out(bid, "OUT")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "COMPARE_F":
                blk["type"] = "compare_f"
                blk["reg_ref"]   = p.get("reg_ref", "RF0")
                blk["threshold"] = p.get("threshold", 80.0)
                blk["hysteresis"]= p.get("hysteresis", 1.0)
                blk["op"]        = p.get("op", "gt")
                out = resolve_bool_out(bid, "GT")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── Bascules SR ──────────────────────────────────────────────
            elif bt in ("SR","RS"):
                sp = "S1" if bt == "SR" else "S"
                rp = "R"  if bt == "SR" else "R1"
                ssb, _ = wire_src(bid, sp)
                rsb, _ = wire_src(bid, rp)
                sc = build_cond(ssb); rc = build_cond(rsb)
                out = resolve_bool_out(bid, "Q1")
                if sc:
                    sb = {"type":"set",   "id":f"{bid}_S","condition":sc}
                    if out is not None: sb["output"] = out
                    prog.append(sb)
                if rc:
                    rb = {"type":"reset", "id":f"{bid}_R","condition":rc}
                    if out is not None: rb["output"] = out
                    prog.append(rb)

            elif bt in ("SR_R", "SR_S"):
                ssb, _ = wire_src(bid, "SET")
                rsb, _ = wire_src(bid, "RES")
                sc = build_cond(ssb); rc = build_cond(rsb)
                blk["type"]    = bt.lower()
                blk["bit"]     = p.get("bit", "M0")
                if sc: blk["set_cond"] = sc
                if rc: blk["res_cond"] = rc
                out = resolve_bool_out(bid, "STS")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── Variables / Persistance ───────────────────────────────────
            elif bt == "BACKUP":
                # BACKUP : port VAL bidirectionnel
                # → val_in = source câblée sur VAL (écriture)
                # → val_out = registre où exposer la valeur lue (lecture)
                isb, _ = wire_src(bid, "VAL")
                ref_in  = signal_ref(isb)   # source analogique câblée
                ref_out = resolve_reg_out(bid, "VAL") or p.get("reg_out")
                blk["type"]    = "backup"
                blk["varname"] = p.get("varname", "backup0")
                blk["default"] = p.get("default", 0.0)
                blk["bktype"]  = p.get("bktype", "float")
                if ref_in  is not None: blk["val_in"]  = ref_in
                if ref_out is not None: blk["val_out"] = ref_out
                bool_out = resolve_bool_out(bid, "VAL")
                if bool_out is not None: blk["output"] = bool_out
                prog.append(blk)

            elif bt == "AV":
                blk["type"]    = "av"
                blk["varname"] = p.get("varname", "av0")
                blk["default"] = p.get("default", 0.0)
                val_out = resolve_reg_out(bid, "VAL") or p.get("reg_out")
                if val_out: blk["val_out"] = val_out
                bool_out = resolve_bool_out(bid, "OUT")
                if bool_out is not None: blk["output"] = bool_out
                prog.append(blk)

            elif bt == "DV":
                blk["type"]    = "dv"
                blk["varname"] = p.get("varname", "dv0")
                blk["default"] = p.get("default", False)
                # Résoudre le fil de sortie DV.OUT → OUTPUT/MEM
                dv_out = resolve_bool_out(bid, "OUT")
                if dv_out is not None:
                    blk["output"] = dv_out
                prog.append(blk)

            elif bt == "STOAV":
                isb, _ = wire_src(bid, "IN")
                ref = signal_ref(isb)
                blk["type"]    = "stoav"
                blk["varname"] = p.get("varname", "av0")
                if ref is not None: blk["reg_in"] = ref
                prog.append(blk)

            elif bt == "STOAP":
                isb, _ = wire_src(bid, "IN")
                ref = signal_ref(isb)
                blk["type"]    = "stoap"
                blk["varname"] = p.get("varname", "timer0.TimerTime")
                if ref is not None: blk["reg_in"] = ref
                prog.append(blk)

            elif bt == "LOCALTIME":
                blk["type"]     = "localtime"
                blk["out_hour"] = p.get("out_hour", "RF13")
                blk["out_mday"] = p.get("out_mday", "RF14")
                blk["out_wday"] = p.get("out_wday", "RF15")
                prog.append(blk)

            # ── Actionneurs ───────────────────────────────────────────────
            # ── Blocs Métier ────────────────────────────────────────────────────────
            elif bt == "PLANCHER":
                blk["type"]          = "plancher"
                blk["name"]          = p.get("name", "Plancher")
                # ─ Sondes : port câblé (T_AMB/T_DEP/T_RET) → ref signal,
                #   sinon fallback sur pv_ref_xxx configuré dans params
                t_amb_src, _ = wire_src(bid, "T_AMB")
                t_dep_src, _ = wire_src(bid, "T_DEP")
                t_ret_src, _ = wire_src(bid, "T_RET")
                sp_src,    _ = wire_src(bid, "SP")
                en_src,    _ = wire_src(bid, "EN")
                blk["pv_ref_amb"]    = signal_ref(t_amb_src) or p.get("pv_ref_amb", "RF0")
                blk["pv_ref_depart"] = signal_ref(t_dep_src) or p.get("pv_ref_depart", "")
                blk["pv_ref_retour"] = signal_ref(t_ret_src) or p.get("pv_ref_retour", "")
                blk["sp_ref"]        = signal_ref(sp_src) or None  # consigne dynamique
                blk["sp"]            = float(p.get("sp", 20.0))    # consigne fixe fallback
                blk["en_cond"]       = build_cond(en_src) or None
                blk["max_depart"]    = float(p.get("max_depart", 45.0))
                blk["min_delta"]     = float(p.get("min_delta", 3.0))
                blk["kp"]            = float(p.get("kp", 2.0))
                blk["ki"]            = float(p.get("ki", 0.1))
                blk["kd"]            = float(p.get("kd", 0.5))
                blk["dead_band"]     = float(p.get("dead_band", 0.5))
                # ─ Sorties : V3V_OUV, V3V_FER, CIRC (nouvelle architecture)
                blk["out_v3v_ouv"]   = p.get("out_v3v_ouv") or p.get("out_vanne", "k7")
                blk["out_v3v_fer"]   = p.get("out_v3v_fer", "k8")
                blk["out_circ"]      = p.get("out_circ") or p.get("out_pompe", "k9")
                blk["reg_out"]       = p.get("reg_out", "RF2")
                blk["reg_depart"]    = p.get("reg_depart", "RF0")
                blk["reg_retour"]    = p.get("reg_retour", "RF5")
                blk["reg_delta"]     = p.get("reg_delta", "RF15")
                blk["min_temp"]      = float(p.get("min_temp", 5.0))
                blk["max_temp"]      = float(p.get("max_temp", 35.0))
                prog.append(blk)

            elif bt == "CHAUDIERE":
                blk["type"]          = "chaudiere"
                blk["name"]          = p.get("name", "Chaudière")
                blk["pv_ref_retour"] = p.get("pv_ref_retour", "RF1")
                blk["pv_ref_depart"] = p.get("pv_ref_depart", "RF2")
                blk["sp"]            = float(p.get("sp", 65.0))
                blk["hysteresis"]    = float(p.get("hysteresis", 3.0))
                blk["min_on_s"]      = int(p.get("min_on_s", 60))
                blk["min_off_s"]     = int(p.get("min_off_s", 30))
                blk["max_depart"]    = float(p.get("max_depart", 90.0))
                blk["out_brulee"]    = p.get("out_brulee", "k3")
                blk["out_pompe"]     = p.get("out_pompe", "k4")
                prog.append(blk)

            elif bt == "SOLAR":
                blk["type"]             = "solar"
                blk["name"]             = p.get("name", "Solaire")
                blk["pv_ref_capteur"]   = p.get("pv_ref_capteur", "RF0")
                blk["pv_ref_ecs"]       = p.get("pv_ref_ecs", "RF3")
                blk["pv_ref_chauf"]     = p.get("pv_ref_chauf", "")
                blk["delta_on"]         = float(p.get("delta_on", 8.0))
                blk["delta_off"]        = float(p.get("delta_off", 3.0))
                blk["sp_ecs"]           = float(p.get("sp_ecs", 60.0))
                blk["sp_chauf"]         = float(p.get("sp_chauf", 50.0))
                blk["max_capteur"]      = float(p.get("max_capteur", 120.0))
                blk["min_capteur"]      = float(p.get("min_capteur", 5.0))
                blk["pump_mode"]        = p.get("pump_mode", "on_off")
                blk["out_pompe"]        = p.get("out_pompe", "k1")
                blk["out_pompe_av"]     = p.get("out_pompe_av", "")
                blk["pump_min_pct"]     = float(p.get("pump_min_pct", 10.0))
                blk["pump_delta_max"]   = float(p.get("pump_delta_max", 30.0))
                blk["out_vanne_ecs"]    = p.get("out_vanne_ecs", "k2")
                blk["out_vanne_chauf"]  = p.get("out_vanne_chauf", "k3")
                blk["reg_delta"]          = p.get("reg_delta", "RF12")
                blk["reg_rendement"]      = p.get("reg_rendement", "RF13")
                blk["reg_vitesse_pompe"]  = p.get("reg_vitesse_pompe", "RF14")
                blk["min_capteur"]        = float(p.get("min_capteur", 5.0))
                blk["antigel_mode"]       = p.get("antigel_mode", "off")
                blk["antigel_temp_source"]= float(p.get("antigel_temp_source", 30.0))
                prog.append(blk)

            elif bt == "ZONE_CHAUF":
                blk["type"]         = "zone_chauf"
                blk["name"]         = p.get("name", "Zone")
                blk["pv_ref"]       = p.get("pv_ref", "RF0")
                blk["sp"]           = float(p.get("sp", 20.0))
                blk["hysteresis"]   = float(p.get("hysteresis", 0.5))
                blk["out_vanne"]    = p.get("out_vanne", "k5")
                blk["delay_open_s"] = int(p.get("delay_open_s", 120))
                blk["delay_close_s"]= int(p.get("delay_close_s", 120))
                prog.append(blk)

            elif bt == "ECS_BLOC":
                blk["type"]         = "ecs_bloc"
                blk["name"]         = p.get("name", "ECS")
                blk["pv_ref_ecs"]   = p.get("pv_ref_ecs", "RF3")
                blk["pv_ref_prim"]  = p.get("pv_ref_prim", "RF4")
                blk["sp_ecs"]       = float(p.get("sp_ecs", 55.0))
                blk["sp_antileg"]   = float(p.get("sp_antileg", 65.0))
                blk["antileg_day"]  = int(p.get("antileg_day", 0))
                blk["antileg_hour"] = int(p.get("antileg_hour", 3))
                blk["hysteresis"]   = float(p.get("hysteresis", 2.0))
                blk["out_pompe"]    = p.get("out_pompe", "k6")
                prog.append(blk)

            elif bt == "CONTACTOR":
                isb, _ = wire_src(bid, "ON")
                cond = build_cond(isb) or p.get("condition")
                blk["type"] = "contactor"
                blk["name"] = p.get("name", "K?")
                blk["pin"]  = int(p.get("pin", 17))
                if cond: blk["condition"] = cond
                prog.append(blk)

            elif bt == "VALVE3V":
                incb, _ = wire_src(bid, "OINC")
                decb, _ = wire_src(bid, "ODEC")
                blk["type"]     = "valve3v"
                blk["name"]     = p.get("name", "V3V")
                blk["pin_inc"]  = int(p.get("pin_inc", 20))
                blk["pin_dec"]  = int(p.get("pin_dec", 21))
                ci = build_cond(incb); cd = build_cond(decb)
                if ci: blk["cond_inc"] = ci
                if cd: blk["cond_dec"] = cd
                # Sorties logiques : Q_OUV = état ouverture, Q_FER = état fermeture
                out_inc = resolve_bool_out(bid, "Q_OUV")
                out_dec = resolve_bool_out(bid, "Q_FER")
                if out_inc is not None: blk["out_inc"] = out_inc
                if out_dec is not None: blk["out_dec"] = out_dec
                prog.append(blk)

            elif bt == "RUNTIMCNT":
                runsb, _ = wire_src(bid, "RUN")
                rstsb, _ = wire_src(bid, "RST")
                cond  = build_cond(runsb) or p.get("condition")
                rcond = build_cond(rstsb) or p.get("reset_condition")
                blk["type"]        = "runtimcnt"
                blk["name"]        = p.get("name", p.get("label", "Compteur1"))
                blk["label"]       = p.get("label", p.get("name", "Compteur1"))
                blk["reg_starts"]  = p.get("reg_starts", "")
                blk["reg_total"]   = p.get("reg_total", "")
                blk["reg_runtime"] = p.get("reg_runtime", "")
                if cond:  blk["condition"]       = cond
                if rcond: blk["reset_condition"] = rcond
                prog.append(blk)

            # ── Capteurs analogiques ──────────────────────────────────────
            elif bt == "PT_IN":
                blk["type"]       = "pt_in"
                blk["analog_ref"] = p.get("analog_ref", "PT0")
                blk["reg_out"]    = p.get("reg_out", "RF0")
                prog.append(blk)

            elif bt == "ANA_IN":
                blk["type"]       = "ana_in"
                blk["analog_ref"] = p.get("analog_ref", "ANA0")
                blk["reg_out"]    = p.get("reg_out", "RF1")
                prog.append(blk)

            elif bt == "SENSOR":
                blk["type"]       = "sensor"
                blk["ref"]        = p.get("ref", "ANA0")
                blk["name"]       = p.get("name", p.get("ref", "ANA0"))
                blk["correction"] = p.get("correction", 0.0)
                blk["reg_out"]    = p.get("reg_out", "RF0")
                prog.append(blk)

            # ── Calcul analogique ─────────────────────────────────────────
            elif bt in ("ADD","SUB","MUL","DIV"):
                i1sb, _ = wire_src(bid, "IN1")
                i2sb, _ = wire_src(bid, "IN2")
                blk["type"]    = bt.lower()
                blk["reg_a"]   = signal_ref(i1sb) or p.get("reg_a", "RF0")
                blk["reg_b"]   = signal_ref(i2sb) or p.get("reg_b", "RF1")
                blk["reg_out"] = p.get("reg_out", "RF2")
                prog.append(blk)

            elif bt in ("ABS","SQRT"):
                isb, _ = wire_src(bid, "IN")
                blk["type"]    = bt.lower()
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out", "RF1")
                prog.append(blk)

            elif bt in ("MIN","MAX","MOD","POW"):
                i1sb, _ = wire_src(bid, "IN1" if bt!="POW" else "BASE")
                i2sb, _ = wire_src(bid, "IN2" if bt!="POW" else "EXP")
                blk["type"]    = bt.lower()
                blk["reg_a"]   = signal_ref(i1sb) or p.get("reg_a","RF0")
                blk["reg_b"]   = signal_ref(i2sb) or p.get("reg_b","RF1")
                blk["reg_out"] = p.get("reg_out","RF2")
                prog.append(blk)

            elif bt in ("CLAMP","CLAMP_A"):
                isb, _ = wire_src(bid, "IN")
                blk["type"]    = bt.lower()
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["lo"]      = p.get("lo", 0.0)
                blk["hi"]      = p.get("hi", 100.0)
                out = resolve_bool_out(bid, "CLIP")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "SEL":
                gsb,  _ = wire_src(bid, "G")
                i0sb, _ = wire_src(bid, "IN0")
                i1sb, _ = wire_src(bid, "IN1")
                blk["type"]    = "sel"
                blk["in0"]     = signal_ref(i0sb) or p.get("in0","RF0")
                blk["in1"]     = signal_ref(i1sb) or p.get("in1","RF1")
                blk["reg_out"] = p.get("reg_out","RF2")
                sel_c = build_cond(gsb)
                if sel_c: blk["sel_cond"] = sel_c
                prog.append(blk)

            elif bt == "MUX":
                idxsb, _ = wire_src(bid, "IDX")
                blk["type"]    = "mux"
                blk["idx_ref"] = signal_ref(idxsb) or p.get("idx_ref","RF0")
                blk["n_in"]    = p.get("n_in", 4)
                for i in range(p.get("n_in", 4)):
                    insb, _ = wire_src(bid, f"IN{i}")
                    blk[f"in{i}"] = signal_ref(insb) or p.get(f"in{i}", f"RF{i}")
                blk["reg_out"] = p.get("reg_out","RF4")
                prog.append(blk)

            elif bt == "COMPH":
                blk["type"]    = "comph"
                blk["ref"]     = p.get("ref","RF0")
                blk["high"]    = p.get("high", 80.0)
                blk["hyst"]    = p.get("hyst", 0.5)
                blk["reg_out"] = p.get("reg_out","M0")
                out = resolve_bool_out(bid, "HL")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "COMPL":
                blk["type"]    = "compl"
                blk["ref"]     = p.get("ref","RF0")
                blk["low"]     = p.get("low", 10.0)
                blk["hyst"]    = p.get("hyst", 0.5)
                blk["reg_out"] = p.get("reg_out","M1")
                out = resolve_bool_out(bid, "LL")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "FILT1":
                isb, _ = wire_src(bid, "IN")
                blk["type"]    = "filt1"
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["tc_s"]    = p.get("tc_s", 10.0)
                prog.append(blk)

            elif bt == "AVG":
                isb, _ = wire_src(bid, "IN")
                blk["type"]    = "avg"
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["n"]       = p.get("n", 10)
                prog.append(blk)

            elif bt == "INTEG":
                isb, _  = wire_src(bid, "IN")
                resb, _ = wire_src(bid, "RES")
                blk["type"]    = "integ"
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["ki"]      = p.get("ki", 1.0)
                blk["lo"]      = p.get("lo", -1e9)
                blk["hi"]      = p.get("hi",  1e9)
                rc = build_cond(resb)
                if rc: blk["reset_cond"] = rc
                out = resolve_bool_out(bid, "MAX")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "DERIV":
                isb, _ = wire_src(bid, "IN")
                blk["type"]    = "deriv"
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["kd"]      = p.get("kd", 1.0)
                prog.append(blk)

            elif bt == "DEADB":
                isb, _ = wire_src(bid, "IN")
                blk["type"]    = "deadb"
                blk["reg_in"]  = signal_ref(isb) or p.get("reg_in","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["dead"]    = p.get("dead", 1.0)
                out = resolve_bool_out(bid, "DEAD")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "RAMP":
                spsb, _ = wire_src(bid, "SP")
                blk["type"]    = "ramp"
                blk["reg_sp"]  = signal_ref(spsb) or p.get("reg_sp","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["rate"]    = p.get("rate", 1.0)
                out = resolve_bool_out(bid, "DONE")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "HYST":
                isb, _ = wire_src(bid, "IN")
                blk["type"]   = "hyst"
                blk["reg_in"] = signal_ref(isb) or p.get("reg_in","RF0")
                blk["sp"]     = p.get("sp", 50.0)
                blk["band"]   = p.get("band", 2.0)
                out = resolve_bool_out(bid, "OUT")
                if out is not None: blk["output"] = out
                prog.append(blk)

            elif bt == "SCALE":
                blk["type"]    = "scale"
                blk["reg_ref"] = p.get("reg_ref","RF0")
                blk["reg_out"] = p.get("reg_out","RF1")
                blk["in_lo"]   = p.get("in_lo", 0.0)
                blk["in_hi"]   = p.get("in_hi", 5.0)
                blk["out_lo"]  = p.get("out_lo", 0.0)
                blk["out_hi"]  = p.get("out_hi",100.0)
                prog.append(blk)

            elif bt == "PID":
                blk["type"]    = "pid"
                blk["pv_ref"]  = p.get("pv_ref","RF0")
                blk["setpoint"]= p.get("setpoint", 50.0)
                blk["kp"]      = p.get("kp", 1.0)
                blk["ki"]      = p.get("ki", 0.1)
                blk["kd"]      = p.get("kd", 0.0)
                blk["out_min"] = p.get("out_min", 0.0)
                blk["out_max"] = p.get("out_max",100.0)
                blk["reg_out"] = p.get("reg_out","RF3")
                out = resolve_bool_out(bid, "OUT")
                if out is not None: blk["output"] = out
                prog.append(blk)

            # ── CArithm ───────────────────────────────────────────────────
            elif bt == "CARITHM":
                blk["type"] = "carithm"
                blk["code"] = p.get("code","")
                blk["name"] = p.get("name","CArithm")
                # Connecter les ports d'entrée analogiques A1..A8
                for i in range(1, int(p.get("n_a",0))+1):
                    isb, _ = wire_src(bid, f"A{i}")
                    ref = signal_ref(isb)
                    # Priorité : fil > param existant > fallback RF*
                    blk[f"a{i}_ref"] = ref if ref is not None else p.get(f"a{i}_ref", f"RF{i-1}")
                # Entrées booléennes d1..d7
                for i in range(1, int(p.get("n_d",0))+1):
                    isb, _ = wire_src(bid, f"d{i}")
                    ref = bool_ref(isb)
                    # Priorité : fil > param existant
                    blk[f"d{i}_ref"] = ref if ref is not None else p.get(f"d{i}_ref")
                # Entrées entières I1..I2
                for i in range(1, int(p.get("n_i",0))+1):
                    isb, _ = wire_src(bid, f"I{i}")
                    ref = signal_ref(isb)
                    blk[f"i{i}_ref"] = ref if ref is not None else p.get(f"i{i}_ref", f"RF{12+i}")
                # Sorties OA1..OA8
                for i in range(1, int(p.get("n_oa",0))+1):
                    ref = resolve_reg_out(bid, f"OA{i}")
                    # Priorité : fil > param existant > fallback RF*
                    blk[f"oa{i}_ref"] = ref if ref is not None else p.get(f"oa{i}_ref", f"RF{i-1}")
                # Sorties od1..od8
                for i in range(1, int(p.get("n_od",0))+1):
                    ref = resolve_bool_out(bid, f"od{i}")
                    # Priorité : fil > param existant
                    blk[f"od{i}_ref"] = ref if ref is not None else p.get(f"od{i}_ref")
                # Sortie OI1
                if p.get("n_oi",0) > 0:
                    blk["oi1_ref"] = resolve_reg_out(bid,"OI1") or "RF15"
                prog.append(blk)
            elif bt == "PYBLOCK":
                blk["type"] = "pyblock"
                blk["code"] = p.get("code", "")
                blk["name"] = p.get("name", "PyBlock")
                blk["n_a"]  = int(p.get("n_a",  2))
                blk["n_d"]  = int(p.get("n_d",  1))
                blk["n_i"]  = int(p.get("n_i",  0))
                blk["n_oa"] = int(p.get("n_oa", 1))
                blk["n_od"] = int(p.get("n_od", 1))
                blk["n_oi"] = int(p.get("n_oi", 0))
                for i in range(1, int(p.get("n_a", 0)) + 1):
                    isb, _ = wire_src(bid, f"A{i}")
                    ref = signal_ref(isb)
                    blk[f"a{i}_ref"] = ref if ref is not None else p.get(f"a{i}_ref", f"RF{i-1}")
                for i in range(1, int(p.get("n_d", 0)) + 1):
                    isb, _ = wire_src(bid, f"d{i}")
                    ref = bool_ref(isb)
                    blk[f"d{i}_ref"] = ref if ref is not None else p.get(f"d{i}_ref")
                for i in range(1, int(p.get("n_i", 0)) + 1):
                    isb, _ = wire_src(bid, f"I{i}")
                    ref = signal_ref(isb)
                    blk[f"i{i}_ref"] = ref if ref is not None else p.get(f"i{i}_ref", f"RF{12+i}")
                for i in range(1, int(p.get("n_oa", 0)) + 1):
                    ref = resolve_reg_out(bid, f"OA{i}")
                    blk[f"oa{i}_ref"] = ref if ref is not None else p.get(f"oa{i}_ref", f"RF{i-1}")
                for i in range(1, int(p.get("n_od", 0)) + 1):
                    ref = resolve_bool_out(bid, f"od{i}")
                    blk[f"od{i}_ref"] = ref if ref is not None else p.get(f"od{i}_ref")
                if p.get("n_oi", 0) > 0:
                    blk["oi1_ref"] = resolve_reg_out(bid, "OI1") or "RF15"
                prog.append(blk)


        return prog

    # ── Programme linéaire → diagramme FBD (pour chargement depuis fichier) ──
    def _program_to_fbd(self, prog: list) -> dict:
        fbd_blocks = []; fbd_wires = []
        x = 40; y = 40
        type_map = {
            "coil":"COIL","set":"SET","reset":"RESET",
            "timer":"TON","counter":"CTU","compare":"GT",
        }
        for i, b in enumerate(prog):
            bt  = type_map.get(b.get("type",""),"COIL")
            bid = b.get("id", f"B{i+1}")
            fb  = {"id":bid,"type":bt,"x":x+140,"y":y,"params":{}}
            if bt=="TON": fb["params"]["preset_ms"]=b.get("preset_ms",1000)
            if bt=="CTU": fb["params"]["preset"]=b.get("preset",10)
            fbd_blocks.append(fb)
            cond = b.get("condition")
            if cond and cond.get("type")=="input":
                ref = cond["ref"]
                in_bid = f"{bid}_IN"
                pt = "INPUT" if isinstance(ref,int) else "MEM"
                pp = {"pin":ref} if isinstance(ref,int) else {"bit":ref}
                fbd_blocks.append({"id":in_bid,"type":pt,"x":x-40,"y":y,"params":pp})
                ep = {"COIL":"EN","SET":"S","RESET":"R","TON":"IN","CTU":"CU"}.get(bt,"EN")
                fbd_wires.append({"id":f"W{i}i","src":{"bid":in_bid,"port":"VAL"},"dst":{"bid":bid,"port":ep}})
            out = b.get("output")
            if out is not None:
                out_bid = f"{bid}_OUT"
                ot = "OUTPUT" if isinstance(out,int) else "MEM"
                op = {"pin":out} if isinstance(out,int) else {"bit":out}
                fbd_blocks.append({"id":out_bid,"type":ot,"x":x+320,"y":y,"params":op})
                qp = {"COIL":"Q","SET":"Q","RESET":"Q","TON":"Q","CTU":"Q"}.get(bt,"Q")
                fbd_wires.append({"id":f"W{i}o","src":{"bid":bid,"port":qp},"dst":{"bid":out_bid,"port":"VAL"}})
            y += 130
        return {"pages":[{"id":"P1","name":"Page 1","blocks":fbd_blocks,"wires":fbd_wires}],"curPage":0}

    # ── API publique ──────────────────────────────────────────────────────────
    def get_program(self):
        """Retourne le diagramme FBD complet (dict multi-pages) pour sauvegarde."""
        return self._diagram if self._diagram.get("pages") else self._fbd_to_program(self._diagram)

    def sync_and_save(self, callback):
        """Demande le diagramme courant au JS puis appelle callback(diagram).
        Utilisé par la sauvegarde pour garantir que _diagram est à jour."""
        if not HAS_WEBENGINE:
            callback(self._diagram)
            return
        def _on_result(result):
            if result and isinstance(result, dict) and result.get("pages"):
                self._diagram = result
            callback(self._diagram)
        self.view.page().runJavaScript(
            "window.fbdAPI ? JSON.parse(JSON.stringify(window.fbdAPI.getDiagram())) : null",
            _on_result
        )

    def get_engine_program(self) -> list:
        """Retourne la liste plate de blocs pour le moteur PLC."""
        return self._fbd_to_program(self._diagram)

    def load_program(self, data):
        """Charge un programme/diagramme dans le canvas FBD."""
        if not HAS_WEBENGINE:
            return
        if getattr(self, '_canvas_ready', False):
            # Canvas prêt — petit délai pour laisser tout JS en cours se terminer
            # avant d'envoyer le nouveau diagramme (évite race condition)
            from PyQt5.QtCore import QTimer
            QTimer.singleShot(50, lambda: self._do_load(data))
        else:
            # Canvas pas encore prêt → mettre en attente
            self._pending_load = data

    def import_blocks(self, data):
        """Importe les blocs d'un exemple dans la page courante (sans remplacer le projet)."""
        if not HAS_WEBENGINE:
            return
        import json as _j
        if not getattr(self, '_canvas_ready', False):
            return  # canvas pas prêt, ignorer
        self.view.page().runJavaScript(
            f"window.fbdAPI && window.fbdAPI.importBlocks({_j.dumps(data)})"
        )

    def update_from_state(self, state: dict):
        if not HAS_WEBENGINE: return
        self.bridge.set_pending_state(json.dumps(state))
        self.view.page().runJavaScript(
            "if(window.pybridge&&window.pybridge.get_pending_state){"
            "  window.pybridge.get_pending_state(function(s){"
            "    if(!s)return;"
            "    try{var d=JSON.parse(s);"
            "      window.fbdAPI&&window.fbdAPI.updateActiveStates(d);"
            "      try{_trendUpdate(d);}catch(e){}"
            "    }catch(e){}"
            "  });"
            "}"
        )


    def clear(self):
        self._diagram = {"blocks":[],"wires":[]}
        if HAS_WEBENGINE:
            self.view.page().runJavaScript("window.fbdAPI && window.fbdAPI.clearAll()")
        self.program_changed.emit([])

    def fit_view(self):
        if HAS_WEBENGINE:
            self.view.page().runJavaScript("window.fbdAPI && window.fbdAPI.fitView()")

