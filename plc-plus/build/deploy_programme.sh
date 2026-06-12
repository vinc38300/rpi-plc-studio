#!/bin/bash
# ============================================================
# deploy_programme.sh — Déploiement programme.json sur RPi
# Usage : bash deploy_programme.sh
# ============================================================

RPI_USER="rpi1"
RPI_HOST="192.168.1.49"
RPI_DIR="/home/rpi1/rpi-plc"
RPI_VARS_DIR="/home/rpi1/.rpi-plc-studio"
SSH_KEY="/home/famille/.ssh/rpi_plc_id_ed25519"
SSH="ssh -i $SSH_KEY $RPI_USER@$RPI_HOST"
SCP="scp -i $SSH_KEY"

echo "=== Déploiement programme RPi-PLC ==="
echo "Cible : $RPI_USER@$RPI_HOST"

# 1. Copier programme.json
echo ""
echo "1. Envoi programme.json..."
$SCP programme.json $RPI_USER@$RPI_HOST:$RPI_DIR/programme.json
[ $? -eq 0 ] && echo "   ✓ programme.json" || { echo "   ✗ ERREUR"; exit 1; }

# 2. Copier av_vars.json dans le dossier de persistance
echo "2. Envoi av_vars.json..."
$SSH "mkdir -p $RPI_VARS_DIR"
$SCP av_vars.json $RPI_USER@$RPI_HOST:$RPI_VARS_DIR/av_vars.json
[ $? -eq 0 ] && echo "   ✓ av_vars.json" || echo "   ✗ ERREUR (non bloquant)"

# 3. Copier dv_vars.json (état initial sûr)
echo "3. Envoi dv_vars.json..."
$SCP dv_vars.json $RPI_USER@$RPI_HOST:$RPI_VARS_DIR/dv_vars.json
[ $? -eq 0 ] && echo "   ✓ dv_vars.json" || echo "   ✗ ERREUR (non bloquant)"

# 4. Redémarrer le service
echo "4. Redémarrage du service rpi-plc..."
$SSH "sudo systemctl restart rpi-plc"
[ $? -eq 0 ] && echo "   ✓ Service redémarré" || echo "   ✗ Erreur restart"

# 5. Vérification
sleep 3
echo "5. Vérification..."
$SSH "sudo systemctl is-active rpi-plc"
echo ""
echo "=== Logs du service (10 dernières lignes) ==="
$SSH "sudo journalctl -u rpi-plc -n 10 --no-pager"

echo ""
echo "=== Déploiement terminé ==="
echo "Synoptique : http://$RPI_HOST:5000/maison"
