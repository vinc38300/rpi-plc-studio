#!/bin/bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║  RPi-PLC Studio v3.4 — Script d'installation PC Linux                      ║
# ║  Compatible : Ubuntu 22.04+, Debian 12 (Bookworm)+, Linux Mint 21+         ║
# ║              Architecture x86_64 (amd64)                                   ║
# ║  Licence MIT                                                                ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#
# UTILISATION :
#   Méthode 1 — via le .deb (recommandé, résout les dépendances automatiquement) :
#     sudo apt install ./rpi-plc-studio_3.4-1.deb
#
#   Méthode 2 — ce script (installation directe depuis les sources) :
#     sudo bash install-studio.sh
#
#   Désinstallation :
#     sudo apt remove rpi-plc-studio
#     sudo dpkg -r rpi-plc-studio

set -euo pipefail

# ── Couleurs ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*"; }
info() { echo -e "  ${CYAN}ℹ${NC} $*"; }
sep()  { echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"; }

# ── Paramètres ────────────────────────────────────────────────────────────────
APP_DIR="/opt/rpi-plc-studio"
VERSION="3.4"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sep
echo -e "${BOLD}  RPi-PLC Studio v${VERSION} — Installation PC Linux${NC}"
sep

# ── Vérifications préliminaires ───────────────────────────────────────────────
if [ "$(id -u)" -ne 0 ]; then
    err "Ce script doit être exécuté avec sudo."
    echo "  → sudo bash $0"
    exit 1
fi

# Résoudre l'utilisateur réel
REAL_USER="${SUDO_USER:-}"
[ -z "$REAL_USER" ] && REAL_USER=$(logname 2>/dev/null || echo "")
[ -z "$REAL_USER" ] && REAL_USER=$(ls /home 2>/dev/null | head -1)
[ -z "$REAL_USER" ] && REAL_USER="$USER"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6 2>/dev/null || echo "/home/$REAL_USER")

# Architecture
ARCH=$(uname -m)
if [ "$ARCH" != "x86_64" ]; then
    warn "Architecture détectée : $ARCH"
    warn "RPi-PLC Studio est conçu pour x86_64 (PC Linux)."
    warn "Sur Raspberry Pi, utiliser le paquet rpi-plc (serveur)."
    read -rp "  Continuer quand même ? [o/N] " ans
    [[ "$ans" =~ ^[oOyY] ]] || exit 1
fi

# OS
OS_ID=$(. /etc/os-release 2>/dev/null && echo "$ID" || echo "unknown")
OS_VER=$(. /etc/os-release 2>/dev/null && echo "$VERSION_ID" || echo "?")
OS_NAME=$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo "Linux")

echo ""
info "Système    : $OS_NAME"
info "Arch.      : $ARCH"
info "Utilisateur : $REAL_USER ($REAL_HOME)"

# Python
PY=$(which python3 2>/dev/null || echo "")
if [ -z "$PY" ]; then
    err "python3 introuvable. Installer avec : sudo apt install python3"
    exit 1
fi
PY_VER=$("$PY" --version 2>&1 | cut -d' ' -f2)
PY_MINOR=$("$PY" -c "import sys; print(sys.version_info.minor)")
PY_MAJOR=$("$PY" -c "import sys; print(sys.version_info.major)")
if [ "$PY_MAJOR" -lt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -lt 9 ]; }; then
    err "Python >= 3.9 requis (version : $PY_VER)"
    info "→ sudo apt install python3.11"
    exit 1
fi
ok "Python $PY_VER"

# ── Vérifier si .deb disponible ───────────────────────────────────────────────
DEB_FILE=""
for p in "$SCRIPT_DIR/rpi-plc-studio_${VERSION}-1.deb" \
          "$SCRIPT_DIR/rpi-plc-studio_"*.deb \
          "./rpi-plc-studio_"*.deb; do
    # shellcheck disable=SC2086
    FOUND=$(ls $p 2>/dev/null | head -1)
    if [ -n "$FOUND" ] && [ -f "$FOUND" ]; then
        DEB_FILE="$FOUND"
        break
    fi
done

if [ -n "$DEB_FILE" ]; then
    echo ""
    echo -e "${BOLD}[Méthode .deb détectée]${NC} $DEB_FILE"
    info "Installation via apt (résolution automatique des dépendances)..."

    # apt install gère tout
    if apt install -y "$DEB_FILE" 2>/dev/null; then
        ok "Installation .deb réussie"
        _show_success
        exit 0
    else
        warn "apt install a échoué — passage en mode manuel"
    fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# INSTALLATION MANUELLE (depuis les sources)
