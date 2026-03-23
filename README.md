RPi-PLC Studio 
Environnement de développement visuel pour automate Raspberry Pi 
Licence MIT — Logiciel libre | Python 3 · PyQt5 · QWebEngine · Flask · paramiko · gpiod v2 
 Vue d'ensemble 
RPi-PLC Studio est une application desktop (Linux/Kubuntu) permettant de : 
Programmer un automate Raspberry Pi en FBD (Function Block Diagram) multi-pages
Simuler le programme localement en temps réel avant déploiement
Éditer un synoptique opérateur animé (widgets PLC, symboles P&ID, symboles animés, navigation multi-pages, popup)
Déployer en un clic vers le Raspberry Pi via SSH
Surveiller le RPi via une interface SCADA web embarquée (11 onglets) 
 Installation (Kubuntu / Ubuntu) 
bash install.sh

Ou manuellement : 
sudo apt install python3-pyqt5 python3-pyqt5.qtwebenginepip3 install paramiko
python3 main.py

 Architecture 
rpi-plc-studio/
├── main.py├── install.sh├── core/
│ ├── plc_engine.py│ ├── project.py│ └── deployer.py├── ui/
│ ├── main_window.py│ ├── block_editor.py│ ├── fbd_canvas.html│ ├── synoptic_editor.py│ ├── synoptic_canvas.html│ ├── synoptic_window.py│ ├── gpio_panel.py│ ├── gpio_config_dialog.py│ └── deploy_dialog.py├── resources/
│ ├── style.qss│ ├── theme_light.qss│ └── theme_dark.qss└── rpi_server/├── server.py├── auth.py├── telegram_bot.py├── recipes.py├── backup_manager.py├── calibration.py├── report_generator.py├── config.json├── setup_autonomy.sh├── rpi-plc.service└── templates/
├── index.htmlpython3-pip
← Point d'entrée, chargement du thème
← Installateur Ubuntu/Kubuntu
← Moteur PLC (84+ blocs validés)
← Gestion projets .plcproj (multi-pages)
← Déploiement SSH
← Fenêtre principale, sélecteur de thème
← Éditeur FBD (QWebEngineView)
← Canvas FBD interactif (HTML5/JS)
← Éditeur synoptique (QWebEngineView)
← Canvas synoptique (HTML5/JS)
← Fenêtre synoptique flottante
← Panneau GPIO + Mémoires (simulation)
← Configurateur visuel GPIO (Ctrl+G)
← Fenêtre de déploiement SSH
← Thème par défaut (=theme_light.qss)
← Thème clair industriel
← Thème sombre GitHub-style
← Code embarqué déployé sur le RPi
← Serveur Flask + moteur PLC (52 routes API)
← Authentification, sessions, HTTPS TLS
← Bot Telegram — alertes & commandes
← Gestionnaire de recettes/profils
← Sauvegardes versionnées (20 versions)
← Calibration offset/gain par sonde
← Rapports HTML/CSV avec sparklines
← Configuration matérielle + sécurité + Telegram
← Script installation automatique (Bookworm/Bullseye)
← Unité systemd
← Interface monitoring simple
├──└──scada.htmlsynoptic.html Workflow typique 
← SCADA 11 onglets
← Synoptique déployé
Créer / ouvrir un projet .plcproj (Fichier → Ouvrir)
Configurer les GPIO : Raspberry Pi → Configurer les GPIO... (Ctrl+G) — définir entrées/sorties
Programmer en FBD : glisser les blocs depuis la palette, câbler les ports
Simuler : ▶ START — activer/désactiver les entrées dans le panneau GPIO
Synoptique : 🖥 Synoptique — éditer la vue opérateur avec widgets et symboles
Déployer : 🚀 Déployer — envoyer vers le Raspberry Pi via SSH
Surveiller : accéder à http://<ip-rpi>:5000/scada depuis n'importe quel navigateur 
 Thèmes 
