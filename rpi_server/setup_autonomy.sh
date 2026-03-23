#!/bin/bash
# setup_autonomy.sh — Installation complète RPi-PLC Studio sur Raspberry Pi OS 64-bit (Bookworm+)
# Compatible : Raspberry Pi OS Bookworm (12), Bullseye (11), 32-bit et 64-bit
# GPIO : python3-gpiod (gpiod v2, API moderne) — recommandé sur Bookworm 64-bit
# Licence MIT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="rpi-plc"
PY=$(which python3)
CURRENT_USER=$(whoami)

echo "══════════════════════════════════════════════════════════"
echo "  RPi-PLC Studio — Installation automatique"
echo "  Dossier : $SCRIPT_DIR"
echo "  Utilisateur : $CURRENT_USER"
echo "  Python : $PY ($(python3 --version 2>&1))"
echo "  OS : $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"')"
echo "  Architecture : $(uname -m)"
echo "══════════════════════════════════════════════════════════"

# ── Fonction utilitaire sudo ──────────────────────────────────────────────────
do_sudo() {
    if [ "$(id -u)" -eq 0 ]; then
        "$@"
    elif sudo -n true 2>/dev/null; then
        sudo "$@"
    else
        echo "[WARN] Pas de sudo disponible pour : $*"
        return 1
    fi
}

# ── 1. Groupes utilisateur (gpio, spi, i2c) ──────────────────────────────────
echo ""
echo "[GROUPES] Vérification des groupes système…"
GROUPS_NEEDED="gpio spi i2c"
GROUPS_ADDED=0
for grp in $GROUPS_NEEDED; do
    if getent group "$grp" > /dev/null 2>&1; then
        if groups "$CURRENT_USER" | grep -qw "$grp"; then
            echo "  ✓ Groupe $grp : déjà membre"
        else
            do_sudo usermod -aG "$grp" "$CURRENT_USER" 2>/dev/null \
                && { echo "  ✓ Groupe $grp : ajouté (effectif au prochain login)"; GROUPS_ADDED=1; } \
                || echo "  ⚠ Groupe $grp : impossible d'ajouter"
        fi
    else
        echo "  ℹ Groupe $grp : n'existe pas sur ce système"
    fi
done
[ "$GROUPS_ADDED" -eq 1 ] && echo "  ℹ Redémarrage conseillé pour que les groupes prennent effet"

# ── 2. Paquets système ────────────────────────────────────────────────────────
echo ""
echo "[APT] Vérification des paquets système…"
APT_PKGS=""

# python3-gpiod — bibliothèque GPIO officielle Bookworm 64-bit
if ! python3 -c "import gpiod; v=gpiod.__version__; assert int(v.split('.')[0])>=2" 2>/dev/null; then
    echo "  ℹ gpiod v2 absent ou trop vieux — installation via apt…"
    do_sudo apt-get install -y python3-gpiod 2>/dev/null \
        && echo "  ✓ python3-gpiod installé" \
        || { echo "  ⚠ apt échoué — tentative pip…"
             pip3 install gpiod --break-system-packages --quiet 2>/dev/null \
                 && echo "  ✓ gpiod installé via pip" \
                 || echo "  ✗ gpiod introuvable — GPIO en simulation"; }
else
    GPIOD_VER=$(python3 -c "import gpiod; print(gpiod.__version__)" 2>/dev/null)
    echo "  ✓ python3-gpiod v$GPIOD_VER déjà présent"
fi

# python3-lgpio — fallback si gpiod v2 indisponible
if ! python3 -c "import lgpio" 2>/dev/null; then
    do_sudo apt-get install -y python3-lgpio 2>/dev/null \
        && echo "  ✓ python3-lgpio installé (fallback)" \
        || { pip3 install lgpio --break-system-packages --quiet 2>/dev/null \
                 && echo "  ✓ lgpio via pip" \
                 || echo "  ℹ lgpio absent (normal si gpiod fonctionne)"; }
else
    echo "  ✓ python3-lgpio présent (fallback)"
fi

# smbus2 — I²C pour ADS1115
if ! python3 -c "import smbus2" 2>/dev/null; then
    do_sudo apt-get install -y python3-smbus2 2>/dev/null \
        || pip3 install smbus2 --break-system-packages --quiet 2>/dev/null \
        && echo "  ✓ smbus2 installé" \
        || echo "  ⚠ smbus2 absent — sondes PT100 désactivées"
else
    echo "  ✓ smbus2 présent"
fi

# ── 3. Dépendances Python (pip) ───────────────────────────────────────────────
echo ""
echo "[PIP] Installation des dépendances Python…"
pip3 install flask flask-socketio requests \
     --quiet --break-system-packages 2>&1 | grep -v "^$\|already sat\|WARNING.*pip" | head -10
