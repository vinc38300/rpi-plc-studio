#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  RPi-PLC Studio — Script d'installation universel v3.4                     ║
# ║  Compatible : Raspberry Pi 3 / 4 / 5                                       ║
# ║              Raspberry Pi OS Bookworm (12), Bullseye (11)                  ║
# ║              32-bit (armhf) et 64-bit (arm64)                              ║
# ║  Licence MIT                                                                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#
# UTILISATION :
#   Méthode 1 — via le .deb (recommandé) :
#     sudo dpkg -i rpi-plc_3.4-1.deb && sudo apt-get install -f
#
#   Méthode 2 — ce script (installation directe depuis les sources) :
#     sudo bash install.sh
#
#   Méthode 3 — depuis internet (si le RPi a accès au réseau) :
#     curl -fsSL https://raw.githubusercontent.com/rpi-plc/install.sh | sudo bash

set -euo pipefail

# ── Couleurs ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*"; }
info() { echo -e "  ${CYAN}ℹ${NC} $*"; }
sep()  { echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"; }

# ── Paramètres configurables ─────────────────────────────────────────────────
APP_DIR="/opt/rpi-plc"
DATA_DIR_DEFAULT="$HOME/rpi-plc-data"   # sera ajusté à l'utilisateur réel
SERVICE_NAME="rpi-plc"
WEB_PORT=5000
VERSION="3.4"

# ── Vérifications préliminaires ───────────────────────────────────────────────
sep
echo -e "${BOLD}  RPi-PLC Studio v${VERSION} — Installation${NC}"
sep

# Doit être root (ou sudo)
if [ "$(id -u)" -ne 0 ]; then
    err "Ce script doit être exécuté avec sudo ou en root."
    echo "  → sudo bash $0"
    exit 1
fi

# Résoudre l'utilisateur réel (celui qui a fait sudo)
REAL_USER="${SUDO_USER:-}"
if [ -z "$REAL_USER" ] || [ "$REAL_USER" = "root" ]; then
    # Chercher le premier utilisateur non-root avec un home dans /home
    REAL_USER=$(ls /home 2>/dev/null | head -1)
    [ -z "$REAL_USER" ] && REAL_USER="pi"
fi
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6 2>/dev/null || echo "/home/$REAL_USER")
DATA_DIR="$REAL_HOME/rpi-plc-data"

echo ""
info "Utilisateur : $REAL_USER ($REAL_HOME)"
info "Dossier app : $APP_DIR"
info "Données     : $DATA_DIR"
info "Port web    : $WEB_PORT"

# ── Détection matérielle ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[1/7] Détection du matériel${NC}"

# Modèle RPi
RPI_MODEL=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "inconnu")
ARCH=$(uname -m)
OS_ID=$(. /etc/os-release 2>/dev/null && echo "$ID" || echo "unknown")
OS_VER=$(. /etc/os-release 2>/dev/null && echo "$VERSION_CODENAME" || echo "unknown")
PY=$(which python3)
PY_VER=$(python3 --version 2>&1 | cut -d' ' -f2)

info "Modèle     : $RPI_MODEL"
info "Arch.      : $ARCH"
info "OS         : $OS_ID $OS_VER"
info "Python     : $PY_VER"

# Vérifier Python >= 3.9
PY_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
PY_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 9 ]; }; then
    err "Python >= 3.9 requis (version actuelle : $PY_VER)"
    info "→ sudo apt install python3.11"
    exit 1
fi
ok "Python $PY_VER compatible"

# Détecter gpiochip
if [ -c /dev/gpiochip0 ]; then
    ok "/dev/gpiochip0 présent"
    NUM_LINES=$(gpioinfo 2>/dev/null | grep -c "line" || echo "?")
    info "Lignes GPIO disponibles : $NUM_LINES"
else
    warn "/dev/gpiochip0 absent (normal en dehors d'un RPi)"
fi

# ── Paquets APT ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/7] Paquets système (apt)${NC}"

# Mettre à jour l'index silencieusement
info "Mise à jour de l'index apt..."
apt-get update -qq 2>/dev/null && ok "Index mis à jour" || warn "apt update échoué (pas réseau ?)"

# Liste des paquets obligatoires
APT_REQUIRED="python3 python3-pip"

# Liste des paquets conditionnels selon la version OS
APT_OPTIONAL=""