Deux thèmes disponibles depuis la barre d'outils ou le menu Affichage :Bouton Thème☀ Clair Fond blanc, barre marine #1e2d4a, accents bleu #2563eb🌙 Sombre Fond #0d1117, accents #58a6ff (GitHub-style) 
La préférence est sauvegardée dans ~/.rpi-plc-studio/preferences.json et restaurée au prochain démarrage. 
 Configurateur GPIO 
Raspberry Pi → Configurer les GPIO... (Ctrl+G) — dialogue visuel pour configurer chaque broche BCM :Champ DescriptionPin BCM Numéro de broche (GPIO 4–27, sauf GPIO 2/3 réservés I2C)Nom Libellé affiché dans le SCADA et les blocs FBDMode Entrée / SortiePull Résistance interne : up / down / offActif bas Logique inversée (typique relais opto-couplés) 
La config est sauvegardée dans le projet .plcproj et déployée dans rpi_server/config.json à chaque déploiement SSH. 
Broches spéciales : - GPIO 2 (SDA), GPIO 3 (SCL) : bloqués (bus I2C ADS1115) - GPIO 14 (TX), GPIO 15 (RX) : avertissement UART - GPIO 18
(PCM_CLK) : setup_autonomy.sh désactive l'audio automatiquement si utilisé en sortie 
 Éditeur FBD 
Navigation pages 
◀ ▶ : page précédente / suivante
+ : ajouter une page — ✕ : supprimer la page courante
⊡ Ajuster : recadrer la vue sur les blocs
Double-clic sur le nom de page : renommer 
Grille d'accrocheContrôle Valeurs DescriptionPAS [20 px ▾] 5 / 10 / 20 / 40 px Pas de la grille d'accroche⊞ Snap ON (vert) / OFF (gris) Activer/désactiver l'accroche 
Les flèches clavier (←↑→↓) déplacent le bloc sélectionné du pas courant. 
Connecteurs inter-pagesBloc RôlePAGE_OUT Émet un signal nommé vers d'autres pagesPAGE_INCONN Connecteur numéroté bidirectionnel (1→1) Blocs Groupes — Encapsulation 