echo "  ✓ Flask + SocketIO installés"

# ── 4. Interfaces matérielles (config.txt) ───────────────────────────────────
echo ""
echo "[HW] Configuration des interfaces matérielles…"

# Trouver config.txt (Bookworm = /boot/firmware, Bullseye = /boot)
BOOT_CONF=""
for f in /boot/firmware/config.txt /boot/config.txt; do
    [ -f "$f" ] && { BOOT_CONF="$f"; break; }
done

if [ -n "$BOOT_CONF" ]; then
    echo "  Config : $BOOT_CONF"
    
    # I²C (ADS1115 sondes PT100)
    if grep -q "^dtparam=i2c_arm=on" "$BOOT_CONF"; then
        echo "  ✓ I²C déjà activé"
    else
        do_sudo bash -c "echo 'dtparam=i2c_arm=on' >> $BOOT_CONF" \
            && echo "  ✓ I²C activé (redémarrage requis)" \
            || echo "  ⚠ I²C : activer via raspi-config → Interface Options → I2C"
    fi
    
    # SPI — NE PAS ACTIVER : ADS1115 utilise I²C (pas SPI)
    # SPI activé = GPIO 7,8,9,10,11 réservés → conflits avec les relais !
    # Désactiver SPI si présent par erreur
    if grep -q "^dtparam=spi=on" "$BOOT_CONF"; then
        do_sudo sed -i 's/^dtparam=spi=on/#dtparam=spi=on  # désactivé RPi-PLC (I2C only)/' "$BOOT_CONF" \
            && echo "  ✓ SPI désactivé (GPIO 7,8,9,10,11 libérés) — redémarrage requis" \
            || echo "  ⚠ SPI toujours actif — vérifier config.txt manuellement"
    else
        echo "  ✓ SPI non activé (correct — ADS1115 utilise I²C)"
    fi

    # Vérifier que les GPIO ne sont pas en mode device tree overlay conflictuel
    if grep -q "^dtoverlay=gpio-no-irq" "$BOOT_CONF" 2>/dev/null; then
        echo "  ℹ gpio-no-irq overlay détecté"
    fi
else
    echo "  ⚠ config.txt introuvable — activer I²C/SPI via raspi-config manuellement"
fi

# Charger modules en temps réel
modprobe i2c-dev  2>/dev/null || true
# modprobe spi-bcm2835 : non chargé (ADS1115 = I²C uniquement)

# ── GPIO 18 : désactiver l'audio si utilisé comme sortie TOR ─────────────────
# GPIO 18 = PCM_CLK (audio) → conflit si dtparam=audio=on
# Vérifier si GPIO 18 est déclaré comme sortie dans config.json
if python3 -c "
import json,sys,os
cfg_path = os.path.join('$SCRIPT_DIR', 'config.json')
try:
    cfg = json.load(open(cfg_path))
    gpio18 = cfg.get('gpio',{}).get('18',{})
    sys.exit(0 if gpio18.get('mode')=='output' else 1)
except: sys.exit(1)
" 2>/dev/null; then
    echo "[GPIO18] GPIO 18 utilisé comme sortie — vérification audio..."
    if [ -n "$BOOT_CONF" ] && grep -q "^dtparam=audio=on" "$BOOT_CONF" 2>/dev/null; then
        do_sudo sed -i 's/^dtparam=audio=on/dtparam=audio=off/' "$BOOT_CONF"             && echo "  ✓ Audio désactivé (GPIO 18 libéré) — redémarrage requis"             || echo "  ⚠ Impossible de désactiver l'audio — GPIO 18 peut ne pas répondre"
    else
        # S'assurer que audio=off est bien présent
        if [ -n "$BOOT_CONF" ] && ! grep -q "dtparam=audio" "$BOOT_CONF" 2>/dev/null; then
            do_sudo bash -c "echo 'dtparam=audio=off' >> $BOOT_CONF"                 && echo "  ✓ dtparam=audio=off ajouté"                 || true
        else
            echo "  ✓ Audio déjà désactivé ou GPIO 18 libre"
        fi
    fi
fi

# Vérifier /dev/gpiochip0
if [ -c /dev/gpiochip0 ]; then
    echo "  ✓ /dev/gpiochip0 disponible"
    # Assurer permissions groupe gpio
    do_sudo chmod g+rw /dev/gpiochip0 2>/dev/null || true
    do_sudo chgrp gpio /dev/gpiochip0 2>/dev/null || true
else
    echo "  ⚠ /dev/gpiochip0 absent — GPIO non disponibles"
fi

# ── 5. Dossiers et permissions ────────────────────────────────────────────────
echo ""
echo "[DIR] Création des dossiers…"
mkdir -p "$SCRIPT_DIR/backups" "$SCRIPT_DIR/static" "$SCRIPT_DIR/templates"
chmod 755 "$SCRIPT_DIR"
chmod +x "$SCRIPT_DIR/server.py" 2>/dev/null || true
echo "  ✓ Dossiers créés"