# python3-flask : disponible sur Bullseye+, sinon pip
if apt-cache show python3-flask >/dev/null 2>&1; then
    APT_OPTIONAL="$APT_OPTIONAL python3-flask"
fi
if apt-cache show python3-flask-socketio >/dev/null 2>&1; then
    APT_OPTIONAL="$APT_OPTIONAL python3-flask-socketio"
fi

# python3-gpiod : v2 requis — disponible sur Bookworm
GPIOD_OK=false
if python3 -c "import gpiod; assert int(gpiod.__version__.split('.')[0])>=2" 2>/dev/null; then
    ok "python3-gpiod v2 déjà présent"
    GPIOD_OK=true
elif apt-cache show python3-gpiod 2>/dev/null | grep -q "Version: 2\|Version:.*2\."; then
    APT_OPTIONAL="$APT_OPTIONAL python3-gpiod"
else
    warn "python3-gpiod v2 non disponible via apt → installation pip"
fi

# python3-lgpio : fallback GPIO
if ! python3 -c "import lgpio" 2>/dev/null; then
    APT_OPTIONAL="$APT_OPTIONAL python3-lgpio"
fi

# smbus2 pour ADS1115
if apt-cache show python3-smbus2 >/dev/null 2>&1; then
    APT_OPTIONAL="$APT_OPTIONAL python3-smbus2"
fi

# Installer les paquets
ALL_APT="$APT_REQUIRED $APT_OPTIONAL"
info "Installation : $ALL_APT"
# shellcheck disable=SC2086
if apt-get install -y --no-install-recommends $ALL_APT 2>/dev/null; then
    ok "Paquets apt installés"
else
    warn "Certains paquets apt ont échoué — pip compensera"
fi

# ── Dépendances Python pip ────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/7] Dépendances Python (pip)${NC}"

PIP_PACKAGES=""
python3 -c "import flask" 2>/dev/null          || PIP_PACKAGES="$PIP_PACKAGES flask"
python3 -c "import flask_socketio" 2>/dev/null || PIP_PACKAGES="$PIP_PACKAGES flask-socketio"
python3 -c "import requests" 2>/dev/null        || PIP_PACKAGES="$PIP_PACKAGES requests"
python3 -c "import smbus2" 2>/dev/null          || PIP_PACKAGES="$PIP_PACKAGES smbus2"

# gpiod v2 via pip si nécessaire
if [ "$GPIOD_OK" = false ]; then
    if ! python3 -c "import gpiod; assert int(gpiod.__version__.split('.')[0])>=2" 2>/dev/null; then
        PIP_PACKAGES="$PIP_PACKAGES gpiod"
    fi
fi

# lgpio fallback
if ! python3 -c "import lgpio" 2>/dev/null; then
    PIP_PACKAGES="$PIP_PACKAGES lgpio"
fi

if [ -n "$PIP_PACKAGES" ]; then
    info "Installation pip :$PIP_PACKAGES"
    # shellcheck disable=SC2086
    pip3 install $PIP_PACKAGES --break-system-packages --quiet 2>/dev/null || \
    # shellcheck disable=SC2086
    pip3 install $PIP_PACKAGES --quiet 2>/dev/null || \
        warn "pip échoué pour :$PIP_PACKAGES — continuer quand même"
    ok "Pip complété"
else
    ok "Toutes les dépendances Python sont présentes"
fi

# Vérification finale GPIO
if python3 -c "import gpiod; assert int(gpiod.__version__.split('.')[0])>=2" 2>/dev/null; then
    GPIOD_VER=$(python3 -c "import gpiod; print(gpiod.__version__)")
    ok "gpiod v$GPIOD_VER disponible (recommandé)"
elif python3 -c "import lgpio" 2>/dev/null; then
    ok "lgpio disponible (fallback GPIO)"
else
    warn "Aucune bibliothèque GPIO — mode simulation uniquement"
    warn "Sur un vrai RPi : sudo apt install python3-gpiod"
fi

# ── Configuration matérielle ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/7] Configuration matérielle${NC}"

BOOT_CONF=""
for f in /boot/firmware/config.txt /boot/config.txt; do
    [ -f "$f" ] && { BOOT_CONF="$f"; break; }
done

