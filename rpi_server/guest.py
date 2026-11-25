"""
Page « Invité » de RPi-PLC Studio
=================================
Il suffit de NOMMER une page du synoptique « Invité » (ou « Invités », « Guest »)
dans l'éditeur de synoptique du Studio. Au déploiement, le serveur diffuse cette
page — et elle seule — sur un second port du réseau local (par défaut web_port + 1,
soit 5001), pour que des personnes de passage puissent commander la chaudière
sans voir ni atteindre les autres pages, ni le SCADA, ni l'éditeur.

Principes
---------
* La page est éditée avec l'éditeur de synoptique habituel, comme les autres.
  Le serveur relit synoptic.json : aucun redémarrage n'est nécessaire quand on
  ajoute, renomme ou supprime la page (surveillance toutes les 3 s).
* Liste blanche AUTOMATIQUE : seules les variables des widgets « commandables »
  placés sur la page Invité (interrupteurs, boutons, consignes…) peuvent être
  écrites. Une consigne est bornée à son min/max. Rien d'autre n'est accessible :
  ni démarrage/arrêt du PLC, ni forçages hors page, ni sauvegarde du synoptique.
* Lecture limitée : l'état envoyé ne contient que les variables utilisées par les
  widgets de la page Invité.
* Les écritures réutilisent EXACTEMENT les routes du serveur principal (mêmes
  effets : forçage GPIO, DV liées, sauvegarde des DV…), après validation.
* Ce module ne peut pas perturber le serveur principal : port déjà pris, erreur
  ou arrêt du port invité sont journalisés et ignorés.

Configuration facultative (config.json) :
    "guest": {"enabled": true, "port": 5001, "host": "0.0.0.0"}
"""
import json
import re
import socket
import threading
import time
import unicodedata
from collections import deque
from pathlib import Path

import logging

log = logging.getLogger("rpi-plc")

GUEST_NAMES = {"invite", "invites", "guest", "guests"}

# Widgets qui peuvent écrire, et la nature de l'écriture.
BOOL_TYPES = {"relay", "toggle", "dv_push", "dv_toggle", "push_3d",
              "toggle_btn_3d", "toggle_3d", "btn_3d", "switch_m"}
NUM_TYPES = {"setpoint", "sp_card", "numentry", "numeric"}
BTN_ACTIONS = {"set_dv", "reset_dv", "pulse_dv", "set_mem", "reset_mem"}
NAV_TYPES = {"nav_page", "nav_back"}          # retirés : pas de navigation vers d'autres pages
STATE_SCALARS = ("running", "cycle", "ts", "on_rpi")
STATE_DICTS = ("gpio", "memory", "analog", "registers", "av_vars", "dv_vars",
               "timers", "counters", "pids")

_M_RE = re.compile(r"M\d+$")


