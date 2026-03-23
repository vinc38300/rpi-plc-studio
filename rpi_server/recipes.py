#!/usr/bin/env python3
"""
recipes.py — Gestionnaire de recettes / profils de consignes
Licence MIT

Une recette = un nom + une description + des valeurs RF et M à appliquer.
Stockées dans recipes.json dans le dossier rpi_server/.

Format recipes.json :
{
  "Mode été": {
    "description": "Consignes basses saison chaude",
    "created": "2025-01-01T00:00:00",
    "setpoints": {"RF0": 18.0, "RF1": 80.0, "RF2": 5.0},
    "memory":    {"M10": false}
  }
}
"""

import json, logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger("rpi-plc.recipes")


class RecipeManager:

    def __init__(self, base_dir: Path):
        self.path = base_dir / "recipes.json"
        self._data: dict = {}
        self._load()

    # ── Persistance ──────────────────────────────────────────────────────────

    def _load(self):
        if self.path.exists():
            try:
                self._data = json.loads(self.path.read_text())
                log.info(f"Recettes chargées : {len(self._data)} ({self.path})")
            except Exception as e:
                log.warning(f"Erreur lecture recettes : {e}")
                self._data = {}
        else:
            self._data = {}
            self._save()

    def _save(self):
        try:
            self.path.write_text(json.dumps(self._data, indent=2, ensure_ascii=False))
        except Exception as e:
            log.error(f"Erreur sauvegarde recettes : {e}")

    # ── CRUD ─────────────────────────────────────────────────────────────────

    def list_names(self) -> list:
        return sorted(self._data.keys())

    def get(self, name: str) -> dict:
        return self._data.get(name, {})

    def get_all(self) -> dict:
        return dict(self._data)

    def save_recipe(self, name: str, description: str,
                    setpoints: dict, memory: dict = None) -> bool:
        """Enregistre ou met à jour une recette."""
        if not name.strip():
            return False
        self._data[name] = {
            "description": description,
            "created":     datetime.now().isoformat(timespec="seconds"),
            "setpoints":   {k: float(v) for k, v in setpoints.items()},
            "memory":      memory or {},
        }
        self._save()
        log.info(f"Recette sauvegardée : '{name}'")
        return True

    def delete_recipe(self, name: str) -> bool:
        if name in self._data:
            del self._data[name]
            self._save()
            log.info(f"Recette supprimée : '{name}'")
            return True
        return False

    def apply(self, name: str, engine) -> bool:
        """Applique une recette sur le moteur PLC (écrit RF et M)."""
        recipe = self._data.get(name)
        if not recipe:
            return False
        for ref, val in recipe.get("setpoints", {}).items():
            if ref.startswith("RF"):
                engine.registers[ref] = float(val)
        for ref, val in recipe.get("memory", {}).items():
            if ref.startswith("M"):
                engine.memory[ref] = bool(val)
        log.info(f"Recette appliquée : '{name}'")
        return True

    def snapshot_from_engine(self, engine, name: str, description: str = "") -> bool:
        """Crée une recette à partir de l'état courant du moteur."""
        regs = {k: v for k, v in engine.registers.items()}
        mems = {k: v for k, v in engine.memory.items() if v}  # que les bits à 1
        return self.save_recipe(name, description, regs, mems)