# ══════════════════════════════════════════════════════════════════════════════

echo ""
echo -e "${BOLD}[1/5] Paquets système (apt)${NC}"

apt-get update -qq 2>/dev/null && ok "Index mis à jour" || warn "apt update échoué"

# Paquets obligatoires
APT_PKGS="python3 python3-pip"

# PyQt5
if apt-cache show python3-pyqt5 >/dev/null 2>&1; then
    APT_PKGS="$APT_PKGS python3-pyqt5"
fi

# PyQtWebEngine — nom varie selon distrib
for pkg in python3-pyqt5.qtwebengine python3-pyqt5-webengine; do
    if apt-cache show "$pkg" >/dev/null 2>&1; then
        APT_PKGS="$APT_PKGS $pkg"; break
    fi
done

# paramiko pour SSH/SFTP
if apt-cache show python3-paramiko >/dev/null 2>&1; then
    APT_PKGS="$APT_PKGS python3-paramiko"
fi

# requests
if apt-cache show python3-requests >/dev/null 2>&1; then
    APT_PKGS="$APT_PKGS python3-requests"
fi

# openssh-client (pour génération clé ED25519)
APT_PKGS="$APT_PKGS openssh-client"

info "Installation : $APT_PKGS"
# shellcheck disable=SC2086
apt-get install -y --no-install-recommends $APT_PKGS 2>/dev/null && \
    ok "Paquets apt installés" || warn "Certains paquets apt ont échoué — pip compensera"

# ── Dépendances pip manquantes ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/5] Dépendances Python (pip)${NC}"

PIP_PKGS=""

# PyQt5
if ! "$PY" -c "from PyQt5.QtWidgets import QApplication" 2>/dev/null; then
    PIP_PKGS="$PIP_PKGS PyQt5"
fi

# PyQtWebEngine
if ! "$PY" -c "from PyQt5.QtWebEngineWidgets import QWebEngineView" 2>/dev/null; then
    PIP_PKGS="$PIP_PKGS PyQtWebEngine"
fi

# paramiko
if ! "$PY" -c "import paramiko" 2>/dev/null; then
    PIP_PKGS="$PIP_PKGS paramiko"
fi

# requests
if ! "$PY" -c "import requests" 2>/dev/null; then
    PIP_PKGS="$PIP_PKGS requests"
fi

if [ -n "$PIP_PKGS" ]; then
    info "pip install :$PIP_PKGS"
    # shellcheck disable=SC2086
    pip3 install $PIP_PKGS --break-system-packages --quiet 2>/dev/null || \
    # shellcheck disable=SC2086
    pip3 install $PIP_PKGS --quiet 2>/dev/null || \
        warn "pip3 a échoué pour :$PIP_PKGS"
fi

# Vérification finale des dépendances critiques
DEPS_OK=true
if ! "$PY" -c "from PyQt5.QtWidgets import QApplication" 2>/dev/null; then
    err "PyQt5 manquant — l'application ne pourra pas démarrer"
    DEPS_OK=false
fi
if ! "$PY" -c "from PyQt5.QtWebEngineWidgets import QWebEngineView" 2>/dev/null; then
    err "PyQtWebEngine manquant — l'éditeur FBD ne fonctionnera pas"
    DEPS_OK=false
fi
if ! "$PY" -c "import paramiko" 2>/dev/null; then
    warn "paramiko manquant — déploiement SFTP/SSH désactivé"
fi

if [ "$DEPS_OK" = false ]; then
    err "Dépendances critiques manquantes. Installation interrompue."
    echo ""
    echo "  Solutions :"
    echo "  Ubuntu/Debian : sudo apt install python3-pyqt5 python3-pyqt5.qtwebengine"
    echo "  pip           : pip3 install PyQt5 PyQtWebEngine --break-system-packages"
    exit 1
fi
ok "Toutes les dépendances critiques sont présentes"

# ── Installation des fichiers ─────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/5] Installation des fichiers${NC}"

# Détecter les sources
HAS_SOURCES=false
for src_candidate in "$SCRIPT_DIR" "$SCRIPT_DIR/.."; do
    if [ -f "$src_candidate/main.py" ] && [ -d "$src_candidate/ui" ]; then
        SRC_ROOT="$src_candidate"
        HAS_SOURCES=true
        break
    fi
done

