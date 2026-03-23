#!/bin/bash
# ══════════════════════════════════════════════════════════════════════
#  RPi-PLC Studio — Script d'installation pour Kubuntu / Ubuntu
#  Lancer avec : bash install.sh
# ══════════════════════════════════════════════════════════════════════

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="RPi-PLC Studio"

echo ""
echo "════════════════════════════════════════════"
echo "  $APP_NAME — Installation"
echo "════════════════════════════════════════════"
echo ""

# ── Dépendances système ──────────────────────────────────────────────
echo "[1/4] Installation des paquets système…"
sudo apt-get update -qq
sudo apt-get install -y \
    python3 \
    python3-pip \
    python3-pyqt5 \
    python3-pyqt5.qtsvg \
    python3-pyqt5.qtwebengine \
    python3-pyqt5.qtwebchannel \
    libxcb-xinerama0 \
    libxcb-cursor0 \
    openssh-client \
    2>/dev/null

# ── Dépendances Python ───────────────────────────────────────────────
echo "[2/4] Installation des dépendances Python…"
pip3 install --user --quiet paramiko 2>/dev/null || \
pip3 install --break-system-packages --quiet paramiko

# ── Raccourci bureau ─────────────────────────────────────────────────
echo "[3/4] Création du raccourci bureau…"
DESKTOP_FILE="$HOME/.local/share/applications/rpi-plc-studio.desktop"
mkdir -p "$HOME/.local/share/applications"

cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=RPi-PLC Studio
Comment=Environnement de développement pour automate Raspberry Pi
Exec=python3 $SCRIPT_DIR/main.py
Icon=python3
Terminal=false
Categories=Development;Electronics;
Keywords=PLC;Raspberry Pi;GPIO;Automate;
EOF

chmod +x "$DESKTOP_FILE"

# Aussi sur le bureau si KDE
if [ -d "$HOME/Desktop" ]; then
    cp "$DESKTOP_FILE" "$HOME/Desktop/"
    chmod +x "$HOME/Desktop/rpi-plc-studio.desktop"
fi

# ── Dossier projets ──────────────────────────────────────────────────
echo "[4/4] Création du dossier de projets…"
mkdir -p "$HOME/.rpi-plc-studio/projects"

echo ""
echo "════════════════════════════════════════════"
echo "  Installation terminée !"
echo ""
echo "  Lancement : python3 $SCRIPT_DIR/main.py"
echo "  Ou double-clic sur l'icône du bureau"
echo "════════════════════════════════════════════"
echo ""