# ── Nom de page ───────────────────────────────────────────────────────────────
def _norm(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def is_guest_name(name) -> bool:
    """« Invité », « invités », « 🌐 Guest »… (accents, casse et décorations ignorés)."""
    return _norm(name) in GUEST_NAMES


def load_synoptic(base_dir):
    try:
        return json.loads((Path(base_dir) / "synoptic.json").read_text(encoding="utf-8"))
    except Exception:
        return None


def find_guest_page(syn):
    if isinstance(syn, dict):
        for p in syn.get("pages") or []:
            if isinstance(p, dict) and is_guest_name(p.get("name")):
                return p
    return None


# ── Politique d'accès calculée depuis la page ────────────────────────────────
def _strings(o, out):
    if isinstance(o, str):
        out.add(o)
        if re.search(r"[<>=+*/()&|!]", o):       # expressions : on garde aussi les mots
            out.update(re.findall(r"[\w.]+", o))
    elif isinstance(o, dict):
        for v in o.values():
            _strings(v, out)
    elif isinstance(o, list):
        for v in o:
            _strings(v, out)


def _fnum(v):
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    except (TypeError, ValueError):
        return None


class Policy:
    def __init__(self, page):
        self.widgets = [w for w in (page.get("widgets") or [])
                        if isinstance(w, dict) and w.get("type") not in NAV_TYPES]
        self.page = {**page, "widgets": self.widgets, "isPopup": False}
        strs = set()
        _strings(self.widgets, strs)
        self.read_refs = {s.lower() for s in strs if s}
        self.bool_refs, self.num_refs, self.pins = set(), {}, set()
        for w in self.widgets:
            t, ref = w.get("type"), str(w.get("varRef") or "").strip()
            if not ref:
                continue
            if t == "relay" and ref.isdigit():
                self.pins.add(int(ref))
            elif t in BOOL_TYPES or (t == "button" and w.get("action") in BTN_ACTIONS):
                self.bool_refs.add(ref.lower())
            elif t in NUM_TYPES:
                self.num_refs[ref.lower()] = (_fnum(w.get("min")), _fnum(w.get("max")))

    # écritures
    def can_dv(self, ref):  return ref.lower() in self.bool_refs and not _M_RE.match(ref)
    def can_mem(self, ref): return bool(_M_RE.match(ref)) and ref.lower() in self.bool_refs
    def can_reg(self, ref): return ref.startswith("RF") and ref.lower() in self.num_refs
    def can_av(self, ref):
        return (ref.lower() in self.num_refs and not ref.startswith("RF")
                and not _M_RE.match(ref))

    def clamp(self, ref, val):
        lo, hi = self.num_refs.get(ref.lower(), (None, None))
        if lo is not None and val < lo: val = lo
        if hi is not None and val > hi: val = hi
        return val

    # lecture
    def filter_state(self, s):
        refs = self.read_refs
        out = {k: s[k] for k in STATE_SCALARS if k in s}
        out["error"] = True if s.get("error") else None   # pas de détail interne
        for k in STATE_DICTS:
            d = s.get(k) or {}
            if k == "analog":
                out[k] = {n: v for n, v in d.items()
                          if str(n).lower() in refs
                          or str((v or {}).get("name", "")).lower() in refs}
            else:
                out[k] = {n: v for n, v in d.items() if str(n).lower() in refs}
        return out


# ── Application Flask « invité » ──────────────────────────────────────────────
# Barre des pages masquée : la page invité est seule, la barre ne sert à rien et prend de la place.
_HEAD = ("<style>#toolbar,#nav-fixed-bar,#nav-bar-toggle,#pages-bar{display:none!important}"
         "</style>")
_BODY = """<script>
/* Page invité : lecture seule de l'éditeur, aucune navigation, pas de sauvegarde */
(function(){
  function lock(){
    var so = window.__guestSO || window.setOperatorMode;
    window.__guestSO = so;
    window.toggleMode = function(){};
    window.saveSynoptic = function(){};
    window.clearCanvas = function(){};
    window.setOperatorMode = function(){ if(so) so(true); };
    if(so) so(true);
  }
  lock(); window.addEventListener('load', lock);
})();
</script>"""


def _render_html(base_dir, mobile):
    from flask import render_template_string
    src = (Path(base_dir) / "templates" / "synoptic.html").read_text(encoding="utf-8")
    html = render_template_string(src, mobile=mobile)
    # pas de socket.io (CDN) : le synoptique bascule seul sur le polling /api/state
    html = re.sub(r"<script[^>]+socket\.io[^>]*>\s*</script>\s*", "", html, flags=re.I)
    html = html.replace("</head>", _HEAD + "</head>", 1)
    return html.replace("</body>", _BODY + "</body>", 1) if "</body>" in html else html + _BODY


def create_app(base_dir, main_app, snapshot_fn, history_fn=None):
    from flask import Flask, jsonify, request, Response, abort

    base_dir = Path(base_dir)
    app = Flask("rpi_plc_guest", static_folder=None)
    hits = {}

    def policy():
        page = find_guest_page(load_synoptic(base_dir))
        if page is None:
            abort(404)
        return Policy(page)

    @app.after_request
    def _h(r):
        r.headers["Cache-Control"] = "no-store"
        r.headers["X-Frame-Options"] = "DENY"
        r.headers["X-Content-Type-Options"] = "nosniff"
        return r

    @app.route("/")
    def index():
        policy()
        return Response(_render_html(base_dir, request.args.get("mobile") == "1"),
                        mimetype="text/html")

    @app.route("/static/synoptic_canvas.js")
    def canvas_js():
        p = base_dir / "static" / "synoptic_canvas.js"
        if not p.exists():
            abort(404)
        return Response(p.read_text(encoding="utf-8"), mimetype="application/javascript")

    @app.route("/api/synoptic")
    def api_synoptic():
        pol = policy()
        syn = load_synoptic(base_dir) or {}
        blob = json.dumps(pol.page, ensure_ascii=False)
        images = [im for im in (syn.get("images") or [])
                  if isinstance(im, dict) and str(im.get("id", "")) and str(im["id"]) in blob]
        return jsonify({"pages": [pol.page], "curPage": 0, "showNavBar": False,
                        "images": images})

    @app.route("/api/state")
    def api_state():
        return jsonify(policy().filter_state(snapshot_fn()))

    @app.route("/api/gpio/config")
    def api_gpio_config():
        pol = policy()
        out = {}
        for pin, c in (snapshot_fn().get("gpio") or {}).items():
            if str(pin) in pol.read_refs:
                out[str(pin)] = {"name": c.get("name", f"GPIO{pin}"),
                                 "mode": c.get("mode", "output")}
        return jsonify(out)

    @app.route("/api/history/<ref>")
    def api_history(ref):
        if history_fn is None or ref.lower() not in policy().read_refs:
            abort(404)
        return jsonify(history_fn(ref, int(request.args.get("hours", 24))))

    # ── Écritures validées puis déléguées aux routes du serveur principal ─────
    def _write(endpoint, key, check, numeric=False):
        pol = policy()
        ip = request.remote_addr or "?"
        q = hits.setdefault(ip, deque(maxlen=40))
        now = time.time()
        while q and now - q[0] > 10:
            q.popleft()
        if len(q) >= 30:
            return jsonify({"ok": False, "error": "trop de commandes"}), 429
        q.append(now)
        d = request.get_json(force=True, silent=True)
        if not isinstance(d, dict):
            return jsonify({"ok": False, "error": "requête invalide"}), 400
        ref = str(d.get(key, "")).strip()
        if not check(pol, ref, d):
            log.warning(f"[GUEST] commande refusée {endpoint} {ref!r} depuis {ip}")
            return jsonify({"ok": False, "error": "commande non autorisée"}), 403
        if numeric:
            v = _fnum(d.get("value"))
            if v is None:
                return jsonify({"ok": False, "error": "valeur invalide"}), 400
            d["value"] = pol.clamp(ref, v)
        log.info(f"[GUEST] {endpoint} {ref} = {d.get('value')} ({ip})")
        return main_app.view_functions[endpoint]()

    @app.route("/api/dv/write", methods=["POST"])
    def w_dv():
        return _write("api_dv_write", "varname", lambda p, r, d: p.can_dv(r))

    @app.route("/api/memory/write", methods=["POST"])
    def w_mem():
        return _write("api_mem_write", "ref", lambda p, r, d: p.can_mem(r))

    @app.route("/api/av/write", methods=["POST"])
    def w_av():
        return _write("api_av_write", "varname", lambda p, r, d: p.can_av(r), numeric=True)

    @app.route("/api/register/write", methods=["POST"])
    def w_reg():
        return _write("api_reg_write", "ref", lambda p, r, d: p.can_reg(r), numeric=True)

    @app.route("/api/gpio/write", methods=["POST"])
    def w_gpio():
        def ok(p, r, d):
            try:
                return int(r) in p.pins
            except ValueError:
                return False
        return _write("api_gpio_write", "pin", ok)

    @app.errorhandler(404)
    def _404(e):
        return Response("Page invité indisponible", status=404, mimetype="text/plain")

    return app


# ── Gestion du serveur invité (démarrage/arrêt dynamiques) ───────────────────
class _Server:
    def __init__(self, host, port, app):
        from werkzeug.serving import make_server
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as t:   # werkzeug fait
            t.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)    # sys.exit() si
            t.bind((host, port))                                       # le port est pris
        self.srv = make_server(host, port, app, threaded=True)
        threading.Thread(target=self.srv.serve_forever, daemon=True,
                         name="guest-web").start()

    def stop(self):
        try:
            self.srv.shutdown()
            self.srv.server_close()
        except Exception:
            pass