if [ -n "$BOOT_CONF" ]; then
    info "Fichier boot : $BOOT_CONF"

    # I2C — obligatoire pour ADS1115
    if grep -q "^dtparam=i2c_arm=on" "$BOOT_CONF"; then
        ok "I2C déjà activé"
    else
        echo "dtparam=i2c_arm=on" >> "$BOOT_CONF"
        ok "I2C activé dans $BOOT_CONF"
        REBOOT_NEEDED=true
    fi

    # I2C baudrate élevé pour ADS1115 (860 SPS)
    if ! grep -q "dtparam=i2c_arm_baudrate" "$BOOT_CONF"; then
        echo "dtparam=i2c_arm_baudrate=400000" >> "$BOOT_CONF"
        ok "I2C baudrate : 400 kHz (ADS1115 860 SPS)"
    fi

    # SPI — désactiver (conflits GPIO avec relais)
    if grep -q "^dtparam=spi=on" "$BOOT_CONF"; then
        sed -i 's/^dtparam=spi=on/#dtparam=spi=on  # désactivé rpi-plc (I2C only)/' "$BOOT_CONF"
        ok "SPI désactivé (GPIO 7-11 libérés pour relais)"
        REBOOT_NEEDED=true
    else
        ok "SPI non activé (correct)"
    fi

    # RPi 5 spécifique : activer i2c-6 si RPi 5 (RP1)
    if echo "$RPI_MODEL" | grep -q "Raspberry Pi 5"; then
        if ! grep -q "dtparam=i2c6=on" "$BOOT_CONF"; then
            echo "dtparam=i2c6=on" >> "$BOOT_CONF"
            ok "I2C6 activé (RPi 5 — RP1 chip)"
        fi
    fi
else
    warn "config.txt introuvable — activer I2C via raspi-config"
fi

# Charger le module i2c-dev immédiatement
modprobe i2c-dev 2>/dev/null && ok "Module i2c-dev chargé" || true

# Vérifier les bus I2C disponibles
I2C_BUSES=$(ls /dev/i2c-* 2>/dev/null | wc -l)
if [ "$I2C_BUSES" -gt 0 ]; then
    ok "Bus I2C disponibles : $I2C_BUSES"
    # Scanner les adresses ADS1115 attendues
    if which i2cdetect >/dev/null 2>&1; then
        for bus in 1; do
            ADS_FOUND=$(i2cdetect -y $bus 2>/dev/null | grep -E "48|49|4a|4b" | wc -l)
            [ "$ADS_FOUND" -gt 0 ] && ok "ADS1115 détecté sur bus I2C-$bus" || \
                info "Aucun ADS1115 sur I2C-$bus (normal si câbles non connectés)"
        done
    fi
else
    warn "Aucun bus I2C /dev/i2c-* — redémarrage requis après activation"
fi

# ── Groupes utilisateur ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/7] Groupes utilisateur${NC}"

GROUPS_ADDED=false
for grp in gpio spi i2c dialout; do
    if getent group "$grp" >/dev/null 2>&1; then
        if groups "$REAL_USER" 2>/dev/null | grep -qw "$grp"; then
            ok "Groupe $grp : déjà membre"
        else
            if usermod -aG "$grp" "$REAL_USER" 2>/dev/null; then
                ok "Groupe $grp : $REAL_USER ajouté"
                GROUPS_ADDED=true
            else
                warn "Impossible d'ajouter $REAL_USER au groupe $grp"
            fi
        fi
    else
        info "Groupe $grp non trouvé (normal sur certains OS)"
    fi
done

[ "$GROUPS_ADDED" = true ] && info "Les nouveaux groupes prennent effet au prochain login"

# ── Installation fichiers application ─────────────────────────────────────────
echo ""
echo -e "${BOLD}[6/7] Installation de l'application${NC}"

# Déterminer le répertoire source
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Vérifier si on a les sources ou juste le .deb
HAS_SOURCES=false
if [ -f "$SCRIPT_DIR/server.py" ] || [ -f "$SCRIPT_DIR/rpi_server/server.py" ]; then
    HAS_SOURCES=true
fi

