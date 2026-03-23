#!/usr/bin/env python3
"""
auth.py — Authentification et sécurité pour RPi-PLC Studio
Licence MIT

Fournit :
  - Middleware Flask : vérification token de session
  - Génération de certificat TLS auto-signé (HTTPS)
  - Page de login
  - Hash SHA-256 des mots de passe
  - Protection rate-limit (5 tentatives / 5 min)
"""

import os, time, secrets, hashlib, logging, subprocess
from pathlib import Path
from functools import wraps

log = logging.getLogger("rpi-plc.auth")

# ── Stockage sessions en mémoire ─────────────────────────────────────────────
_sessions: dict = {}        # token → {expires, username}
_fail_log: dict = {}        # ip → [timestamps]
SESSION_TTL    = 8 * 3600   # 8 heures
MAX_FAILS      = 5
FAIL_WINDOW    = 300        # 5 minutes


def _hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def _clean_sessions():
    now = time.time()
    for tok in list(_sessions):
        if _sessions[tok]["expires"] < now:
            del _sessions[tok]


def _is_rate_limited(ip: str) -> bool:
    now = time.time()
    attempts = _fail_log.get(ip, [])
    recent   = [t for t in attempts if now - t < FAIL_WINDOW]
    _fail_log[ip] = recent
    return len(recent) >= MAX_FAILS


def _record_fail(ip: str):
    _fail_log.setdefault(ip, []).append(time.time())


def create_session(username: str) -> str:
    _clean_sessions()
    token = secrets.token_hex(32)
    _sessions[token] = {"expires": time.time() + SESSION_TTL, "username": username}
    return token


def validate_session(token: str) -> bool:
    _clean_sessions()
    s = _sessions.get(token)
    if not s:
        return False
    if s["expires"] < time.time():
        del _sessions[token]
        return False
    # Rafraîchir la durée
    s["expires"] = time.time() + SESSION_TTL
    return True


def destroy_session(token: str):
    _sessions.pop(token, None)


# ── Middleware Flask ──────────────────────────────────────────────────────────

def make_auth_middleware(app, config: dict):
    """
    Injecte la vérification d'authentification dans Flask.
    Appeler après la création de app.
    """
    sec = config.get("security", {})
    if not sec.get("enabled", False):
        log.info("Authentification désactivée")
        return

    username_cfg = sec.get("username", "admin")
    password_hash = _hash(sec.get("password", "plc1234"))
    log.info(f"Authentification activée — utilisateur : {username_cfg}")

    PUBLIC_PATHS = {"/login", "/api/login", "/sw.js", "/manifest.json",
                    "/static/icon-192.png", "/static/icon-512.png"}

    @app.before_request
    def check_auth():
        from flask import request, redirect, url_for, abort
        path = request.path

        # Chemins publics (login, service worker…)
        if path in PUBLIC_PATHS or path.startswith("/static/"):
            return

        # Vérifier le cookie de session
        token = request.cookies.get("plc_session", "")
        if validate_session(token):
            return  # OK

        # Rediriger vers la page de login (HTML) ou 401 (API)
        if path.startswith("/api/") or path.startswith("/socket.io/"):
            abort(401)
        return redirect(f"/login?next={path}")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        from flask import request, make_response, redirect, render_template_string

        if request.method == "GET":
            next_url = request.args.get("next", "/scada")
            return render_template_string(LOGIN_HTML, next=next_url)

        # POST — vérification
        ip       = request.remote_addr
        username = request.form.get("username", "")
        password = request.form.get("password", "")
        next_url = request.form.get("next", "/scada")

        if _is_rate_limited(ip):
            return render_template_string(LOGIN_HTML, next=next_url,
                error="Trop de tentatives — réessayer dans 5 minutes."), 429

        if username == username_cfg and _hash(password) == password_hash:
            log.info(f"Connexion réussie : {username} depuis {ip}")
            token = create_session(username)
            resp  = make_response(redirect(next_url))
            resp.set_cookie("plc_session", token, httponly=True,
                            samesite="Lax", max_age=SESSION_TTL)
            return resp
        else:
            _record_fail(ip)
            log.warning(f"Échec connexion : {username} depuis {ip}")
            return render_template_string(LOGIN_HTML, next=next_url,
                error="Identifiants incorrects."), 401

    @app.route("/api/login", methods=["POST"])
    def api_login():
        from flask import request, jsonify, make_response
        ip = request.remote_addr
        d  = request.json or {}
        if _is_rate_limited(ip):
            return jsonify({"ok": False, "error": "rate_limited"}), 429
        if d.get("username") == username_cfg and _hash(d.get("password","")) == password_hash:
            token = create_session(d["username"])
            resp  = make_response(jsonify({"ok": True}))
            resp.set_cookie("plc_session", token, httponly=True,
                            samesite="Lax", max_age=SESSION_TTL)
            return resp
        _record_fail(ip)
        return jsonify({"ok": False, "error": "invalid_credentials"}), 401

    @app.route("/api/logout", methods=["POST"])
    def api_logout():
        from flask import request, make_response, jsonify
        token = request.cookies.get("plc_session", "")
        destroy_session(token)
        resp = make_response(jsonify({"ok": True}))
        resp.delete_cookie("plc_session")
        return resp

    @app.route("/logout")
    def logout():
        from flask import request, make_response, redirect
        token = request.cookies.get("plc_session", "")
        destroy_session(token)
        resp = make_response(redirect("/login"))
        resp.delete_cookie("plc_session")
        return resp