# ── 6. Service systemd ────────────────────────────────────────────────────────
echo ""
echo "[SVC] Configuration du service systemd…"
SERVICE_FILE="/tmp/rpi-plc-temp.service"

cat > "$SERVICE_FILE" << SVCEOF
[Unit]
Description=RPi-PLC Studio — Automate programmable (gpiod/Bookworm)
Documentation=https://github.com/rpi-plc
After=network.target
Wants=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$PY $SCRIPT_DIR/server.py
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=10
TimeoutStopSec=10
KillMode=mixed

# Sortie non-bufferisée pour journalctl
Environment=PYTHONUNBUFFERED=1
StandardOutput=journal
StandardError=journal
SyslogIdentifier=rpi-plc

# Accès matériel : GPIO (gpiochip0), I²C, SPI
SupplementaryGroups=gpio spi i2c
# Capacités pour accès direct /dev/gpiochip0 sans sudo
AmbientCapabilities=CAP_SYS_RAWIO
CapabilityBoundingSet=CAP_SYS_RAWIO

[Install]
WantedBy=multi-user.target
SVCEOF

# Tuer le serveur existant proprement
echo "[SVC] Arrêt du serveur existant et libération GPIO…"
do_sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
pkill -SIGTERM -f "python3.*server.py" 2>/dev/null || true
sleep 1
pkill -9 -f "python3.*server.py" 2>/dev/null || true
sleep 1

# Libérer /dev/gpiochip0 si occupé
for pid in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
    ls /proc/$pid/fd 2>/dev/null | xargs -I{} readlink /proc/$pid/fd/{} 2>/dev/null \
        | grep -q gpiochip && kill -9 $pid 2>/dev/null || true
done
sleep 1

if do_sudo true 2>/dev/null; then
    echo "[SVC] Installation du service systemd…"
    do_sudo cp "$SERVICE_FILE" "/etc/systemd/system/$SERVICE_NAME.service"
    do_sudo systemctl daemon-reload
    do_sudo systemctl enable "$SERVICE_NAME"
    do_sudo systemctl start "$SERVICE_NAME"
    sleep 4

    echo ""
    echo "══════════════════════════════════════════════════════════"
    if do_sudo systemctl is-active --quiet "$SERVICE_NAME"; then
        IP=$(hostname -I | awk '{print $1}')
        PID=$(systemctl show "$SERVICE_NAME" --property=MainPID --value 2>/dev/null)
        echo "  ✅ RPi-PLC démarré avec succès (systemd, PID $PID)"
        echo "  🌐 Interface web : http://$IP:5000"
        echo "  🔧 Logs : journalctl -u rpi-plc -f"
        echo "  🔧 Statut : systemctl status rpi-plc"
        
        # Vérifier que les GPIO sont bien initialisés
        sleep 2
        GPIO_OK=$(journalctl -u "$SERVICE_NAME" -n 30 --no-pager 2>/dev/null | grep -c "GPIO initialisés" || echo "0")
        if [ "$GPIO_OK" -gt 0 ]; then
            echo "  ✅ GPIO initialisés via gpiod"
        else
            echo "  ℹ GPIO : vérifier avec 'journalctl -u rpi-plc -n 50'"
        fi
    else
        echo "  ❌ Service non démarré — dernières lignes du log :"
        journalctl -u "$SERVICE_NAME" -n 20 --no-pager 2>/dev/null
        echo ""
        echo "  → Fallback : démarrage direct…"
        nohup $PY "$SCRIPT_DIR/server.py" > /tmp/rpi-plc.log 2>&1 &
        sleep 4
        IP=$(hostname -I | awk '{print $1}')
        pgrep -f "python3.*server.py" > /dev/null \
            && echo "  ✅ Serveur démarré (PID $(pgrep -f 'python3.*server.py'))" \
            || { echo "  ❌ Échec — log:"; tail -20 /tmp/rpi-plc.log 2>/dev/null; }
    fi
else
    echo "[SVC] Pas de sudo — démarrage direct…"
    nohup $PY "$SCRIPT_DIR/server.py" > /tmp/rpi-plc.log 2>&1 &
    sleep 4
    IP=$(hostname -I | awk '{print $1}')
    if pgrep -f "python3.*server.py" > /dev/null; then
        echo "  ✅ Serveur démarré (PID $(pgrep -f 'python3.*server.py'))"
        echo "  🌐 Interface web : http://$IP:5000"
    else
        echo "  ❌ Échec — voir /tmp/rpi-plc.log"
        tail -10 /tmp/rpi-plc.log 2>/dev/null
    fi
fi
echo "══════════════════════════════════════════════════════════"