if [ "$HAS_SOURCES" = true ]; then
    # Installation depuis les sources
    info "Sources détectées dans $SCRIPT_DIR"
    mkdir -p "$APP_DIR"

    # Chercher les sources (rpi_server/ ou courant)
    if [ -d "$SCRIPT_DIR/rpi_server" ]; then
        SRC="$SCRIPT_DIR/rpi_server"
    else
        SRC="$SCRIPT_DIR"
    fi

    # Copier les fichiers serveur
    for f in server.py auth.py backup_manager.py calibration.py recipes.py \
              report_generator.py telegram_bot.py testeur_plc.html synoptic.json; do
        [ -f "$SRC/$f" ] && cp "$SRC/$f" "$APP_DIR/" && ok "→ $f"
    done

    # Dossiers statiques
    for d in static templates; do
        if [ -d "$SRC/$d" ]; then
            cp -r "$SRC/$d" "$APP_DIR/"
            ok "→ $d/"
        fi
    done

    # synoptic_canvas.js depuis ui/
    for p in "$SCRIPT_DIR/ui/synoptic_canvas.js" "$SCRIPT_DIR/../ui/synoptic_canvas.js"; do
        if [ -f "$p" ]; then
            cp "$p" "$APP_DIR/static/"
            ok "→ static/synoptic_canvas.js"
            break
        fi
    done

else
    # Aucune source trouvée → instructions .deb
    warn "Sources non trouvées dans $SCRIPT_DIR"
    info "→ Installer via le paquet .deb :"
    info "  sudo dpkg -i rpi-plc_3.4-1.deb && sudo apt-get install -f"

    # Vérifier si /opt/rpi-plc existe déjà (installé par .deb)
    if [ -f "$APP_DIR/server.py" ]; then
        ok "Application déjà présente dans $APP_DIR (installée via .deb)"
    else
        err "Impossible de trouver les fichiers de l'application"
        exit 1
    fi
fi

# Créer le répertoire de données utilisateur
mkdir -p "$DATA_DIR/backups"

# Config par défaut
if [ ! -f "$DATA_DIR/config.json" ]; then
    if [ -f "$APP_DIR/config.json" ]; then
        cp "$APP_DIR/config.json" "$DATA_DIR/config.json"
    elif [ -f "/etc/rpi-plc/config.json.default" ]; then
        cp /etc/rpi-plc/config.json.default "$DATA_DIR/config.json"
    else
        # Config minimale embarquée
        cat > "$DATA_DIR/config.json" << 'CFGEOF'
{
    "scan_time_ms": 100,
    "web_port": 5000,
    "web_enabled": true,
    "watchdog_sec": 10,
    "auto_start": true,
    "security": {
        "enabled": false,
        "username": "admin",
        "password": "plc1234"
    },
    "telegram": {
        "enabled": false,
        "token": "",
        "chat_ids": []
    },
    "analog": {
        "enabled": true,
        "sample_rate": 860,
        "r_ref_ohm": 10000.0,
        "vcc": 3.3,
        "probe_type": "NTC10K",
        "ads": [
            {"id": "ADS0", "address": "0x48", "channels": [
                {"id": "ANA0", "name": "Sonde 1", "probe": "NTC10K"},
                {"id": "ANA1", "name": "Sonde 2", "probe": "NTC10K"},
                {"id": "ANA2", "name": "Sonde 3", "probe": "NTC10K"},
                {"id": "ANA3", "name": "Sonde 4", "probe": "NTC10K"}
            ]}
        ]
    },
    "gpio": {}
}
CFGEOF
        ok "config.json par défaut créé"
    fi
fi

# Programme vide si absent
[ ! -f "$DATA_DIR/programme.json" ] && echo "[]" > "$DATA_DIR/programme.json"