Les blocs Groupes permettent d'encapsuler un sous-programme FBD dans un bloc boîte noire réutilisable, avec des ports d'entrée/sortie
nommés. Les groupes sont imbriquables et sauvegardables dans une bibliothèque personnelle.Bloc Ports DescriptionGROUP INx → Qx (variable) Bloc groupe. Double-clic pour entrer dans le contenu, Échap pour sortir. Les ports sont définis par les blocs
GROUP_IN/OUT internes.GROUP_IN → SIG Port d'entrée — transmet un signal de l'extérieur vers l'intérieur du groupeGROUP_OUT IN → Port de sortie — expose un signal calculé à l'intérieur vers l'extérieur
Raccourcis groupesTouche ActionCtrl+G Grouper les blocs sélectionnésCtrl+Maj+G Dégrouper le bloc GROUP sélectionnéDouble-clic sur GROUP Entrer dans le groupeÉchap Sortir du groupe (retour niveau parent) 
Bibliothèque de groupes 
Un groupe peut être exporté dans la bibliothèque personnelle (clic droit → Exporter vers bibliothèque). Il apparaît ensuite dans la palette et peut
être glissé dans n'importe quel projet. La bibliothèque est exportable/importable en .json via les boutons ⬇/⬆ dans l'en-tête de la section
Bibliothèque de la palette.Bloc Ports DescriptionINPUT → VAL Entrée GPIO numériqueOUTPUT VAL → Sortie GPIO numériqueCONST → VAL Constante numériqueMEM W → R Bit mémoire M0...M31 
LogiqueBloc Ports DescriptionAND IN1, IN2 → OUT ET logiqueOR IN1, IN2 → OUT OU logiqueNOT / INV IN → OUT Inverseur (NON)XOR IN1, IN2 → OUT OU exclusifSR S1, R → Q1 Bascule SR (Reset prioritaire)RS S, R1 → Q1 Bascule RS (Set prioritaire)SR_R SET, RES → STS Bascule SR Reset-prioritaire (Proview)SR_S SET, RES → STS Bascule SR Set-prioritaire (Proview) 
BobinesBloc Ports DescriptionCOIL EN → Q Sortie active si condition vraieSET S → Q Mémorise 1 (Set)RESET R → Q Mémorise 0 (Reset)MOVE IN, EN → OUT Affectation conditionnelle 
TempsBloc Ports DescriptionTON IN, PT → Q, ET Temporisation montante (ON-delay)TOF IN, PT → Q, ET Temporisation descendante (OFF-delay)TP IN, PT → Q, ET Impulsion de durée fixeWAIT IN → Q Délai activé par frontWAITH IN → STS Tempo désactivation (WaitH)PULSE IN → Q Impulsion courteReçoit un signal de même nom depuis une autre pageCompteursBloc Ports DescriptionCTU CU, R, PV → Q, CV Compteur montantCTD CD, LD, PV → Q, CV Compteur descendantCTUD CU, CD, R, LD, PV → Q, CV Compteur bidirectionnelRUNTIMCNT RUN → STARTS, TOTAL, RUNTIME Compteur temps de marche 
ComparaisonBloc Ports DescriptionGT IN1, IN2 → OUT IN1 > IN2GE IN1, IN2 → OUT IN1 ≥ IN2LT IN1, IN2 → OUT IN1 < IN2EQ IN1, IN2 → OUT IN1 = IN2COMPARE_F IN, SP → GT, LT, EQ Comparaison flottante avec seuil 
Analogique / Traitement signalBloc Ports DescriptionPT_IN → TEMP, FAULT Sonde PT100/PT1000/NTC40 (MAX31865 SPI)ANA_IN → VAL Entrée ADS1115 (0–5 V)SENSOR → VAL Capteur température calibré (PT100/PT1000/NTC10K/NTC40)SCALE IN → OUT Mise à l'échelle linéairePID PV, SP, EN → OUT, ERR Régulateur PIDAVG IN → OUT Moyenne glissante N échantillonsINTEG IN, RES → OUT, MAX Intégrateur anti-windupDERIV IN → OUT Dérivateur Kd·dIN/dtFILT1 IN → OUT Filtre passe-bas 1er ordreDEADB IN → OUT, DEAD Zone morte ±deadRAMP SP → OUT, DONE Rampe limitée en vitesseHYST IN → OUT Hystérésis autour d'un point milieuCOMPH IN, HIG → HL Seuil HAUT avec hystérésisCOMPL IN, LOW → LL Seuil BAS avec hystérésis 
CalculBloc Ports DescriptionADD IN1, IN2 → OUT AdditionSUB IN1, IN2 → OUT SoustractionMUL IN1, IN2 → OUT MultiplicationDIV IN1, IN2 → OUT Division (DIV/0 → 0)ABS IN → OUT Valeur absolueSQRT IN → OUT Racine carrée (négatif → 0)MIN IN1, IN2 → OUT MinimumMAX IN1, IN2 → OUT MaximumMOD IN1, IN2 → OUT ModuloPOW BASE, EXP → OUT PuissanceCLAMP IN → OUT, CLIP Limitation min/maxSEL G, IN0, IN1 → OUT Sélecteur (G=0→IN0, G=1→IN1)MUX IDX, IN0..INn → VAL Multiplexeur analogique 
Variables (style Proview)Bloc PortsBACKUP → VALAVDVSTOAVSTOAP→ OUT→ OUTIN →DescriptionRegistre non-volatile persisté dans ~/.rpi-plc-studio/backup_store.json. Sauvegardé toutes les 30 s
et à l'arrêt.Variable analogique d'état (source pure)Variable booléenne d'état (source pure)Écriture forcée dans une variable AvLOCALTIME → HOUR, MDAY, WDAY Heure locale (heure, jour du mois, jour de semaine 0=Dim) 
Actionneurs (Proview)Bloc Ports DescriptionCONTACTOR ON → Q Contacteur/relais (ContactorFo)VALVE3V OINC, ODEC → Vanne 3 voies (deux GPIO) 
Arithmétique avancéeBloc DescriptionCARITHM Bloc arithmétique Proview — code C embarqué, jusqu'à 8A + 7d + 2I entrées, 8OA + 8od + 1OI sorties. Syntaxe C simplifiée (if/else,
opérateurs, affectations). Variables internesType Plage DescriptionGPIO 0–27 Broches Raspberry Pi (BCM)M M0–M31 Bits mémoire booléens (non persistants)RF RF0–RF15 Registres flottants (non persistants)Backup nom libre Valeurs persistantes (JSON disque) 
 Types de sondes analogiquesprobe_type Méthode ParamètresPT100 Callendar-Van Dusen, R0=100 Ω r_ref_ohm, vccPT1000 Callendar-Van Dusen, R0=1000 Ω r_ref_ohm, vccNTC10K Steinhart-Hart β, R0=10 kΩ à 25°C ntc_beta, ntc_r0, r_ref_ohm, vccNTC40 Steinhart-Hart β, R0=40 kΩ à 25°C — sonde de cette carte ntc_beta=3950, ntc_r0=40000, r_ref_ohm, vcc 

