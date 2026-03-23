"""
core/project.py — Gestion des projets PLC (sauvegarde / chargement)
"""

import os
import json
import datetime
from typing import Optional


DEFAULT_PROJECT = {
    "version": "1.0",
    "name": "Nouveau projet",
    "description": "",
    "created": "",
    "modified": "",
    "rpi": {
        "host": "192.168.1.100",
        "port": 22,
        "user": "pi",
        "password": "",
        "key_path": "",
        "remote_dir": "/home/pi/rpi-plc",
    },
    "plc": {
        "scan_time_ms": 100,
        "gpio_config": {},
    },
    "program": [],  # liste de blocs
    "synoptic": {   # synoptique opérateur
        "widgets":    [],
        "background": "#0d1117",
        "grid":       20,
    },
    "notes": "",
}

PROJECTS_DIR = os.path.expanduser("~/.rpi-plc-studio/projects")


class Project:
    def __init__(self):
        self.data = json.loads(json.dumps(DEFAULT_PROJECT))
        self.filepath: Optional[str] = None
        self.dirty = False
        self.data["created"] = self._now()
        self.data["modified"] = self._now()

    @staticmethod
    def _now() -> str:
        return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ── Propriétés rapides ────────────────────────────────────────────────────
    @property
    def name(self) -> str:
        return self.data.get("name", "Sans nom")

    @name.setter
    def name(self, v: str):
        self.data["name"] = v
        self.dirty = True

    @property
    def program(self):
        """Retourne le programme (liste ou dict multi-pages)."""
        return self.data.get("program", [])

    @property
    def program_block_count(self) -> int:
        """Nombre de blocs — fonctionne pour les deux formats."""
        p = self.program
        if isinstance(p, dict) and "pages" in p:
            return sum(len(pg.get("blocks", [])) for pg in p["pages"])
        return len(p) if isinstance(p, list) else 0

    @program.setter
    def program(self, v):
        self.data["program"] = v
        self.data["modified"] = self._now()
        self.dirty = True

    @property
    def rpi(self) -> dict:
        return self.data.setdefault("rpi", {})

    @property
    def plc_config(self) -> dict:
        return self.data.setdefault("plc", {})

    @property
    def scan_time_ms(self) -> int:
        return self.plc_config.get("scan_time_ms", 100)

    @scan_time_ms.setter
    def scan_time_ms(self, v: int):
        self.plc_config["scan_time_ms"] = v
        self.dirty = True

    # ── Sauvegarde ────────────────────────────────────────────────────────────
    def save(self, filepath: str = None) -> bool:
        path = filepath or self.filepath
        if not path:
            return False
        os.makedirs(os.path.dirname(path), exist_ok=True)
        self.data["modified"] = self._now()
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            self.filepath = path
            self.dirty = False
            return True
        except Exception as e:
            print(f"Erreur de sauvegarde : {e}")
            return False

    # ── Chargement ────────────────────────────────────────────────────────────
    @classmethod
    def load(cls, filepath: str) -> Optional["Project"]:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            proj = cls()
            proj.data = {**DEFAULT_PROJECT, **data}
            proj.filepath = filepath
            proj.dirty = False
            return proj
        except Exception as e:
            print(f"Erreur de chargement : {e}")
            return None

    # ── Projets récents ───────────────────────────────────────────────────────
    @staticmethod
    def list_projects() -> list[dict]:
        os.makedirs(PROJECTS_DIR, exist_ok=True)
        projects = []
        for fname in sorted(os.listdir(PROJECTS_DIR), reverse=True):
            if fname.endswith(".plcproj"):
                path = os.path.join(PROJECTS_DIR, fname)
                try:
                    with open(path) as f:
                        meta = json.load(f)
                    projects.append({
                        "path":     path,
                        "name":     meta.get("name", fname),
                        "modified": meta.get("modified", ""),
                        "blocks":   (sum(len(pg.get("blocks",[]))
                                         for pg in meta["program"]["pages"])
                                     if isinstance(meta.get("program"), dict)
                                     else len(meta.get("program", []))),
                    })
                except Exception:
                    pass
        return projects

    @staticmethod
    def default_path(name: str) -> str:
        safe = "".join(c for c in name if c.isalnum() or c in " _-").strip().replace(" ", "_")
        return os.path.join(PROJECTS_DIR, f"{safe}.plcproj")
