"""
core/net.py — Accès réseau du Studio vers le serveur du RPi (HTTP ou HTTPS).

Le serveur du RPi peut tourner en HTTPS avec un certificat auto-signé
(security.https = true dans son config.json). Or le Studio construit ses URL en
« http:// » : moniteur en direct, test Telegram, état du RPi, etc. Résultat : le
serveur ferme la connexion sans répondre et le moniteur reste « hors ligne ».

install() corrige cela une seule fois, pour tous les appels urllib et requests :
  1. une URL http:// qui reçoit une réponse vide (serveur en HTTPS) est
     rejouée en https://, et inversement (https:// vers un serveur en HTTP) ;
  2. le schéma qui fonctionne est mémorisé par (hôte, port) ;
  3. la vérification du certificat est désactivée UNIQUEMENT pour les hôtes
     du réseau local (IP privées, Tailscale/Headscale 100.64.0.0/10, boucle
     locale, noms sans point ou en .local/.lan) : certificat auto-signé du RPi.
     Les hôtes publics (API Headscale, etc.) restent vérifiés normalement.
"""

import http.client
import ipaddress
import logging
import socket
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request

log = logging.getLogger("net")

_CGNAT = ipaddress.ip_network("100.64.0.0/10")        # Tailscale / Headscale
_LOCAL_SUFFIXES = (".local", ".lan", ".home", ".internal")

_scheme_cache = {}                                     # (host, port) -> "http" | "https"
_lock = threading.Lock()
_installed = False

_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


# ── Utilitaires ──────────────────────────────────────────────────────────────
def is_local_host(host: str) -> bool:
    """True pour les hôtes d'un réseau privé / VPN maillé / local."""
    if not host:
        return False
    host = host.strip("[]").lower()
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_private or ip.is_loopback or ip.is_link_local or ip in _CGNAT
    except ValueError:
        return "." not in host or host.endswith(_LOCAL_SUFFIXES)


def _key(url: str):
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        return None
    port = p.port or (443 if p.scheme == "https" else 80)
    return (p.hostname.lower(), port)


def _with_scheme(url: str, scheme: str) -> str:
    return urllib.parse.urlunsplit((scheme,) + tuple(urllib.parse.urlsplit(url))[1:])


def _scheme_of(url: str) -> str:
    return urllib.parse.urlsplit(url).scheme


def _is_empty_reply(exc) -> bool:
    """Réponse vide / connexion coupée : signature d'un http:// vers un serveur HTTPS."""
    e = exc.reason if isinstance(exc, urllib.error.URLError) and not isinstance(exc, urllib.error.HTTPError) else exc
    if isinstance(e, (http.client.RemoteDisconnected, http.client.BadStatusLine,
                      ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
        return True
    txt = str(exc)
    return "Connection aborted" in txt or "RemoteDisconnected" in txt or "Remote end closed" in txt


def _is_tls_mismatch(exc) -> bool:
    """Échec TLS : signature d'un https:// vers un serveur HTTP en clair."""
    e = exc.reason if isinstance(exc, urllib.error.URLError) and not isinstance(exc, urllib.error.HTTPError) else exc
    if isinstance(e, ssl.SSLError):
        return True
    txt = str(exc).upper()
    return "WRONG_VERSION_NUMBER" in txt or "RECORD_LAYER_FAILURE" in txt or "SSLERROR" in txt


def _url_of(target):
    if isinstance(target, urllib.request.Request):
        return target.full_url
    return target if isinstance(target, str) else None


def _clone_request(req, new_url):
    new = urllib.request.Request(
        new_url, data=req.data, headers=dict(req.header_items()),
        method=req.get_method(),
    )
    return new


def known_scheme(host: str, port: int):
    with _lock:
        return _scheme_cache.get((host.lower(), int(port)))


def base_url(host: str, port: int = 5000, timeout: float = 2.0) -> str:
    """URL de base fonctionnelle (http ou https) du serveur RPi ; teste les deux si besoin."""
    cached = known_scheme(host, port)
    candidates = [cached] if cached else ["https", "http"]
    for scheme in candidates + [s for s in ("https", "http") if s not in candidates]:
        url = f"{scheme}://{host}:{port}/api/status"
        try:
            with urllib.request.urlopen(url, timeout=timeout):
                return f"{scheme}://{host}:{port}"
        except Exception:
            continue
    return f"http://{host}:{port}"


# ── Patch urllib ─────────────────────────────────────────────────────────────
def _patch_urllib():
    original = urllib.request.urlopen

    def urlopen(target, data=None, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, *args, **kwargs):
        url = _url_of(target)
        key = _key(url) if url else None
        if key is None or not is_local_host(key[0]):
            return original(target, data, timeout, *args, **kwargs)

        def call(tgt, scheme):
            kw = dict(kwargs)
            if scheme == "https" and "context" not in kw:
                kw["context"] = _SSL_CTX
            return original(tgt, data, timeout, *args, **kw)

        def retarget(scheme):
            new_url = _with_scheme(url, scheme)
            if isinstance(target, urllib.request.Request):
                return _clone_request(target, new_url)
            return new_url

        cached = known_scheme(*key)
        first = cached or _scheme_of(url)
        other = "http" if first == "https" else "https"
        try:
            resp = call(retarget(first) if first != _scheme_of(url) else target, first)
            with _lock:
                _scheme_cache.setdefault(key, first)
            return resp
        except (urllib.error.HTTPError,):
            raise                                       # le serveur a répondu : le schéma est bon
        except Exception as exc:
            mismatch = _is_empty_reply(exc) if first == "http" else _is_tls_mismatch(exc)
            if not mismatch:
                raise
            try:
                resp = call(retarget(other), other)
            except Exception:
                raise exc
            with _lock:
                _scheme_cache[key] = other
            log.info("Serveur %s:%s joint en %s", key[0], key[1], other)
            return resp

    urllib.request.urlopen = urlopen


# ── Patch requests ───────────────────────────────────────────────────────────
def _patch_requests():
    try:
        import requests
        import requests.sessions
    except ImportError:
        return
    try:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    except Exception:
        pass

    original = requests.sessions.Session.request

    def request(self, method, url, *args, **kwargs):
        key = _key(url) if isinstance(url, str) else None
        if key is None or not is_local_host(key[0]):
            return original(self, method, url, *args, **kwargs)

        kwargs.setdefault("verify", False)
        cached = known_scheme(*key)
        first = cached or _scheme_of(url)
        other = "http" if first == "https" else "https"
        first_url = url if first == _scheme_of(url) else _with_scheme(url, first)
        try:
            resp = original(self, method, first_url, *args, **kwargs)
            with _lock:
                _scheme_cache.setdefault(key, first)
            return resp
        except requests.exceptions.RequestException as exc:
            if isinstance(exc, (requests.exceptions.Timeout,)):
                raise
            mismatch = _is_empty_reply(exc) if first == "http" else _is_tls_mismatch(exc)
            if not mismatch:
                raise
            try:
                resp = original(self, method, _with_scheme(url, other), *args, **kwargs)
            except Exception:
                raise exc
            with _lock:
                _scheme_cache[key] = other
            log.info("Serveur %s:%s joint en %s", key[0], key[1], other)
            return resp

    requests.sessions.Session.request = request


def install():
    """À appeler une fois au démarrage du Studio (idempotent)."""
    global _installed
    if _installed:
        return
    _patch_urllib()
    _patch_requests()
    _installed = True
    log.info("core.net : HTTP/HTTPS automatique actif pour les hôtes du réseau local")