Jusqu'à 3 cartes ADS1115 supportées simultanément (ANA0–ANA11) : - ADS0 @ 0x48 (ADDR → GND) → ANA0–ANA3 - ADS1 @ 0x49 (ADDR → VDD)
→ ANA4–ANA7 - ADS2 @ 0x4A (ADDR → SDA) → ANA8–ANA11 
 Déploiement sur Raspberry Pi 
Option 1 — Depuis l'interface PC 
🚀 Déployer (F7) ou menu Raspberry Pi → Déployer
Renseigner : IP, utilisateur, mot de passe ou clé SSH 
Option 2 — setup_autonomy.sh (recommandé, sur le RPi) 
# Copier rpi_server/ sur le RPi, puis :
chmod +x setup_autonomy.sh
./setup_autonomy.sh

Ce script installe automatiquement : gpiod v2, lgpio, smbus2, Flask, SocketIO, active I2C, configure le service systemd avec les permissions GPIO
correctes (CAP_SYS_RAWIO), et démarre le serveur. 
Bibliothèque GPIO 
Le serveur utilise gpiod v2 (Bookworm 64-bit officiel) avec fallback sur lgpio, puis mode simulation : 
# Vérifier gpiod v2
python3 -c "import gpiod; print(gpiod.__version__)"
 # Vérifier /dev/gpiochip0
ls -l /dev/gpiochip0
 # Logs GPIO
journalctl -u rpi-plc -n 30 | grep -i gpio
IN → Écriture du preset d'un timerService systemd 
sudo systemctl start rpi-plc
sudo systemctl stop rpi-plc
sudo systemctl restart rpi-plc
sudo systemctl status rpi-plc
journalctl -u rpi-plc -f

 Interface SCADA — 11 onglets 
Accessible via http://<ip-rpi>:5000/scada :Onglet Contenu🗺 Synoptique Vue opérateur temps réel avec widgets🌡 Températures Toutes les sondes avec alarmes📈 Historique Courbes et mini-graphes par canal🎛 Commandes Consignes RF, sorties manuelles, bits M🔔 Alarmes Alarmes actives + historique⚙ Système État PLC, réglage scan, registres RF📋 Recettes Profils de consignes (créer/appliquer/snapshot)💾 Sauvegardes Versions du programme (20 versions, auto-backup)✈ Telegram Configuration et test du bot🔒 Sécurité Login, mot de passe, HTTPS TLS🔧 Calibration Offset/gain/alarmes par sonde 
 Synoptique opérateur 