# Permissions
chown -R "$REAL_USER:$REAL_USER" "$DATA_DIR" 2>/dev/null || true
chmod 755 "$APP_DIR"
chmod -R 644 "$APP_DIR"/*.py 2>/dev/null || true
chmod -R 644 "$APP_DIR/static/"* 2>/dev/null || true
chmod -R 644 "$APP_DIR/templates/"* 2>/dev/null || true

ok "Données initialisées dans $DATA_DIR"

# Lien de convénience /usr/local/bin/rpi-plc
ln -sf "$APP_DIR/server.py" /usr/local/bin/rpi-plc 2>/dev/null && \
    ok "Lien /usr/local/bin/rpi-plc créé" || true

# ── Service systemd ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[7/7] Service systemd${NC}"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

# Arrêter le service existant
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
pkill -SIGTERM -f "python3.*server.py" 2>/dev/null || true
sleep 1

# Construire le fichier de service
cat > "$SERVICE_FILE" << SVCEOF
[Unit]
Description=RPi-PLC Studio v${VERSION} — Automate programmable
Documentation=https://github.com/rpi-plc
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${DATA_DIR}
ExecStart=${PY} ${APP_DIR}/server.py --data ${DATA_DIR}
Restart=always
RestartSec=10
StartLimitIntervalSec=120
StartLimitBurst=10
TimeoutStopSec=15
KillMode=mixed
# Logs
Environment=PYTHONUNBUFFERED=1
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rpi-plc
# Accès matériel
SupplementaryGroups=gpio spi i2c
# Accès /dev/gpiochip0 sans sudo (gpiod v2)
AmbientCapabilities=CAP_SYS_RAWIO
CapabilityBoundingSet=CAP_SYS_RAWIO
# Sécurité
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
SVCEOF

ok "Fichier de service écrit : $SERVICE_FILE"

# Activer le service réseau (pour Wants=network-online.target)
systemctl enable systemd-networkd-wait-online.service 2>/dev/null || true

# Recharger systemd, activer et démarrer
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
info "Démarrage du service..."
systemctl start "$SERVICE_NAME"
sleep 4

# ── Résultat final ────────────────────────────────────────────────────────────
echo ""
sep
if systemctl is-active --quiet "$SERVICE_NAME"; then
    IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "<IP-RPi>")
    PID=$(systemctl show "$SERVICE_NAME" --property=MainPID --value 2>/dev/null || echo "?")

    echo -e "${GREEN}${BOLD}"
    echo "  ✅  RPi-PLC Studio démarré avec succès !"
    echo -e "${NC}"
    echo -e "  🌐  Interface web     : ${CYAN}http://${IP}:${WEB_PORT}${NC}"
    echo -e "  📱  Version mobile    : ${CYAN}http://${IP}:${WEB_PORT}/synoptic?mobile=1${NC}"
    echo -e "  📋  Logs             : ${BOLD}journalctl -u rpi-plc -f${NC}"
    echo -e "  🔧  Statut           : ${BOLD}systemctl status rpi-plc${NC}"
    echo -e "  📁  Données          : $DATA_DIR"
    echo -e "  🔁  Service          : démarrage automatique au boot activé"
    echo ""

    # Avertissement redémarrage si besoin
    REBOOT_NEEDED="${REBOOT_NEEDED:-false}"
    if [ "$REBOOT_NEEDED" = true ]; then
        echo -e "${YELLOW}  ⚠  Un redémarrage est recommandé pour activer I2C/GPIO${NC}"
        echo -e "  →  sudo reboot"
        echo ""
    fi

    # Vérification GPIO dans les logs
    sleep 2
    GPIO_STATUS=$(journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>/dev/null | \
        grep -E "GPIO|gpiod|lgpio|simulation" | tail -1 || echo "")
    [ -n "$GPIO_STATUS" ] && info "GPIO : $GPIO_STATUS"

else
    echo -e "${RED}${BOLD}  ❌  Le service n'a pas démarré${NC}"
    echo ""
    echo -e "  Dernières lignes du journal :"
    journalctl -u "$SERVICE_NAME" -n 25 --no-pager 2>/dev/null | sed 's/^/    /'
    echo ""
    echo -e "  ${YELLOW}Solutions possibles :${NC}"
    echo -e "  1. Redémarrer le RPi : ${BOLD}sudo reboot${NC}"
    echo -e "  2. Vérifier les dépendances : ${BOLD}python3 -c 'import flask, flask_socketio'${NC}"
    echo -e "  3. Test manuel : ${BOLD}python3 $APP_DIR/server.py${NC}"
    echo -e "  4. Logs complets : ${BOLD}journalctl -u rpi-plc -n 100${NC}"
    exit 1
fi

# ── Commandes utiles ──────────────────────────────────────────────────────────
echo -e "  ${BOLD}Commandes utiles :${NC}"
echo -e "  ┌─────────────────────────────────────────────────────┐"
echo -e "  │  systemctl start|stop|restart|status rpi-plc        │"
echo -e "  │  journalctl -u rpi-plc -f           (logs en direct)│"
echo -e "  │  rpi-plc --help                     (options serveur)│"
echo -e "  │  sudo dpkg -i rpi-plc_X.Y-1.deb    (mise à jour)    │"
echo -e "  └─────────────────────────────────────────────────────┘"
sep
echo ""