if [ "$HAS_SOURCES" = false ]; then
    err "Sources non trouvées. Placer ce script dans le dossier du projet."
    echo "  Structure attendue :"
    echo "  rpi-plc-studio/"
    echo "  ├── main.py"
    echo "  ├── core/"
    echo "  ├── ui/"
    echo "  ├── resources/"
    echo "  └── install-studio.sh  ← ce script"
    exit 1
fi

info "Sources : $SRC_ROOT"

# Créer la structure dans /opt
mkdir -p "$APP_DIR"/{core,ui,resources,rpi_server/static,rpi_server/templates}

# Copier (sans les fichiers .old et "copie")
rsync_or_cp() {
    local src="$1" dst="$2"
    if which rsync >/dev/null 2>&1; then
        rsync -a --exclude="* copie*" --exclude="*.old" \
              --exclude="__pycache__" --exclude="*.pyc" \
              "$src/" "$dst/" 2>/dev/null
    else
        cp -r "$src/." "$dst/"
        find "$dst" -name "* copie*" -o -name "*.old" -o -name "*.pyc" \
             -o -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    fi
}

cp "$SRC_ROOT/main.py"            "$APP_DIR/"           && ok "→ main.py"
cp "$SRC_ROOT/migrate_project.py" "$APP_DIR/" 2>/dev/null || true

rsync_or_cp "$SRC_ROOT/core"      "$APP_DIR/core"      && ok "→ core/"
rsync_or_cp "$SRC_ROOT/ui"        "$APP_DIR/ui"        && ok "→ ui/"
rsync_or_cp "$SRC_ROOT/resources" "$APP_DIR/resources" && ok "→ resources/"

# rpi_server (pour le déploiement depuis le studio)
for f in server.py auth.py backup_manager.py calibration.py config.json \
          recipes.py report_generator.py rpi-plc.service setup_autonomy.sh \
          synoptic.json telegram_bot.py testeur_plc.html; do
    [ -f "$SRC_ROOT/rpi_server/$f" ] && \
        cp "$SRC_ROOT/rpi_server/$f" "$APP_DIR/rpi_server/"
done
[ -d "$SRC_ROOT/rpi_server/static" ] && \
    cp -r "$SRC_ROOT/rpi_server/static/." "$APP_DIR/rpi_server/static/"
[ -d "$SRC_ROOT/rpi_server/templates" ] && \
    cp -r "$SRC_ROOT/rpi_server/templates/." "$APP_DIR/rpi_server/templates/"
ok "→ rpi_server/"

# synoptic_canvas.js → static/ (version déployée sur RPi)
[ -f "$APP_DIR/ui/synoptic_canvas.js" ] && \
    cp "$APP_DIR/ui/synoptic_canvas.js" "$APP_DIR/rpi_server/static/"
ok "→ rpi_server/static/synoptic_canvas.js"

# Permissions
chmod -R 755 "$APP_DIR"
find "$APP_DIR" -name "*.py"   -exec chmod 644 {} \;
find "$APP_DIR" -name "*.html" -exec chmod 644 {} \;
find "$APP_DIR" -name "*.js"   -exec chmod 644 {} \;
find "$APP_DIR" -name "*.json" -exec chmod 644 {} \;
find "$APP_DIR" -name "*.qss"  -exec chmod 644 {} \;

# ── Lanceur et icône ──────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[4/5] Lanceur et icône${NC}"

# Script lanceur
cat > /usr/bin/rpi-plc-studio << LAUNCHEOF
#!/bin/bash
# Lanceur RPi-PLC Studio
APP_DIR="/opt/rpi-plc-studio"
LOG_DIR="\$HOME/.rpi-plc-studio"
mkdir -p "\$LOG_DIR"
exec /usr/bin/python3 "\$APP_DIR/main.py" "\$@"
LAUNCHEOF
chmod +x /usr/bin/rpi-plc-studio
ok "Lanceur /usr/bin/rpi-plc-studio"

# Icône
for icon_src in "$SRC_ROOT/rpi-plc-studio-icon.png" \
                "$SRC_ROOT/resources/rpi-plc-studio-icon.png"; do
    if [ -f "$icon_src" ]; then
        install -Dm644 "$icon_src" /usr/share/pixmaps/rpi-plc-studio.png
        # Également dans hicolor pour les bureaux qui le cherchent là
        install -Dm644 "$icon_src" \
            /usr/share/icons/hicolor/256x256/apps/rpi-plc-studio.png 2>/dev/null || true
        ok "Icône installée"
        break
    fi