# ── Page de login ─────────────────────────────────────────────────────────────

LOGIN_HTML = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0d1117">
<title>RPi-PLC — Connexion</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',system-ui,sans-serif;background:#0d1117;color:#e6edf3;
  min-height:100vh;display:flex;align-items:center;justify-content:center;}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;
  padding:40px 36px;width:100%;max-width:380px;box-shadow:0 20px 60px #00000060;}
.logo{text-align:center;margin-bottom:32px;}
.logo h1{font-size:26px;font-weight:800;color:#58a6ff;}
.logo h1 span{color:#3fb950;}
.logo p{font-size:13px;color:#8b949e;margin-top:4px;}
label{display:block;font-size:12px;color:#8b949e;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;}
input{width:100%;background:#0d1117;border:1px solid #30363d;color:#e6edf3;
  padding:10px 14px;border-radius:8px;font-size:14px;margin-bottom:16px;
  transition:border-color .15s;}
input:focus{outline:none;border-color:#58a6ff;}
button{width:100%;background:#1a2f45;border:1px solid #58a6ff;color:#58a6ff;
  padding:11px;border-radius:8px;font-size:14px;font-weight:600;
  cursor:pointer;transition:all .15s;margin-top:4px;}
button:hover{background:#204060;}
.error{background:#2a1010;border:1px solid #f85149;border-radius:8px;
  padding:10px 14px;font-size:13px;color:#f85149;margin-bottom:16px;}
.footer{text-align:center;font-size:11px;color:#484f58;margin-top:24px;}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <h1>RPi-PLC<span> Studio</span></h1>
    <p>Interface de supervision SCADA</p>
  </div>
  {% if error %}
  <div class="error">{{ error }}</div>
  {% endif %}
  <form method="post" action="/login">
    <input type="hidden" name="next" value="{{ next }}">
    <label>Identifiant</label>
    <input type="text" name="username" autocomplete="username" autofocus placeholder="admin">
    <label>Mot de passe</label>
    <input type="password" name="password" autocomplete="current-password" placeholder="••••••••">
    <button type="submit">Se connecter</button>
  </form>
  <div class="footer">RPi-PLC Studio · LAN sécurisé</div>
</div>
</body>
</html>"""


# ── Génération certificat TLS auto-signé ──────────────────────────────────────

def ensure_tls_cert(base_dir: Path) -> tuple:
    """
    Génère un certificat auto-signé si absent.
    Retourne (cert_path, key_path) ou (None, None) si openssl absent.
    """
    cert = base_dir / "tls_cert.pem"
    key  = base_dir / "tls_key.pem"

    if cert.exists() and key.exists():
        return str(cert), str(key)

    try:
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048",
            "-keyout", str(key), "-out", str(cert),
            "-days", "3650", "-nodes",
            "-subj", "/CN=rpi-plc/O=RPi-PLC Studio/C=FR",
            "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost,DNS:rpi-plc.local",
        ], capture_output=True, check=True)
        log.info(f"Certificat TLS généré : {cert}")
        return str(cert), str(key)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        log.warning(f"openssl non disponible — HTTPS désactivé : {e}")
        return None, None


def get_ssl_context(base_dir: Path, config: dict):
    """
    Retourne le contexte SSL pour Flask si HTTPS activé, sinon None.
    """
    if not config.get("security", {}).get("https", False):
        return None
    cert, key = ensure_tls_cert(base_dir)
    if not cert:
        return None
    try:
        import ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        log.info("HTTPS activé avec certificat auto-signé")
        return ctx
    except Exception as e:
        log.warning(f"SSL context : {e}")
        return None