Accessible via 🖥 Synoptique (F8). Éditeur canvas HTML5 avec : 
Widgets disponiblesWidget DescriptionThermomètre Valeur analogique avec barre de progression et alarmesJauge circulaire Valeur analogique en arcBarre de niveau Valeur analogique verticale/horizontaleCourbe tendance Historique temps réelValeur numérique Affichage numérique avec unitéRelais ON/OFF État booléen avec boutonConsigne Valeur réglable par sliderBouton action Démarrer/arrêter PLC, forcer bit MInterrupteur M Toggle bit mémoireVoyant alarme LED coloréeTexte libre LabelRectangle Zone décorativeTuyauterie Ligne de tuyauImage Import PNG/JPGSymbole P&ID Bibliothèque de 30 symboles industrielsNaviguer page Bouton de navigation vers une autre page (ou popup) du synoptiqueBouton Retour Bouton libre — retourne à la page précédente 
Symboles animés (8 équipements) 
Symboles SVG animés liés à un bit M/GPIO : 
Chaudière — flamme + fumée + vis animées
Circulateur — roue qui tourne
Pompe — hélice + flux
Échangeur — flux entrant/sortant
Vanne — volet rotatif
Ballon — niveau liquide animé
Panneau solaire — rayons pulsants
Pompe à chaleur — cycle thermodynamiquePages multiples et navigation 
Le synoptique supporte plusieurs pages indépendantes avec barre d'onglets.Action CommentNaviguer Cliquer un onglet de pageAjouter page normale Bouton + dans la barre (mode édition)Ajouter sous-menu popup Bouton ⊞ violet dans la barre (mode édition)Supprimer Bouton ✕ sur l'onglet (mode édition)Renommer Double-clic sur l'onglet (mode édition) 
Barre de navigation fixe 
Activée via ⊟ Nav : affiche ← Retour, fil d'ariane cliquable (Vue principale › Chaudière), bouton ⌂. 
 Déploiement SSH 
🚀 Déployer (F7)
Renseigner : IP, utilisateur, mot de passe ou clé SSH 
Connexion sans mot de passe 
# Dans la fenêtre Déployer
# 1. Cliquer "Générer clé SSH" → crée ~/.ssh/rpi_plc_id_ed25519
# 2. Cliquer "Copier clé sur RPi" → entrer le mot de passe une fois
# Les déploiements suivants sont sans mot de passe

 Persistance Backup 
Les valeurs BACKUP sont sauvegardées dans ~/.rpi-plc-studio/backup_store.json : 
Sauvegarde automatique toutes les 30 secondes pendant le scan
Sauvegarde à l'arrêt du moteur (■ STOP)
Rechargement automatique au démarrage du moteur
Accepte des valeurs flottantes et des booléens (0.0 / 1.0) 
 Bot Telegram 
Configuration dans rpi_server/config.json → section "telegram" : 
{
}

"telegram": {
"enabled": true,
"token": "123456:ABC-your-token",
"chat_ids": ["123456789"],
"alarm_high": 85.0,
"alarm_low": 3.0,
"report_hour": 8,
"report_enabled": true
}
Commandes disponibles : /status, /temp, /relais, /on K1, /off K1, /start, /stop, /consigne RF0 75.5, /recette NomRecette, /log,
/aide. 
 Raccourcis clavier 
Application principale (Qt)Touche ActionF5 Démarrer la simulationF6 Arrêter la simulationF7 Déployer vers le RPiF8 Ouvrir le synoptiqueCtrl+S EnregistrerCtrl+N Nouveau projetCtrl+O Ouvrir un projetCtrl+G Configurateur GPIO (menu Raspberry Pi) 
Canvas FBDTouche ActionF Ajuster la vue (fitView)Suppr Supprimer le bloc/fil sélectionné←↑→↓ Déplacer le bloc du pas de grilleCtrl+Z Annuler (40 niveaux)Ctrl+Y RétablirCtrl+A Tout sélectionnerCtrl+G (focus canvas) Grouper les blocs sélectionnésCtrl+Maj+G Dégrouper le bloc GROUP sélectionnéDouble-clic sur GROUP Entrer dans le groupeÉchap Sortir du groupe (retour niveau parent) 
SynoptiqueTouche ActionTab Basculer mode édition/vue opérateurCtrl+D Dupliquer le widget sélectionnéCtrl+S Sauvegarder le synoptiqueSuppr Supprimer le widget sélectionné←↑→↓ Déplacer le widget du pas de grille
