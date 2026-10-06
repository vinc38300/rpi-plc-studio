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
TIMEOUT_S   = 1.5      # timeout HTTP
RETRY_DELAY = 2.0      # secondes entre tentatives après échec


class RpiMonitor(QThread):
    """Thread de polling /api/state vers un RPi distant."""

    # Signaux
    state_received  = pyqtSignal(dict)    # nouvel état PLC reçu
    connected       = pyqtSignal(str)     # url du RPi quand la connexion s'établit
    disconnected    = pyqtSignal(str)     # message d'erreur quand la connexion tombe

    def __init__(self, url: str, parent=None):
        """
        :param url: URL de base du RPi, ex. 'http://192.168.1.49:5000'
        """
        super().__init__(parent)
        self._url      = url.rstrip("/")
        self._running  = False
        self._connected = False

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
                req = urllib.request.Request(
                    state_url,
                    headers={"Accept": "application/json"},
                )
                with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                    raw = resp.read()

                state = json.loads(raw)

                # Première connexion réussie
                if not self._connected:
                    self._connected = True
                    self.connected.emit(self._url)

                self.state_received.emit(state)

            except (urllib.error.URLError, OSError, json.JSONDecodeError) as e:
                if self._connected:
                    self._connected = False
                    self.disconnected.emit(str(e))
                # Attendre avant de réessayer
                elapsed = time.monotonic() - t0
                sleep_s = max(0.0, RETRY_DELAY - elapsed)
                self._sleep(sleep_s)
                continue

            # Respect de l'intervalle de polling
            elapsed = time.monotonic() - t0
            sleep_s = max(0.0, (POLL_MS / 1000.0) - elapsed)
            self._sleep(sleep_s)

    def _sleep(self, seconds: float):
        """Découpe le sleep pour réagir rapidement à stop_monitoring()."""
        step = 0.05
        end  = time.monotonic() + seconds
        while self._running and time.monotonic() < end:
            time.sleep(min(step, end - time.monotonic()))
