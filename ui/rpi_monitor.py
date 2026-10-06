"""
ui/rpi_monitor.py — Moniteur RPi en direct pour RPI-PLC Studio

Interroge /api/state toutes les POLL_MS millisecondes et émet un signal
state_received(dict) identique au callback on_update du moteur local.
Le main_window n'a qu'à connecter ce signal à _on_plc_update pour obtenir
l'animation des blocs FBD et la mise à jour du synoptique, exactement comme
en simulation locale.
"""

import json
import time
import urllib.request
import urllib.error

from PyQt5.QtCore import QThread, pyqtSignal

POLL_MS     = 200      # intervalle de polling (ms)
TIMEOUT_S   = 4.0      # timeout HTTP (large : handshake TLS + VPN Headscale/relais)
RETRY_DELAY = 2.0      # secondes entre tentatives après échec


class AuthError(RuntimeError):
    """Identifiants refusés par le RPi : inutile de réessayer tant qu'ils ne changent pas."""


class RpiMonitor(QThread):
    """Thread de polling /api/state vers un RPi distant."""

    # Signaux
    state_received  = pyqtSignal(dict)    # nouvel état PLC reçu
    connected       = pyqtSignal(str)     # url du RPi quand la connexion s'établit
    disconnected    = pyqtSignal(str)     # message d'erreur quand la connexion tombe
    auth_failed     = pyqtSignal(str)     # identifiants refusés (le moniteur s'arrête)

    def __init__(self, url: str, parent=None, username: str = "", password: str = ""):
        """
        :param url: URL de base du RPi, ex. 'http://192.168.1.49:5000'
        :param username/password: identifiants si security.enabled est actif sur le RPi
        """
        super().__init__(parent)
        self._url      = url.rstrip("/")
        self._username = username or ""
        self._password = password or ""
        self._cookie   = ""            # "plc_session=<token>" après login
        self._login_blocked_until = 0.0
        self._running  = False
        self._connected = False
        self._last_error = ""

    # ── API publique ────────────────────────────────────────────────────
    def start_monitoring(self):
        """Démarre le polling en arrière-plan."""
        self._running = True
        self.start()

    def stop_monitoring(self):
        """Arrête proprement le thread."""
        self._running = False
        self.wait(2000)

    @property
    def url(self):
        return self._url

    @url.setter
    def url(self, value: str):
        self._url = value.rstrip("/")

    # ── Boucle principale ───────────────────────────────────────────────
    def run(self):
        state_url = f"{self._url}/api/state"

        while self._running:
            t0 = time.monotonic()
            try:
                raw = self._fetch_state(state_url)

                state = json.loads(raw)

                # Première connexion réussie
                if not self._connected:
                    self._connected = True
                    self._last_error = ""
                    self.connected.emit(self._url)

                self.state_received.emit(state)

            except AuthError as e:
                # Réessayer ne ferait que déclencher le blocage anti-bruteforce du RPi
                # (5 échecs / 5 min) : on s'arrête et on le dit.
                msg = f"{e} — moniteur arrêté, relancez-le (F9) avec les bons identifiants"
                self._running = False
                self.disconnected.emit(msg)
                self.auth_failed.emit(msg)
                return
            except (urllib.error.URLError, OSError, json.JSONDecodeError, RuntimeError) as e:
                msg = self._describe_error(e)
                # Signaler chaque NOUVELLE cause d'échec (même avant la 1re connexion),
                # sans répéter le même message toutes les 2 s.
                if self._connected or msg != self._last_error:
                    self._connected = False
                    self._last_error = msg
                    self.disconnected.emit(msg)
                # Attendre avant de réessayer
                elapsed = time.monotonic() - t0
                sleep_s = max(0.0, RETRY_DELAY - elapsed)
                self._sleep(sleep_s)
                continue

            # Respect de l'intervalle de polling
            elapsed = time.monotonic() - t0
            sleep_s = max(0.0, (POLL_MS / 1000.0) - elapsed)
            self._sleep(sleep_s)

    def _fetch_state(self, state_url: str) -> bytes:
        """GET /api/state ; en cas de 401, se connecte (si identifiants) puis réessaie."""
        for attempt in (1, 2):
            headers = {"Accept": "application/json"}
            if self._cookie:
                headers["Cookie"] = self._cookie
            req = urllib.request.Request(state_url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                    return resp.read()
            except urllib.error.HTTPError as e:
                if e.code != 401 or attempt == 2:
                    raise
                if not self._username:
                    raise RuntimeError("authentification requise par le RPi : "
                                       "aucun identifiant fourni au moniteur")
                if time.monotonic() < self._login_blocked_until:
                    raise RuntimeError("login en pause après un refus — nouvelle tentative bientôt")
                self._cookie = ""
                self._login()
        raise RuntimeError("état inaccessible")

    def _login(self):
        """POST /api/login → mémorise le cookie de session. Lève une erreur lisible sinon."""
        body = json.dumps({"username": self._username, "password": self._password}).encode()
        req = urllib.request.Request(
            f"{self._url}/api/login", data=body, method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                cookies = resp.headers.get_all("Set-Cookie") or []
        except urllib.error.HTTPError as e:
            if e.code == 429:
                self._login_blocked_until = time.monotonic() + 300
                raise RuntimeError("login refusé : trop de tentatives (blocage 5 min côté RPi)")
            if e.code == 401:
                raise AuthError("login refusé : identifiants incorrects "
                                "(utilisateur/mot de passe de security du RPi)")
            raise
        for c in cookies:
            if c.startswith("plc_session="):
                self._cookie = c.split(";", 1)[0]
                return
        raise RuntimeError("login accepté mais aucun cookie de session reçu")

    @staticmethod
    def _describe_error(e) -> str:
        """Message d'erreur lisible (cause réelle de l'échec)."""
        if isinstance(e, urllib.error.HTTPError):
            if e.code in (401, 403):
                return (f"HTTP {e.code} — authentification activée sur le RPi "
                        f"(security.enabled) : /api/state refusé sans session")
            return f"HTTP {e.code} {e.reason}"
        if isinstance(e, urllib.error.URLError):
            return f"{type(e.reason).__name__} : {e.reason}"
        if isinstance(e, json.JSONDecodeError):
            return f"Réponse non-JSON reçue de {e.doc[:60]!r}"
        if isinstance(e, RuntimeError):
            return str(e)
        return f"{type(e).__name__} : {e}"

    def _sleep(self, seconds: float):
        """Découpe le sleep pour réagir rapidement à stop_monitoring()."""
        step = 0.05
        end  = time.monotonic() + seconds
        while self._running and time.monotonic() < end:
            time.sleep(min(step, end - time.monotonic()))
