#!/usr/bin/env python3
"""
calibration.py — Calibration des sondes PT100
Licence MIT

Chaque sonde peut avoir :
  - Un offset de température (±20°C)
  - Un gain (facteur multiplicatif, défaut 1.0)
  - Un nom personnalisé
  - Un seuil d'alarme haut/bas propre

Stocké dans calibration.json :
{
  "ANA0": {"name": "Retour chaudière", "offset": 0.5, "gain": 1.0,
            "alarm_high": 90.0, "alarm_low": 5.0, "unit": "°C", "enabled": true},
  ...
}
"""

import json, logging
from pathlib import Path

log = logging.getLogger("rpi-plc.calibration")

DEFAULT_CAL = {
    "name":       "",
    "offset":     0.0,
    "gain":       1.0,
    "alarm_high": 90.0,
    "alarm_low":  3.0,
    "unit":       "°C",
    "enabled":    True,
}


class CalibrationManager:

    def __init__(self, base_dir: Path):
        self.path  = base_dir / "calibration.json"
        self._data: dict = {}
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self._data = json.loads(self.path.read_text())
                log.info(f"Calibration chargée : {self.path}")
            except Exception as e:
                log.warning(f"calibration.json : {e}")

    def _save(self):
        try:
            self.path.write_text(json.dumps(self._data, indent=2, ensure_ascii=False))
        except Exception as e:
            log.error(f"Sauvegarde calibration : {e}")

    def get(self, channel: str) -> dict:
        """Retourne la calibration d'un canal (avec valeurs par défaut)."""
        base = dict(DEFAULT_CAL)
        base.update(self._data.get(channel, {}))
        if not base["name"]:
            base["name"] = channel
        return base

    def get_all(self) -> dict:
        """Retourne toutes les calibrations (12 canaux)."""
        result = {}
        for i in range(12):
            ch = f"ANA{i}"
            result[ch] = self.get(ch)
        return result

    def set(self, channel: str, data: dict) -> bool:
        if not channel.startswith("ANA"):
            return False
        cal = dict(DEFAULT_CAL)
        cal.update(self._data.get(channel, {}))
        for k in ("name", "offset", "gain", "alarm_high", "alarm_low", "unit", "enabled"):
            if k in data:
                if k in ("offset", "gain", "alarm_high", "alarm_low"):
                    cal[k] = float(data[k])
                elif k == "enabled":
                    cal[k] = bool(data[k])
                else:
                    cal[k] = str(data[k])
        self._data[channel] = cal
        self._save()
        return True

    def apply(self, channel: str, raw_celsius: float) -> float:
        """Applique offset et gain à une mesure brute."""
        if raw_celsius is None or raw_celsius != raw_celsius:  # NaN
            return raw_celsius
        cal = self.get(channel)
        if not cal["enabled"]:
            return raw_celsius
        return raw_celsius * cal["gain"] + cal["offset"]

    def get_name(self, channel: str) -> str:
        cal = self.get(channel)
        return cal["name"] if cal["name"] else channel

    def get_alarms(self, channel: str) -> tuple:
        """Retourne (alarm_high, alarm_low) pour ce canal."""
        cal = self.get(channel)
        return cal["alarm_high"], cal["alarm_low"]