done

# Fichier .desktop
cat > /usr/share/applications/rpi-plc-studio.desktop << DESKEOF
[Desktop Entry]
Version=1.0
Type=Application
Name=RPi-PLC Studio
GenericName=Environnement de développement PLC
Comment=Programmez et déployez des automates sur Raspberry Pi
Exec=/usr/bin/rpi-plc-studio %f
Icon=rpi-plc-studio
Terminal=false
Categories=Development;Electronics;Science;
Keywords=PLC;automate;Raspberry Pi;SCADA;FBD;automation;
StartupNotify=true
StartupWMClass=rpi-plc-studio
MimeType=application/x-plcproj;
DESKEOF
chmod 644 /usr/share/applications/rpi-plc-studio.desktop
ok ".desktop créé"

# Type MIME pour les fichiers .plcproj
mkdir -p /usr/share/mime/packages
cat > /usr/share/mime/packages/rpi-plc-studio.xml << MIMEEOF
<?xml version="1.0" encoding="UTF-8"?>
<mime-info xmlns="http://www.freedesktop.org/standards/shared-mime-info">
  <mime-type type="application/x-plcproj">
    <comment>Projet RPi-PLC Studio</comment>
    <glob pattern="*.plcproj"/>
    <icon name="rpi-plc-studio"/>
  </mime-type>
</mime-info>
MIMEEOF

# Dossier projets utilisateur
PROJECTS_DIR="$REAL_HOME/rpi-plc-studio"
mkdir -p "$PROJECTS_DIR"
chown "$REAL_USER:$REAL_USER" "$PROJECTS_DIR" 2>/dev/null || true
mkdir -p "$REAL_HOME/.rpi-plc-studio"
chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.rpi-plc-studio" 2>/dev/null || true

# ── Mise à jour des bases de données desktop ──────────────────────────────────
echo ""
echo -e "${BOLD}[5/5] Mise à jour des caches système${NC}"

update-mime-database /usr/share/mime 2>/dev/null && ok "Base MIME mise à jour" || true
if which gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null && ok "Cache icônes mis à jour" || true
fi
update-desktop-database -q /usr/share/applications 2>/dev/null && ok "Base .desktop mise à jour" || true
if which xdg-mime >/dev/null 2>&1; then
    xdg-mime default rpi-plc-studio.desktop application/x-plcproj 2>/dev/null || true
fi

# ── Test de démarrage ─────────────────────────────────────────────────────────
echo ""
info "Test des imports Python..."
if su -c "python3 -c 'from PyQt5.QtWidgets import QApplication; \
                       from PyQt5.QtWebEngineWidgets import QWebEngineView; \
                       import paramiko; print(\"OK\")'" \
        "$REAL_USER" 2>/dev/null | grep -q "OK"; then
    ok "Tous les modules critiques importables"
else
    warn "Impossible de tester les imports (environnement graphique requis)"
fi

# ── Résultat ──────────────────────────────────────────────────────────────────
echo ""
sep
echo -e "${GREEN}${BOLD}"
echo "  ✅  RPi-PLC Studio v${VERSION} installé avec succès !"
echo -e "${NC}"
echo -e "  🚀  Lancer            : ${CYAN}rpi-plc-studio${NC}"
echo -e "                          ou Menu Applications → Électronique"
echo -e "  📁  Dossier projets   : ${BOLD}$PROJECTS_DIR${NC}"
echo -e "  📋  Logs              : ${BOLD}$REAL_HOME/.rpi-plc-studio/${NC}"
echo -e "  🔧  App installée dans: ${BOLD}$APP_DIR${NC}"
echo ""
echo -e "  ${BOLD}Commandes :${NC}"
echo -e "  ┌────────────────────────────────────────────────────────┐"
echo -e "  │  rpi-plc-studio                  (lancer le studio)    │"
echo -e "  │  rpi-plc-studio mon_projet.plcproj  (ouvrir un projet) │"
echo -e "  │  sudo dpkg -r rpi-plc-studio     (désinstaller)        │"
echo -e "  │  sudo bash install-studio.sh     (mettre à jour)       │"
echo -e "  └────────────────────────────────────────────────────────┘"
echo ""

# Avertissement DISPLAY si pas de session graphique
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
    warn "Aucune session graphique détectée."
    warn "Lancer depuis un terminal dans votre environnement de bureau."
fi

sep
echo ""
