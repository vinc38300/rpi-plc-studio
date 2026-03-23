#!/usr/bin/env python3
"""
backup_manager.py — Sauvegarde versionnée des programmes PLC
Licence MIT

Conserve les N dernières versions de programme.json avec horodatage.
Dossier : rpi_server/backups/
Format  : programme_YYYYMMDD_HHMMSS.json

API exposée par Flask :
  GET  /api/backup/list          → liste des sauvegardes
  POST /api/backup/save          → sauvegarder l'état actuel
  POST /api/backup/restore       → restaurer une sauvegarde
  GET  /api/backup/download/<id> → télécharger un fichier JSON
  POST /api/backup/delete        → supprimer une sauvegarde
"""

import json, shutil, logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger("rpi-plc.backup")


class BackupManager:

    MAX_BACKUPS = 20   # conserver les 20 dernières

    def __init__(self, base_dir: Path):
        self.base_dir   = base_dir
        self.backup_dir = base_dir / "backups"
        self.backup_dir.mkdir(exist_ok=True)
        log.info(f"Sauvegardes : {self.backup_dir}")

    # ── Liste ────────────────────────────────────────────────────────────────

    def list_backups(self) -> list:
        """Retourne la liste des sauvegardes, la plus récente en premier."""
        files = sorted(self.backup_dir.glob("programme_*.json"), reverse=True)
        result = []
        for f in files:
            try:
                stat = f.stat()
                data = json.loads(f.read_text())
                result.append({
                    "id":       f.stem,
                    "filename": f.name,
                    "size":     stat.st_size,
                    "date":     datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
                    "blocks":   len(data) if isinstance(data, list) else "?",
                })
            except Exception:
                pass
        return result

    # ── Sauvegarde ───────────────────────────────────────────────────────────

    def save(self, program: list, label: str = "") -> dict:
        """
        Sauvegarde le programme avec horodatage.
        Retourne les infos de la sauvegarde créée.
        """
        ts       = datetime.now().strftime("%Y%m%d_%H%M%S")
        stem     = f"programme_{ts}"
        filepath = self.backup_dir / f"{stem}.json"

        payload = {
            "label":    label or ts,
            "date":     datetime.now().isoformat(timespec="seconds"),
            "blocks":   len(program),
            "program":  program,
        }
        filepath.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
        log.info(f"Sauvegarde créée : {filepath.name} ({len(program)} blocs)")

        # Purge des anciennes sauvegardes
        self._purge()

        return {
            "id":       stem,
            "filename": filepath.name,
            "date":     payload["date"],
            "blocks":   len(program),
            "label":    label,
        }

    def _purge(self):
        """Supprime les sauvegardes au-delà de MAX_BACKUPS."""
        files = sorted(self.backup_dir.glob("programme_*.json"), reverse=True)
        for old in files[self.MAX_BACKUPS:]:
            try:
                old.unlink()
                log.info(f"Ancienne sauvegarde supprimée : {old.name}")
            except Exception:
                pass

    # ── Restauration ─────────────────────────────────────────────────────────

    def restore(self, backup_id: str) -> list | None:
        """
        Charge une sauvegarde et retourne le programme (liste de blocs).
        Retourne None si introuvable.
        """
        filepath = self.backup_dir / f"{backup_id}.json"
        if not filepath.exists():
            log.warning(f"Sauvegarde introuvable : {backup_id}")
            return None
        try:
            data = json.loads(filepath.read_text())
            # Le fichier peut contenir directement le programme (list)
            # ou un wrapper {"program": [...], "label": "..."}
            program = data.get("program", data) if isinstance(data, dict) else data
            if not isinstance(program, list):
                return None
            log.info(f"Sauvegarde restaurée : {filepath.name} ({len(program)} blocs)")
            return program
        except Exception as e:
            log.error(f"Erreur restauration {backup_id}: {e}")
            return None

    def delete(self, backup_id: str) -> bool:
        filepath = self.backup_dir / f"{backup_id}.json"
        if filepath.exists():
            filepath.unlink()
            log.info(f"Sauvegarde supprimée : {filepath.name}")
            return True
        return False

    def get_path(self, backup_id: str) -> Path | None:
        p = self.backup_dir / f"{backup_id}.json"
        return p if p.exists() else None

    # ── Auto-sauvegarde ───────────────────────────────────────────────────────

    def auto_save_on_deploy(self, program: list):
        """Appelé automatiquement à chaque déploiement depuis le PC."""
        return self.save(program, label="Auto — déploiement")
