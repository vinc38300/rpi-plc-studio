"""
core/deployer.py — Déploiement SSH vers le Raspberry Pi
Dépendances : paramiko
"""

import os
import json
import time
import threading
from typing import Callable, Optional

try:
    import paramiko
    HAS_PARAMIKO = True
except ImportError:
    HAS_PARAMIKO = False


# Fichiers du serveur RPi à déployer (relatifs au dossier rpi_server/)
SERVER_FILES = [
    "server.py",
    "telegram_bot.py",
    "recipes.py",
    "backup_manager.py",
    "auth.py",
    # config.json envoyé séparément avec fusion RPi (voir ci-dessous)
    "templates/index.html",
    "templates/scada.html",
    "templates/synoptic.html",
    "static/sw.js",
    "static/manifest.json",
    "static/icon-192.png",
    "static/icon-512.png",
    "rpi-plc.service",
    "setup_autonomy.sh",
]

# Dossier source des fichiers serveur (embarqués dans le studio)
SERVER_SRC = os.path.join(os.path.dirname(__file__), "..", "rpi_server")


class DeployResult:
    def __init__(self, success: bool, message: str):
        self.success = success
        self.message = message


class RPiDeployer:
    """Gère la connexion SSH/SFTP et le déploiement vers le RPi."""

    def __init__(self,
                 host: str,
                 port: int = 22,
                 user: str = "pi",
                 password: str = "",
                 key_path: str = "",
                 remote_dir: str = "/home/pi/rpi-plc",
                 log_cb: Optional[Callable[[str], None]] = None):
        self.host       = host
        self.port       = port
        self.user       = user
        self.password   = password
        self.key_path   = key_path
        self.remote_dir = remote_dir
        self.log_cb     = log_cb or print

        self._client: Optional["paramiko.SSHClient"] = None
        self._sftp:   Optional["paramiko.SFTPClient"] = None
        self._monitor_thread: Optional[threading.Thread] = None
        self._monitoring = False

    # ── Connexion ─────────────────────────────────────────────────────────────
    def connect(self) -> DeployResult:
        if not HAS_PARAMIKO:
            return DeployResult(False, "paramiko non installé. Lancer : pip3 install paramiko")
        try:
            self._client = paramiko.SSHClient()
            self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            base = dict(hostname=self.host, port=self.port, username=self.user, timeout=10)

            # Stratégie : essayer clé si fournie, sinon mot de passe
            # Si clé échoue, réessayer avec mot de passe (clé pas encore copiée sur le RPi)
            last_err = None
            attempts = []
            if self.key_path and os.path.isfile(self.key_path):
                attempts.append(("clé SSH", {**base, "key_filename": self.key_path,
                                              "look_for_keys": False, "allow_agent": False}))
            if self.password:
                attempts.append(("mot de passe", {**base, "password": self.password,
                                                   "look_for_keys": False, "allow_agent": False}))
            if not attempts:
                # Dernier recours : clés système
                attempts.append(("clés système", {**base}))

            for method, kwargs in attempts:
                try:
                    self._client = paramiko.SSHClient()
                    self._client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    self._client.connect(**kwargs)
                    self._sftp = self._client.open_sftp()
                    self.log_cb(f"[SSH] Connecté à {self.user}@{self.host}:{self.port} ({method})")
                    # Auto-corriger remote_dir si l'utilisateur a changé
                    # ex: /home/pi/rpi-plc avec user=rpi1 → /home/rpi1/rpi-plc
                    import re as _re
                    m = _re.match(r"^(/home/)([^/]+)(/.+)$", self.remote_dir)
                    if m and m.group(2) != self.user:
                        old_rd = self.remote_dir
                        self.remote_dir = f"{m.group(1)}{self.user}{m.group(3)}"
                        self.log_cb(f"[SSH] Dossier distant ajusté : {old_rd} → {self.remote_dir}")
                    return DeployResult(True, "Connexion établie")
                except Exception as e:
                    last_err = e
                    self.log_cb(f"[SSH] {method} échoué : {e}")
                    continue

            # Tous les essais ont échoué
            hint = ""
            if "Authentication" in str(last_err) or "auth" in str(last_err).lower():
                hint = " → Vérifiez le mot de passe ou utilisez 📋 Copier clé sur RPi"
            return DeployResult(False, f"Connexion échouée : {last_err}{hint}")
        except Exception as e:
            return DeployResult(False, f"Connexion échouée : {e}")

    # ── Diagnostic post-déploiement ──────────────────────────────────────────
    def diagnose(self) -> list:
        """Exécute une série de vérifications et retourne un rapport ligne par ligne."""
        if not self.is_connected():
            r = self.connect()
            if not r.success:
                return [f"❌ Connexion impossible : {r.message}"]

        rd = self.remote_dir
        checks = [
            ("OS / Architecture",  "uname -m && cat /etc/os-release | grep PRETTY_NAME"),
            ("Python version",     "python3 --version 2>&1"),
            ("Espace disque /",    "df -h / | tail -1"),
            ("RAM libre",          "free -h | grep Mem"),
            ("Service systemd",    "systemctl is-active rpi-plc.service 2>/dev/null || echo inactive"),
            ("Processus PLC",      "pgrep -a -f 'python3.*server.py' 2>/dev/null || echo 'non trouvé'"),
            ("Port 5000 ouvert",   "ss -tlnp 2>/dev/null | grep 5000 || echo 'port 5000 non écouté'"),
            ("programme.json",     f"test -f {rd}/programme.json && wc -c {rd}/programme.json || echo 'ABSENT'"),
            ("synoptic.json",      f"test -f {rd}/synoptic.json && wc -c {rd}/synoptic.json || echo 'ABSENT'"),
            ("Paquets Flask",      "pip3 show flask 2>/dev/null | grep -E 'Name|Version' || echo 'flask absent'"),
            ("gpiod v2",            "python3 -c 'import gpiod; print(gpiod.__version__)' 2>/dev/null || echo 'absent'"),
            ("gpiochip0",           "test -c /dev/gpiochip0 && echo 'OK' || echo 'absent'"),
            ("GPIO groupes",        "groups | tr ' ' '\\n' | grep -E 'gpio|spi|i2c' | tr '\\n' ' ' || echo 'non membre'"),
            ("Log PLC (fin)",      "tail -20 /tmp/rpi-plc.log 2>/dev/null || journalctl -u rpi-plc -n 20 --no-pager 2>/dev/null || echo 'pas de log'"),
        ]

        lines = []
        for label, cmd in checks:
            code, out, err = self.run(cmd, timeout=10)
            result = (out + err).strip() or "(vide)"
            icon = "✅" if code == 0 else "⚠"
            lines.append(f"{icon} {label}:")
            for line in result.splitlines()[:5]:   # max 5 lignes par check
                lines.append(f"   {line}")
        return lines

    def disconnect(self):
        self._monitoring = False
        if self._sftp:
            self._sftp.close()
        if self._client:
            self._client.close()
        self._sftp   = None
        self._client = None
        self.log_cb("[SSH] Déconnecté")

    def is_connected(self) -> bool:
        return self._client is not None and self._client.get_transport() is not None \
               and self._client.get_transport().is_active()

    # ── Exécution commande ────────────────────────────────────────────────────
    def run(self, cmd: str, timeout: int = 30) -> tuple[int, str, str]:
        if not self.is_connected():
            return -1, "", "Non connecté"
        _, stdout, stderr = self._client.exec_command(cmd, timeout=timeout)
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, stdout.read().decode(), stderr.read().decode()

    # ── Vérification intelligente avant déploiement ─────────────────────────
    def smart_check(self) -> dict:
        """
        Analyse complète du RPi et retourne un rapport structuré :
        {
          "os": str, "arch": str, "python": str,
          "gpiod_version": str|None,
          "lgpio": bool,
          "flask": bool, "flask_socketio": bool, "smbus2": bool,
          "i2c_enabled": bool,
          "gpiochip0": bool,
          "gpio_group": bool,
          "service_installed": bool,
          "service_active": bool,
          "server_files": bool,      # server.py présent et à jour
          "programme": bool,         # programme.json présent
          "synoptic": bool,          # synoptic.json présent
          "needs": list[str],        # liste de ce qui doit être installé
          "action": str,             # "prog_only"|"full_install"|"update_server"
          "lines": list[str],        # lignes de rapport lisibles
        }
        """
        if not self.is_connected():
            r = self.connect()
            if not r.success:
                return {"error": r.message, "action": "connect_failed", "lines": [f"❌ {r.message}"]}

        rd = self.remote_dir
        result = {"lines": [], "needs": []}

        def run(cmd):
            _, out, err = self.run(cmd, timeout=10)
            return (out + err).strip()

        def log(line):
            result["lines"].append(line)

        log("🔍 Analyse du Raspberry Pi en cours…")
        log("─" * 52)

        # ── OS et architecture ──────────────────────────────────────────────
        arch   = run("uname -m")
        os_str = run("cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'")
        py_ver = run("python3 --version 2>&1")
        result.update({"os": os_str, "arch": arch, "python": py_ver})
        log(f"🖥  OS      : {os_str or '?'}")
        log(f"🔧 Arch    : {arch or '?'}")
        log(f"🐍 Python  : {py_ver or '?'}")

        # ── gpiod v2 ────────────────────────────────────────────────────────
        gpiod_v = run("python3 -c 'import gpiod; print(gpiod.__version__)' 2>/dev/null")
        gpiod_ok = bool(gpiod_v) and int(gpiod_v.split(".")[0]) >= 2 if gpiod_v else False
        result["gpiod_version"] = gpiod_v if gpiod_ok else None
        if gpiod_ok:
            log(f"✅ gpiod   : v{gpiod_v} (GPIO natif Bookworm)")
        else:
            old_v = run("python3 -c 'import gpiod; print(gpiod.__version__)' 2>/dev/null")
            log(f"❌ gpiod v2: absent{(' (v'+old_v+' trop vieux)') if old_v else ''} → à installer")
            result["needs"].append("gpiod_v2")

        # ── lgpio (fallback) ────────────────────────────────────────────────
        lgpio_ok = "ok" in run("python3 -c 'import lgpio' 2>/dev/null && echo ok || echo no")
        result["lgpio"] = lgpio_ok
        log(f"{'✅' if lgpio_ok else 'ℹ️ '} lgpio     : {'présent (fallback)' if lgpio_ok else 'absent (optionnel)'}")

        # ── /dev/gpiochip0 ──────────────────────────────────────────────────
        gpiochip = run("test -c /dev/gpiochip0 && echo ok || echo absent") == "ok"
        result["gpiochip0"] = gpiochip
        log(f"{'✅' if gpiochip else '⚠️ '} gpiochip0 : {'/dev/gpiochip0 disponible' if gpiochip else 'absent (pas de GPIO matériel)'}")

        # ── Groupes utilisateur ─────────────────────────────────────────────
        groups = run("groups")
        gpio_grp = "gpio" in groups
        result["gpio_group"] = gpio_grp
        log(f"{'✅' if gpio_grp else '⚠️ '} Groupe    : {'gpio ✓' if gpio_grp else 'gpio manquant → accès GPIO limité'}")
        if not gpio_grp:
            result["needs"].append("gpio_group")

        # ── I²C ─────────────────────────────────────────────────────────────
        i2c_dev = run("test -e /dev/i2c-1 && echo ok || echo absent") == "ok"
        result["i2c_enabled"] = i2c_dev
        log(f"{'✅' if i2c_dev else '⚠️ '} I²C       : {'/dev/i2c-1 OK' if i2c_dev else 'absent → activer via raspi-config'}")
        if not i2c_dev:
            result["needs"].append("i2c")

        # ── Dépendances Python ──────────────────────────────────────────────
        log("")
        log("📦 Dépendances Python :")
        for pkg, key in [("flask","flask"), ("flask_socketio","flask_socketio"), ("smbus2","smbus2")]:
            ok = "ok" in run(f"python3 -c 'import {pkg}' 2>/dev/null && echo ok || echo no")
            result[key] = ok
            log(f"  {'✅' if ok else '❌'} {pkg}")
            if not ok:
                result["needs"].append(pkg)

        # ── Fichiers serveur ─────────────────────────────────────────────────
        log("")
        log("📁 Fichiers RPi-PLC :")
        srv_present = run(f"test -f {rd}/server.py && echo ok || echo absent") == "ok"
        prog_present = run(f"test -f {rd}/programme.json && echo ok || echo absent") == "ok"
        syn_present  = run(f"test -f {rd}/synoptic.json && echo ok || echo absent") == "ok"
        result.update({"server_files": srv_present, "programme": prog_present, "synoptic": syn_present})
        log(f"  {'✅' if srv_present else '❌'} server.py")
        log(f"  {'✅' if prog_present else '⚠️ '} programme.json{'':>2}{'(présent)' if prog_present else '(absent — sera créé)'}")
        log(f"  {'✅' if syn_present else 'ℹ️ '} synoptic.json{'':>3}{'(présent)' if syn_present else '(absent — sera créé)'}")

        # ── Service systemd ──────────────────────────────────────────────────
        svc_inst   = run("systemctl list-unit-files rpi-plc.service 2>/dev/null | grep -c rpi-plc") != "0"
        svc_active = run("systemctl is-active rpi-plc.service 2>/dev/null") == "active"
        result.update({"service_installed": svc_inst, "service_active": svc_active})
        log("")
        log("⚙️  Service systemd :")
        log(f"  {'✅' if svc_inst else '❌'} Installé  : {'oui' if svc_inst else 'non'}")
        log(f"  {'✅' if svc_active else '⚠️ '} Actif     : {'oui' if svc_active else 'non'}")

        # ── Décision : que faire ? ───────────────────────────────────────────
        log("")
        log("─" * 52)
        needs = result["needs"]

        if not srv_present:
            action = "full_install"
            verdict = "🔴 Installation complète nécessaire (premier déploiement)"
        elif needs:
            action = "full_install"
            verdict = f"🟡 Mise à jour nécessaire : {', '.join(needs)}"
        elif not svc_inst or not svc_active:
            action = "update_server"
            verdict = "🟡 Service à reconfigurer (server.py présent)"
        else:
            action = "prog_only"
            verdict = "🟢 RPi conforme — envoi du programme uniquement"

        result["action"] = action
        log(f"→ {verdict}")
        log(f"→ Action recommandée : {'Installation complète' if action=='full_install' else 'Mise à jour service' if action=='update_server' else 'Programme + synoptique uniquement'}")

        return result

    # ── Déploiement programme seul ────────────────────────────────────────────
    def deploy_prog_only(self, program_json, synoptic=None, extra_config: dict = None) -> "DeployResult":
        """Envoie uniquement programme.json et synoptic.json puis redémarre le service."""
        if not self.is_connected():
            r = self.connect()
            if not r.success:
                return r
        try:
            import io as _io
            rd = self.remote_dir

            # Garantir que le dossier existe
            self.run(f"mkdir -p {rd}/backups")
            try:
                self._sftp.stat(rd)
            except IOError:
                # Dossier absent → créer via SFTP
                parts = rd.lstrip("/").split("/")
                cur = ""
                for p in parts:
                    cur = f"{cur}/{p}"
                    try: self._sftp.stat(cur)
                    except: self._sftp.mkdir(cur)

            # Sauvegarde automatique
            self.log_cb("[BACKUP] Sauvegarde du programme existant…")
            self.run(f"test -f {rd}/programme.json && cp {rd}/programme.json {rd}/backups/auto_$(date +%Y%m%d_%H%M%S).json || true")

            # Mise à jour config.json sur le RPi — même logique que deploy()
            import os as _os, json as _jcfg3, io as _iocfg3
            rd = self.remote_dir

            rpi_cfg3 = {}
            try:
                _, _out3, _ = self.run(f"cat {rd}/config.json 2>/dev/null || echo '{{}}'")
                rpi_cfg3 = _jcfg3.loads(_out3.strip() or "{}")
            except Exception:
                pass

            cfg_local3 = _os.path.normpath(_os.path.join(
                _os.path.dirname(_os.path.abspath(__file__)), '..', 'rpi_server', 'config.json'))
            if _os.path.isfile(cfg_local3):
                try:
                    local3 = _jcfg3.loads(open(cfg_local3).read())
                    for k, v in local3.items():
                        if k != "telegram":
                            rpi_cfg3[k] = v
                except Exception:
                    pass

            if extra_config and "telegram" in extra_config:
                tg3 = extra_config["telegram"]
                tg_base3 = rpi_cfg3.setdefault("telegram", {})
                for sk, sv in tg3.items():
                    if sk == "token":
                        if sv:
                            tg_base3["token"] = sv
                    elif sv != "" and sv is not None:
                        tg_base3[sk] = sv

            _tg3 = rpi_cfg3.get("telegram", {})
            self.log_cb(
                "[CONFIG] telegram: "
                f"enabled={_tg3.get('enabled')} "
                f"token={'OK' if _tg3.get('token') else 'MANQUANT'} "
                f"chat_ids={_tg3.get('chat_ids', [])}"
            )
            _cfg3_bytes = _jcfg3.dumps(rpi_cfg3, indent=2, ensure_ascii=False).encode("utf-8")
            self._sftp.putfo(_iocfg3.BytesIO(_cfg3_bytes), f"{rd}/config.json")


            # Envoyer programme
            prog_json = json.dumps(program_json, indent=2, ensure_ascii=False)
            self._sftp.putfo(_io.BytesIO(prog_json.encode()), f"{rd}/programme.json")
            nb = sum(len(p.get("blocks",[])) for p in program_json["pages"]) if isinstance(program_json,dict) and "pages" in program_json else len(program_json) if isinstance(program_json,list) else 0
            self.log_cb(f"[PROG] Programme envoyé ({nb} blocs)")

            # Envoyer synoptique
            if synoptic:
                syn_json = json.dumps(synoptic, indent=2, ensure_ascii=False)
                self._sftp.putfo(_io.BytesIO(syn_json.encode()), f"{rd}/synoptic.json")
                nw = sum(len(p.get("widgets",[])) for p in synoptic["pages"]) if isinstance(synoptic,dict) and "pages" in synoptic else len(synoptic.get("widgets",[]))
                self.log_cb(f"[PROG] Synoptique envoyé ({nw} widgets)")

            # Redémarrer le service
            self.log_cb("[SVC] Redémarrage du service PLC…")
            self.run("sudo systemctl restart rpi-plc.service 2>/dev/null || pkill -f 'python3.*server.py' 2>/dev/null || true")
            import time; time.sleep(3)

            code, out, _ = self.run("systemctl is-active rpi-plc.service 2>/dev/null || pgrep -f 'python3.*server.py' > /dev/null && echo active || echo inactive")
            active = "active" in out
            if active:
                self.log_cb(f"[OK] Service redémarré — programme chargé")
                self.log_cb(f"[OK] Interface : http://{self.host}:5000")
                return DeployResult(True, f"Programme déployé sur {self.host}")
            else:
                return DeployResult(False, "Service non redémarré — vérifier les logs")
        except Exception as e:
            return DeployResult(False, f"Erreur : {e}")

    # ── Déploiement complet ───────────────────────────────────────────────────
    def deploy(self, program_json: list, synoptic: dict = None, extra_config: dict = None) -> "DeployResult":
        """
        1. Crée le dossier distant
        2. Envoie server.py + templates/
        3. Installe les dépendances pip
        4. Envoie le programme JSON
        5. Envoie le synoptique JSON (si fourni)
        6. (Re)démarre le serveur PLC
        """
        if not self.is_connected():
            r = self.connect()
            if not r.success:
                return r

        def sftp_makedirs(path):
            """Crée récursivement un dossier distant via SFTP (équivalent mkdir -p)."""
            parts = path.replace("\\", "/").split("/")
            current = ""
            for part in parts:
                if not part:
                    current = "/"
                    continue
                current = f"{current}/{part}" if current != "/" else f"/{part}"
                try:
                    self._sftp.stat(current)
                except IOError:
                    try:
                        self._sftp.mkdir(current)
                    except Exception:
                        pass  # peut déjà exister (race condition)

        try:
            self.log_cb("[DEPLOY] Création des dossiers distants…")
            # Créer via SSH ET via SFTP pour garantir l'existence
            self.run(f"mkdir -p {self.remote_dir}/templates {self.remote_dir}/static {self.remote_dir}/backups")
            for sub in ["", "/templates", "/static", "/backups"]:
                sftp_makedirs(f"{self.remote_dir}{sub}")
            self.log_cb(f"[DEPLOY] Dossier : {self.remote_dir}")

            # Tuer le serveur existant AVANT l'envoi des fichiers
            self.log_cb("[SVC] Arrêt du serveur PLC et libération GPIO…")
            # 1. Arrêt propre du service
            self.run("sudo systemctl stop rpi-plc.service 2>/dev/null || true")
            self.run("pkill -SIGTERM -f 'python3.*server.py' 2>/dev/null || true")
            time.sleep(2)
            # 2. Kill forcé
            self.run("pkill -9 -f 'python3.*server.py' 2>/dev/null || true")
            time.sleep(1)
            # 3. Tuer tout process tenant gpiochip0 ou gpiochip1
            self.run(
                "for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do "
                "  ls /proc/$pid/fd 2>/dev/null | xargs -I{} readlink /proc/$pid/fd/{} 2>/dev/null "
                "  | grep -q gpiochip && kill -9 $pid 2>/dev/null || true; "
                "done"
            )
            # 4. Redémarrer lgpiod si présent (démon qui garde les handles lgpio)
            self.run("sudo systemctl restart lgpiod 2>/dev/null || true")
            # 5. Réinitialiser tous les GPIO via gpioset/gpioinfo si disponible
            self.run("sudo gpioset --mode=exit gpiochip0 2>/dev/null || true")
            time.sleep(2)

            # Mise à jour config.json sur le RPi — préserve le token telegram existant
            import json as _jcfg, io as _iocfg
            rd = self.remote_dir

            # 1. Lire l'actuel config.json depuis le RPi
            rpi_cfg = {}
            try:
                _, _rpi_out, _ = self.run(f"cat {rd}/config.json 2>/dev/null || echo '{{}}'")
                rpi_cfg = _jcfg.loads(_rpi_out.strip() or "{}")
            except Exception:
                pass

            # 2. Appliquer les paramètres locaux (GPIO, scan_time, web_port…)
            #    sauf telegram qu'on gère séparément
            cfg_local_path = os.path.join(SERVER_SRC, "config.json")
            if os.path.isfile(cfg_local_path):
                try:
                    local_cfg = _jcfg.loads(open(cfg_local_path).read())
                    for k, v in local_cfg.items():
                        if k != "telegram":
                            rpi_cfg[k] = v
                except Exception:
                    pass

            # 3. Appliquer extra_config telegram — SANS toucher au token s'il est absent
            if extra_config and "telegram" in extra_config:
                tg_new = extra_config["telegram"]
                tg_rpi = rpi_cfg.setdefault("telegram", {})
                for sk, sv in tg_new.items():
                    if sk == "token":
                        if sv:  # seulement si token non vide
                            tg_rpi["token"] = sv
                        # sinon : conserver le token RPi existant
                    elif sv != "" and sv is not None:
                        tg_rpi[sk] = sv

            tg = rpi_cfg.get("telegram", {})
            self.log_cb(
                "[CONFIG] telegram: "
                f"enabled={tg.get('enabled')} "
                f"token={'OK' if tg.get('token') else 'MANQUANT'} "
                f"chat_ids={tg.get('chat_ids', [])}"
            )

            # 4. Envoyer config.json final
            _cfg_bytes = _jcfg.dumps(rpi_cfg, indent=2, ensure_ascii=False).encode("utf-8")
            self._sftp.putfo(_iocfg.BytesIO(_cfg_bytes), f"{rd}/config.json")

            # Envoyer les fichiers serveur
            for rel_path in SERVER_FILES:
                local  = os.path.join(SERVER_SRC, rel_path)
                remote = f"{self.remote_dir}/{rel_path}"
                if not os.path.isfile(local):
                    self.log_cb(f"[WARN] Fichier source manquant : {local}")
                    continue
                # Assurer le dossier distant via SFTP (pas seulement SSH)
                remote_folder = "/".join(remote.split("/")[:-1])
                self.run(f"mkdir -p {remote_folder}")
                sftp_makedirs(remote_folder)
                self.log_cb(f"[SFTP] → {remote}")
                self._sftp.put(local, remote)

            # Auto-sauvegarde du programme existant avant écrasement
            self.log_cb("[BACKUP] Sauvegarde automatique du programme existant…")
            self.run(
                f"test -f {self.remote_dir}/programme.json "
                f"&& cp {self.remote_dir}/programme.json "
                f"{self.remote_dir}/backups/auto_$(date +%Y%m%d_%H%M%S).json "
                f"|| true"
            )

            # Si le projet a une config GPIO, mettre à jour config.json avant envoi
            # (déjà fait via _on_gpio_config_changed, mais on vérifie)
            self.log_cb("[CONFIG] Vérification config.json GPIO…")

            self.log_cb("[PIP] Installation des dépendances…")
            code, out, err = self.run(
                "pip3 install flask flask-socketio smbus2 requests "
                "--quiet --break-system-packages 2>&1",
                timeout=180
            )
            if code != 0 and code != -1:
                self.log_cb(f"[PIP] {err.strip() or out.strip()}")

            # Envoyer le programme JSON via SFTP (robuste, pas de limite taille)
            import io as _io
            prog_json = json.dumps(program_json, indent=2, ensure_ascii=False)
            prog_remote = f"{self.remote_dir}/programme.json"
            if isinstance(program_json, dict) and "pages" in program_json:
                nb = sum(len(p.get("blocks", [])) for p in program_json["pages"])
                self.log_cb(f"[PROG] Envoi du programme ({nb} blocs, {len(program_json['pages'])} page(s))…")
            else:
                nb = len(program_json) if isinstance(program_json, list) else 0
                self.log_cb(f"[PROG] Envoi du programme ({nb} blocs)…")
            self._sftp.putfo(_io.BytesIO(prog_json.encode("utf-8")), prog_remote)

            # ── Envoyer le synoptique JSON ────────────────────────────────────
            if synoptic:
                syn_json = json.dumps(synoptic, indent=2, ensure_ascii=False)
                syn_remote = f"{self.remote_dir}/synoptic.json"
                if isinstance(synoptic, dict) and "pages" in synoptic:
                    nw = sum(len(p.get("widgets", [])) for p in synoptic["pages"])
                    np2 = len(synoptic["pages"])
                    self.log_cb(f"[PROG] Envoi du synoptique ({np2} page(s), {nw} widget(s))…")
                else:
                    nw = len(synoptic.get("widgets", []))
                    self.log_cb(f"[PROG] Envoi du synoptique ({nw} widget(s))…")
                self._sftp.putfo(_io.BytesIO(syn_json.encode("utf-8")), syn_remote)
            else:
                empty_syn = json.dumps({
                    "pages": [{"id": "P1", "name": "Vue principale",
                               "widgets": [], "background": None, "grid": 20}],
                    "curPage": 0, "images": []
                })
                self._sftp.putfo(_io.BytesIO(empty_syn.encode()), f"{self.remote_dir}/synoptic.json")

            # ── Autonomie : installer le service systemd ──────────────────────
            self.log_cb("[SVC] Configuration de l'autonomie (systemd)…")
            self.run(f"chmod +x {self.remote_dir}/setup_autonomy.sh")
            setup_code, setup_out, setup_err = self.run(
                f"bash {self.remote_dir}/setup_autonomy.sh 2>&1", timeout=180
            )
            for line in (setup_out + setup_err).splitlines():
                if line.strip():
                    self.log_cb(f"  {line}")

            time.sleep(3)

            # Vérifier via systemd d'abord, puis pgrep
            code, out, _ = self.run("systemctl is-active rpi-plc.service 2>/dev/null || echo inactive")
            service_active = out.strip() == "active"

            if service_active:
                _, pid_out, _ = self.run("systemctl show rpi-plc --property=MainPID --value")
                self.log_cb(f"[OK] Service systemd actif (PID {pid_out.strip()})")
                self.log_cb(f"[OK] Démarrage automatique au boot activé")
                self.log_cb(f"[OK] Interface web : http://{self.host}:5000")
                return DeployResult(True, f"Déployé et autonome sur {self.host}")
            else:
                # Fallback : démarrer manuellement
                self.log_cb("[WARN] Service systemd non disponible — démarrage manuel…")
                # Kill forcé + libération GPIO
                self.run("pkill -SIGTERM -f 'python3.*server.py' 2>/dev/null || true")
                time.sleep(2)
                self.run("pkill -9 -f 'python3.*server.py' 2>/dev/null || true")
                self.run(
                    "for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do "
                    "  ls /proc/$pid/fd 2>/dev/null | xargs -I{} readlink /proc/$pid/fd/{} 2>/dev/null "
                    "  | grep -q gpiochip && kill -9 $pid 2>/dev/null || true; "
                    "done"
                )
                self.run("sudo systemctl restart lgpiod 2>/dev/null || true")
                time.sleep(3)
                self.run(
                    f"cd {self.remote_dir} && "
                    f"nohup python3 server.py > /tmp/rpi-plc.log 2>&1 &"
                )
                # Attendre jusqu'à 10s que le processus soit stable
                code2, out2 = -1, ""
                for _attempt in range(5):
                    time.sleep(2)
                    code2, out2, _ = self.run("pgrep -f 'python3.*server.py'")
                    if code2 == 0 and out2.strip():
                        break
                if code2 == 0 and out2.strip():
                    self.log_cb(f"[OK] Serveur démarré (PID {out2.strip()})")
                    return DeployResult(True, f"Déployé sur {self.host} (sans systemd)")
                else:
                    _, log_tail, _ = self.run(
                        "tail -30 /tmp/rpi-plc.log 2>/dev/null || "
                        "journalctl -u rpi-plc -n 30 --no-pager 2>/dev/null"
                    )
                    self.log_cb("[LOG] Dernières lignes du journal :")
                    for line in log_tail.splitlines():
                        if line.strip():
                            self.log_cb(f"  {line}")
                    return DeployResult(False, "Échec du démarrage — voir journal ci-dessus")

        except Exception as e:
            return DeployResult(False, f"Erreur de déploiement : {e}")

    # ── Arrêt distant ─────────────────────────────────────────────────────────
    def stop_remote(self):
        if not self.is_connected():
            self.connect()
        self.run("pkill -f 'python3.*server.py' 2>/dev/null || true")
        self.log_cb("[SVC] Serveur PLC distant arrêté")

    # ── Monitoring en temps réel (tail -f sur le log) ────────────────────────
    def start_monitoring(self, log_cb: Callable[[str], None]):
        if self._monitoring:
            return
        self._monitoring = True
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop, args=(log_cb,), daemon=True
        )
        self._monitor_thread.start()

    def stop_monitoring(self):
        self._monitoring = False

    def _monitor_loop(self, log_cb: Callable[[str], None]):
        try:
            transport = self._client.get_transport()
            channel   = transport.open_session()
            channel.exec_command("tail -f /tmp/rpi-plc.log")
            channel.settimeout(1.0)
            while self._monitoring:
                try:
                    data = channel.recv(1024)
                    if not data:
                        break
                    log_cb(data.decode("utf-8", errors="replace"))
                except Exception:
                    pass
            channel.close()
        except Exception as e:
            log_cb(f"[MONITOR] Erreur : {e}")

    # ── Vérification de la connectivité RPi ───────────────────────────────────
    def ping(self) -> bool:
        """Test rapide de la connexion SSH."""
        if not self.is_connected():
            r = self.connect()
            return r.success
        code, _, _ = self.run("echo ok")
        return code == 0

    # ── Test de la clé SSH ────────────────────────────────────────────────────
    @staticmethod
    def generate_ssh_key(key_path: str) -> str:
        """Génère une paire de clés SSH si elle n'existe pas."""
        if not os.path.isfile(key_path):
            os.makedirs(os.path.dirname(key_path), exist_ok=True)
            os.system(f'ssh-keygen -t ed25519 -f "{key_path}" -N "" -q')
        pub = key_path + ".pub"
        if os.path.isfile(pub):
            return open(pub).read().strip()
        return ""

    def copy_ssh_key(self, pub_key: str) -> DeployResult:
        """Installe la clé publique sur le RPi (authorized_keys)."""
        if not self.is_connected():
            r = self.connect()
            if not r.success:
                return r
        cmd = (
            "mkdir -p ~/.ssh && chmod 700 ~/.ssh && "
            f"echo '{pub_key}' >> ~/.ssh/authorized_keys && "
            "chmod 600 ~/.ssh/authorized_keys"
        )
        code, _, err = self.run(cmd)
        if code == 0:
            return DeployResult(True, "Clé SSH installée")
        return DeployResult(False, f"Erreur : {err}")