class GuestManager(threading.Thread):
    def __init__(self, engine, main_app, base_dir, snapshot_fn, history_fn=None):
        super().__init__(daemon=True, name="guest-manager")
        self.engine, self.base = engine, Path(base_dir)
        self.app = create_app(base_dir, main_app, snapshot_fn, history_fn)
        self.srv, self.bound, self._err = None, None, None
        self._stop_evt = threading.Event()

    def _cfg(self):
        try:
            cfg = json.loads((self.base / "config.json").read_text(encoding="utf-8"))
        except Exception:
            cfg = dict(getattr(self.engine, "config", {}) or {})
        g = cfg.get("guest") or {}
        web = int(cfg.get("web_port", 5000))
        return {"enabled": bool(g.get("enabled", True)),
                "host": str(g.get("host", "0.0.0.0")),
                "port": int(g.get("port", web + 1)), "web": web}

    def _tick(self):
        c = self._cfg()
        want = c["enabled"] and c["port"] != c["web"] \
            and find_guest_page(load_synoptic(self.base)) is not None
        key = (c["host"], c["port"])
        if self.srv and (not want or self.bound != key):
            self.srv.stop(); self.srv, self.bound = None, None
            log.info("[GUEST] page invité arrêtée")
        if want and not self.srv:
            try:
                self.srv = _Server(c["host"], c["port"], self.app)
                self.bound, self._err = key, None
                log.info(f"[GUEST] page invité : http://{c['host']}:{c['port']}/")
            except (Exception, SystemExit) as e:
                if self._err != str(e):          # une seule trace par erreur
                    log.warning(f"[GUEST] port {c['port']} indisponible : {e}")
                    self._err = str(e)

    def run(self):
        while not self._stop_evt.is_set():
            try:
                self._tick()
            except (Exception, SystemExit) as e:
                log.warning(f"[GUEST] erreur : {e}")
            self._stop_evt.wait(3.0)

    def stop(self):
        self._stop_evt.set()
        if self.srv:
            self.srv.stop()


def attach(engine, main_app, base_dir, snapshot_fn, history_fn=None):
    """Appelé par server.start_web() ; ne lève jamais."""
    try:
        m = GuestManager(engine, main_app, base_dir, snapshot_fn, history_fn)
        m.start()
        return m
    except (Exception, SystemExit) as e:
        log.warning(f"[GUEST] non démarré : {e}")
        return None
