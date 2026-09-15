"""
core/headscale_api.py — Petit client REST pour l'API Headscale
Dépendances : aucune (urllib standard, comme ui/rpi_monitor.py)

Utilisé par le déploiement Studio → RPi pour générer à la volée une clé
de pré-authentification Tailscale, afin que le RPi puisse rejoindre le
tailnet Headscale sans étape manuelle (headscale users create / preauthkeys create).
"""

import json
import urllib.request
import urllib.error

TIMEOUT_S = 10


class HeadscaleAPIError(Exception):
    pass


def _request(base_url: str, api_key: str, path: str, method: str = "GET", body: dict = None) -> dict:
    url = base_url.rstrip("/") + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {api_key}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise HeadscaleAPIError(f"HTTP {e.code} sur {path} : {detail[:300]}")
    except urllib.error.URLError as e:
        raise HeadscaleAPIError(f"Impossible de joindre {base_url} : {e.reason}")


def get_user_id(base_url: str, api_key: str, username: str) -> str:
    """Résout le nom d'utilisateur Headscale en ID numérique (requis par l'API >=0.26)."""
    data = _request(base_url, api_key, f"/api/v1/user?name={username}")
    users = data.get("users", [])
    if not users:
        raise HeadscaleAPIError(f"Utilisateur Headscale « {username} » introuvable")
    return str(users[0]["id"])


def create_preauth_key(base_url: str, api_key: str, username: str,
                        expiration_hours: int = 24, reusable: bool = True,
                        ephemeral: bool = False) -> str:
    """Crée une clé de pré-authentification pour `username` et retourne la clé (str)."""
    import datetime
    user_id = get_user_id(base_url, api_key, username)
    expiration = (datetime.datetime.utcnow() +
                  datetime.timedelta(hours=expiration_hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {
        "user": user_id,
        "reusable": reusable,
        "ephemeral": ephemeral,
        "expiration": expiration,
    }
    data = _request(base_url, api_key, "/api/v1/preauthkey", method="POST", body=body)
    key = data.get("preAuthKey", {}).get("key")
    if not key:
        raise HeadscaleAPIError(f"Réponse inattendue de Headscale : {data}")
    return key
