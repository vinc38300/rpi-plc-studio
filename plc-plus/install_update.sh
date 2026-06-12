#!/bin/bash
# Script de mise à jour RPi-PLC Studio
# À lancer depuis le dossier où vous avez extrait le zip

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Mise à jour RPi-PLC Studio ==="
echo "Dossier source : $SCRIPT_DIR"
echo ""

# Vérifier que main.py existe ici
if [ ! -f "$SCRIPT_DIR/main.py" ]; then
    echo "ERREUR: main.py non trouvé dans $SCRIPT_DIR"
    exit 1
fi

echo "Fichiers copiés depuis $SCRIPT_DIR :"
echo "  ui/fbd_canvas.html    : $(wc -c < "$SCRIPT_DIR/ui/fbd_canvas.html") octets"
echo "  ui/synoptic_canvas.html : $(wc -c < "$SCRIPT_DIR/ui/synoptic_canvas.html") octets"
echo "  ui/main_window.py     : $(wc -c < "$SCRIPT_DIR/ui/main_window.py") octets"
echo ""
echo "=== Prêt à lancer : python3 main.py ==="
