# RPi-PLC Studio
### Environnement de développement visuel pour automate Raspberry Pi

Licence MIT — Logiciel libre | Python 3 · PyQt5 · QWebEngine · Flask · paramiko · gpiod v2

---

## Vue d'ensemble

RPi-PLC Studio est une application desktop (Linux/Kubuntu) permettant de :

1. **Programmer** un automate Raspberry Pi en **FBD** (Function Block Diagram) multi-pages
2. **Simuler** le programme localement en temps réel avant déploiement
3. **Éditer un synoptique** opérateur animé (widgets PLC, symboles P&ID, symboles animés, navigation multi-pages, popup)
4. **Déployer en un clic** vers le Raspberry Pi via SSH
5. **Surveiller** le RPi via une interface SCADA web embarquée (11 onglets)

---

## Installation (Kubuntu / Ubuntu)

```bash
bash install.sh
```

Ou manuellement :

```bash
sudo apt install python3-pyqt5 python3-pyqt5.qtwebengine python3-pip
pip3 install paramiko
python3 main.py
```

---

## Architecture

```
rpi-plc-studio/
├── main.py                        ← Point d'entrée, chargement du thème
├── install.sh                     ← Installateur Ubuntu/Kubuntu
├── core/
│   ├── plc_engine.py              ← Moteur PLC (84+ blocs validés)
│   ├── project.py                 ← Gestion projets .plcproj (multi-pages)
│   └── deployer.py                ← Déploiement SSH
├── ui/
│   ├── main_window.py             ← Fenêtre principale, sélecteur de thème
│   ├── block_editor.py            ← Éditeur FBD (QWebEngineView)
│   ├── fbd_canvas.html            ← Canvas FBD interactif (HTML5/JS)
│   ├── synoptic_editor.py         ← Éditeur synoptique (QWebEngineView)
│   ├── synoptic_canvas.html       ← Canvas synoptique (HTML5/JS)
│   ├── synoptic_window.py         ← Fenêtre synoptique flottante
│   ├── gpio_panel.py              ← Panneau GPIO + Mémoires (simulation)
│   ├── gpio_config_dialog.py      ← Configurateur visuel GPIO (Ctrl+G)
│   └── deploy_dialog.py           ← Fenêtre de déploiement SSH
├── resources/
│   ├── style.qss                  ← Thème par défaut (=theme_light.qss)
│   ├── theme_light.qss            ← Thème clair industriel
│   └── theme_dark.qss             ← Thème sombre GitHub-style
└── rpi_server/                    ← Code embarqué déployé sur le RPi
    ├── server.py                  ← Serveur Flask + moteur PLC (52 routes API)
    ├── auth.py                    ← Authentification, sessions, HTTPS TLS
    ├── telegram_bot.py            ← Bot Telegram — alertes & commandes
    ├── recipes.py                 ← Gestionnaire de recettes/profils
    ├── backup_manager.py          ← Sauvegardes versionnées (20 versions)
    ├── calibration.py             ← Calibration offset/gain par sonde
    ├── report_generator.py        ← Rapports HTML/CSV avec sparklines
    ├── config.json                ← Configuration matérielle + sécurité + Telegram
    ├── setup_autonomy.sh          ← Script installation automatique (Bookworm/Bullseye)
    ├── rpi-plc.service            ← Unité systemd
    └── templates/
        ├── index.html             ← Interface monitoring simple
        ├── scada.html             ← SCADA 11 onglets
        └── synoptic.html          ← Synoptique déployé
```

---

## Workflow typique

1. **Créer / ouvrir** un projet `.plcproj` (Fichier → Ouvrir)
2. **Configurer les GPIO** : `Raspberry Pi → Configurer les GPIO…` (Ctrl+G) — définir entrées/sorties
3. **Programmer** en FBD : glisser les blocs depuis la palette, câbler les ports
4. **Simuler** : `▶ START` — activer/désactiver les entrées dans le panneau GPIO
5. **Synoptique** : `🖥 Synoptique` — éditer la vue opérateur avec widgets et symboles
6. **Déployer** : `🚀 Déployer` — envoyer vers le Raspberry Pi via SSH
7. **Surveiller** : accéder à `http://<ip-rpi>:5000/scada` depuis n'importe quel navigateur

---

## Thèmes

Deux thèmes disponibles depuis la barre d'outils ou le menu **Affichage** :

| Bouton | Thème |
|--------|-------|
| `☀ Clair` | Fond blanc, barre marine `#1e2d4a`, accents bleu `#2563eb` |
| `🌙 Sombre` | Fond `#0d1117`, accents `#58a6ff` (GitHub-style) |

La préférence est sauvegardée dans `~/.rpi-plc-studio/preferences.json` et restaurée au prochain démarrage.

---

## Configurateur GPIO

**Raspberry Pi → Configurer les GPIO…** (`Ctrl+G`) — dialogue visuel pour configurer chaque broche BCM :

| Champ | Description |
|---|---|
| Pin BCM | Numéro de broche (GPIO 4–27, sauf GPIO 2/3 réservés I²C) |
| Nom | Libellé affiché dans le SCADA et les blocs FBD |
| Mode | Entrée / Sortie |
| Pull | Résistance interne : up / down / off |
| Actif bas | Logique inversée (typique relais opto-couplés) |

La config est sauvegardée dans le projet `.plcproj` et déployée dans `rpi_server/config.json` à chaque déploiement SSH.

**Broches spéciales :**
- GPIO 2 (SDA), GPIO 3 (SCL) : bloqués (bus I²C ADS1115)
- GPIO 14 (TX), GPIO 15 (RX) : avertissement UART
- GPIO 18 (PCM_CLK) : `setup_autonomy.sh` désactive l'audio automatiquement si utilisé en sortie

---

## Éditeur FBD

### Navigation pages

- **◀ ▶** : page précédente / suivante
- **+** : ajouter une page — **✕** : supprimer la page courante
- **⊡ Ajuster** : recadrer la vue sur les blocs
- Double-clic sur le nom de page : renommer

### Grille d'accroche

| Contrôle | Valeurs | Description |
|---|---|---|
| `PAS [20 px ▾]` | 5 / 10 / **20** / 40 px | Pas de la grille d'accroche |
| `⊞ Snap` | ON (vert) / OFF (gris) | Activer/désactiver l'accroche |

Les flèches clavier (←↑→↓) déplacent le bloc sélectionné du pas courant.

### Connecteurs inter-pages

| Bloc | Rôle |
|---|---|
| `PAGE_OUT` | Émet un signal nommé vers d'autres pages |
| `PAGE_IN` | Reçoit un signal de même nom depuis une autre page |
| `CONN` | Connecteur numéroté bidirectionnel (1→1) |

---

## Blocs Groupes — Encapsulation

Les blocs Groupes permettent d'**encapsuler un sous-programme FBD** dans un bloc boîte noire réutilisable, avec des ports d'entrée/sortie nommés. Les groupes sont imbriquables et sauvegardables dans une bibliothèque personnelle.

| Bloc | Ports | Description |
|---|---|---|
| `GROUP` | INx → Qx (variable) | Bloc groupe. Double-clic pour entrer dans le contenu, `Échap` pour sortir. Les ports sont définis par les blocs GROUP_IN/OUT internes. |
| `GROUP_IN` | → SIG | Port d'entrée — transmet un signal de l'extérieur vers l'intérieur du groupe |
| `GROUP_OUT` | IN → | Port de sortie — expose un signal calculé à l'intérieur vers l'extérieur |

### Raccourcis groupes

| Touche | Action |
|---|---|
| `Ctrl+G` | Grouper les blocs sélectionnés |
| `Ctrl+Maj+G` | Dégrouper le bloc GROUP sélectionné |
| Double-clic sur GROUP | Entrer dans le groupe |
| `Échap` | Sortir du groupe (retour niveau parent) |

### Bibliothèque de groupes

Un groupe peut être exporté dans la **bibliothèque personnelle** (clic droit → *Exporter vers bibliothèque*). Il apparaît ensuite dans la palette et peut être glissé dans n'importe quel projet. La bibliothèque est exportable/importable en `.json` via les boutons ⬇/⬆ dans l'en-tête de la section Bibliothèque de la palette.



| Bloc | Ports | Description |
|---|---|---|
| `INPUT` | → VAL | Entrée GPIO numérique |
| `OUTPUT` | VAL → | Sortie GPIO numérique |
| `CONST` | → VAL | Constante numérique |
| `MEM` | W → R | Bit mémoire M0…M31 |

### Logique

| Bloc | Ports | Description |
|---|---|---|
| `AND` | IN1, IN2 → OUT | ET logique |
| `OR` | IN1, IN2 → OUT | OU logique |
| `NOT` / `INV` | IN → OUT | Inverseur (NON) |
| `XOR` | IN1, IN2 → OUT | OU exclusif |
| `SR` | S1, R → Q1 | Bascule SR (Reset prioritaire) |
| `RS` | S, R1 → Q1 | Bascule RS (Set prioritaire) |
| `SR_R` | SET, RES → STS | Bascule SR Reset-prioritaire (Proview) |
| `SR_S` | SET, RES → STS | Bascule SR Set-prioritaire (Proview) |

### Bobines

| Bloc | Ports | Description |
|---|---|---|
| `COIL` | EN → Q | Sortie active si condition vraie |
| `SET` | S → Q | Mémorise 1 (Set) |
| `RESET` | R → Q | Mémorise 0 (Reset) |
| `MOVE` | IN, EN → OUT | Affectation conditionnelle |

### Temps

| Bloc | Ports | Description |
|---|---|---|
| `TON` | IN, PT → Q, ET | Temporisation montante (ON-delay) |
| `TOF` | IN, PT → Q, ET | Temporisation descendante (OFF-delay) |
| `TP` | IN, PT → Q, ET | Impulsion de durée fixe |
| `WAIT` | IN → Q | Délai activé par front |
| `WAITH` | IN → STS | Tempo désactivation (WaitH) |
| `PULSE` | IN → Q | Impulsion courte |

### Compteurs

| Bloc | Ports | Description |
|---|---|---|
| `CTU` | CU, R, PV → Q, CV | Compteur montant |
| `CTD` | CD, LD, PV → Q, CV | Compteur descendant |
| `CTUD` | CU, CD, R, LD, PV → Q, CV | Compteur bidirectionnel |
| `RUNTIMCNT` | RUN → STARTS, TOTAL, RUNTIME | Compteur temps de marche |

### Comparaison

| Bloc | Ports | Description |
|---|---|---|
| `GT` | IN1, IN2 → OUT | IN1 > IN2 |
| `GE` | IN1, IN2 → OUT | IN1 ≥ IN2 |
| `LT` | IN1, IN2 → OUT | IN1 < IN2 |
| `EQ` | IN1, IN2 → OUT | IN1 = IN2 |
| `COMPARE_F` | IN, SP → GT, LT, EQ | Comparaison flottante avec seuil |

### Analogique / Traitement signal

| Bloc | Ports | Description |
|---|---|---|
| `PT_IN` | → TEMP, FAULT | Sonde PT100/PT1000/NTC40 (MAX31865 SPI) |
| `ANA_IN` | → VAL | Entrée ADS1115 (0–5 V) |
| `SENSOR` | → VAL | Capteur température calibré (PT100/PT1000/NTC10K/NTC40) |
| `SCALE` | IN → OUT | Mise à l'échelle linéaire |
| `PID` | PV, SP, EN → OUT, ERR | Régulateur PID |
| `AVG` | IN → OUT | Moyenne glissante N échantillons |
| `INTEG` | IN, RES → OUT, MAX | Intégrateur anti-windup |
| `DERIV` | IN → OUT | Dérivateur Kd·dIN/dt |
| `FILT1` | IN → OUT | Filtre passe-bas 1er ordre |
| `DEADB` | IN → OUT, DEAD | Zone morte ±dead |
| `RAMP` | SP → OUT, DONE | Rampe limitée en vitesse |
| `HYST` | IN → OUT | Hystérésis autour d'un point milieu |
| `COMPH` | IN, HIG → HL | Seuil HAUT avec hystérésis |
| `COMPL` | IN, LOW → LL | Seuil BAS avec hystérésis |

### Calcul

| Bloc | Ports | Description |
|---|---|---|
| `ADD` | IN1, IN2 → OUT | Addition |
| `SUB` | IN1, IN2 → OUT | Soustraction |
| `MUL` | IN1, IN2 → OUT | Multiplication |
| `DIV` | IN1, IN2 → OUT | Division (DIV/0 → 0) |
| `ABS` | IN → OUT | Valeur absolue |
| `SQRT` | IN → OUT | Racine carrée (négatif → 0) |
| `MIN` | IN1, IN2 → OUT | Minimum |
| `MAX` | IN1, IN2 → OUT | Maximum |
| `MOD` | IN1, IN2 → OUT | Modulo |
| `POW` | BASE, EXP → OUT | Puissance |
| `CLAMP` | IN → OUT, CLIP | Limitation min/max |
| `SEL` | G, IN0, IN1 → OUT | Sélecteur (G=0→IN0, G=1→IN1) |
| `MUX` | IDX, IN0..INn → VAL | Multiplexeur analogique |

### Variables (style Proview)

| Bloc | Ports | Description |
|---|---|---|
| `BACKUP` | → VAL | Registre non-volatile persisté dans `~/.rpi-plc-studio/backup_store.json`. Sauvegardé toutes les 30 s et à l'arrêt. |
| `AV` | → OUT | Variable analogique d'état (source pure) |
| `DV` | → OUT | Variable booléenne d'état (source pure) |
| `STOAV` | IN → | Écriture forcée dans une variable Av |
| `STOAP` | IN → | Écriture du preset d'un timer |
| `LOCALTIME` | → HOUR, MDAY, WDAY | Heure locale (heure, jour du mois, jour de semaine 0=Dim) |

### Actionneurs (Proview)

| Bloc | Ports | Description |
|---|---|---|
| `CONTACTOR` | ON → Q | Contacteur/relais (ContactorFo) |
| `VALVE3V` | OINC, ODEC → | Vanne 3 voies (deux GPIO) |

### Arithmétique avancée

| Bloc | Description |
|---|---|
| `CARITHM` | Bloc arithmétique Proview — code C embarqué, jusqu'à 8A + 7d + 2I entrées, 8OA + 8od + 1OI sorties. Syntaxe C simplifiée (if/else, opérateurs, affectations). |

---

## Variables internes

| Type | Plage | Description |
|---|---|---|
| GPIO | 0–27 | Broches Raspberry Pi (BCM) |
| M | M0–M31 | Bits mémoire booléens (non persistants) |
| RF | RF0–RF15 | Registres flottants (non persistants) |
| Backup | nom libre | Valeurs persistantes (JSON disque) |

---

## Types de sondes analogiques

| probe_type | Méthode | Paramètres |
|---|---|---|
| `PT100` | Callendar-Van Dusen, R₀=100 Ω | `r_ref_ohm`, `vcc` |
| `PT1000` | Callendar-Van Dusen, R₀=1000 Ω | `r_ref_ohm`, `vcc` |
| `NTC10K` | Steinhart-Hart β, R₀=10 kΩ à 25°C | `ntc_beta`, `ntc_r0`, `r_ref_ohm`, `vcc` |
| `NTC40` | Steinhart-Hart β, R₀=40 kΩ à 25°C — **sonde de cette carte** | `ntc_beta`=3950, `ntc_r0`=40000, `r_ref_ohm`, `vcc` |

Jusqu'à 3 cartes ADS1115 supportées simultanément (ANA0–ANA11) :
- ADS0 @ 0x48 (ADDR → GND) → ANA0–ANA3
- ADS1 @ 0x49 (ADDR → VDD) → ANA4–ANA7
- ADS2 @ 0x4A (ADDR → SDA) → ANA8–ANA11

---

## Déploiement sur Raspberry Pi

### Option 1 — Depuis l'interface PC

1. `🚀 Déployer` (F7) ou menu **Raspberry Pi → Déployer**
2. Renseigner : IP, utilisateur, mot de passe ou clé SSH

### Option 2 — setup_autonomy.sh (recommandé, sur le RPi)

```bash
# Copier rpi_server/ sur le RPi, puis :
chmod +x setup_autonomy.sh
./setup_autonomy.sh
```

Ce script installe automatiquement : gpiod v2, lgpio, smbus2, Flask, SocketIO, active I²C, configure le service systemd avec les permissions GPIO correctes (`CAP_SYS_RAWIO`), et démarre le serveur.

### Bibliothèque GPIO

Le serveur utilise **gpiod v2** (Bookworm 64-bit officiel) avec fallback sur **lgpio**, puis mode simulation :

```bash
# Vérifier gpiod v2
python3 -c "import gpiod; print(gpiod.__version__)"

# Vérifier /dev/gpiochip0
ls -l /dev/gpiochip0

# Logs GPIO
journalctl -u rpi-plc -n 30 | grep -i gpio
```

### Service systemd

```bash
sudo systemctl start   rpi-plc
sudo systemctl stop    rpi-plc
sudo systemctl restart rpi-plc
sudo systemctl status  rpi-plc
journalctl -u rpi-plc -f
```

---

## Interface SCADA — 11 onglets

Accessible via `http://<ip-rpi>:5000/scada` :

| Onglet | Contenu |
|---|---|
| 🗺 Synoptique | Vue opérateur temps réel avec widgets |
| 🌡 Températures | Toutes les sondes avec alarmes |
| 📈 Historique | Courbes et mini-graphes par canal |
| 🎛 Commandes | Consignes RF, sorties manuelles, bits M |
| 🔔 Alarmes | Alarmes actives + historique |
| ⚙ Système | État PLC, réglage scan, registres RF |
| 📋 Recettes | Profils de consignes (créer/appliquer/snapshot) |
| 💾 Sauvegardes | Versions du programme (20 versions, auto-backup) |
| ✈ Telegram | Configuration et test du bot |
| 🔒 Sécurité | Login, mot de passe, HTTPS TLS |
| 🔧 Calibration | Offset/gain/alarmes par sonde |

---

## Synoptique opérateur

Accessible via `🖥 Synoptique` (F8). Éditeur canvas HTML5 avec :

### Widgets disponibles

| Widget | Description |
|---|---|
| Thermomètre | Valeur analogique avec barre de progression et alarmes |
| Jauge circulaire | Valeur analogique en arc |
| Barre de niveau | Valeur analogique verticale/horizontale |
| Courbe tendance | Historique temps réel |
| Valeur numérique | Affichage numérique avec unité |
| Relais ON/OFF | État booléen avec bouton |
| Consigne | Valeur réglable par slider |
| Bouton action | Démarrer/arrêter PLC, forcer bit M |
| Interrupteur M | Toggle bit mémoire |
| Voyant alarme | LED colorée |
| Texte libre | Label |
| Rectangle | Zone décorative |
| Tuyauterie | Ligne de tuyau |
| Image | Import PNG/JPG |
| Symbole P&ID | Bibliothèque de 30 symboles industriels |
| **Naviguer page** | Bouton de navigation vers une autre page (ou popup) du synoptique |
| **Bouton Retour** | Bouton libre — retourne à la page précédente |

### Symboles animés (8 équipements)

Symboles SVG animés liés à un bit M/GPIO :

- **Chaudière** — flamme + fumée + vis animées
- **Circulateur** — roue qui tourne
- **Pompe** — hélice + flux
- **Échangeur** — flux entrant/sortant
- **Vanne** — volet rotatif
- **Ballon** — niveau liquide animé
- **Panneau solaire** — rayons pulsants
- **Pompe à chaleur** — cycle thermodynamique

### Pages multiples et navigation

Le synoptique supporte plusieurs pages indépendantes avec barre d'onglets.

| Action | Comment |
|---|---|
| Naviguer | Cliquer un onglet de page |
| Ajouter page normale | Bouton `+` dans la barre (mode édition) |
| Ajouter sous-menu popup | Bouton `⊞` violet dans la barre (mode édition) |
| Supprimer | Bouton `✕` sur l'onglet (mode édition) |
| Renommer | Double-clic sur l'onglet (mode édition) |

#### Barre de navigation fixe

Activée via `⊟ Nav` : affiche ← Retour, fil d'ariane cliquable (`Vue principale › Chaudière`), bouton ⌂.

---

## Déploiement SSH

1. `🚀 Déployer` (F7)
2. Renseigner : IP, utilisateur, mot de passe ou clé SSH

### Connexion sans mot de passe

```bash
# Dans la fenêtre Déployer
# 1. Cliquer "Générer clé SSH"  → crée ~/.ssh/rpi_plc_id_ed25519
# 2. Cliquer "Copier clé sur RPi"  → entrer le mot de passe une fois
# Les déploiements suivants sont sans mot de passe
```

---

## Persistance Backup

Les valeurs `BACKUP` sont sauvegardées dans `~/.rpi-plc-studio/backup_store.json` :

- Sauvegarde automatique toutes les **30 secondes** pendant le scan
- Sauvegarde à l'**arrêt** du moteur (`■ STOP`)
- Rechargement automatique au **démarrage** du moteur
- Accepte des valeurs flottantes **et** des booléens (0.0 / 1.0)

---

## Bot Telegram

Configuration dans `rpi_server/config.json` → section `"telegram"` :

```json
{
  "telegram": {
    "enabled": true,
    "token": "123456:ABC-your-token",
    "chat_ids": ["123456789"],
    "alarm_high": 85.0,
    "alarm_low": 3.0,
    "report_hour": 8,
    "report_enabled": true
  }
}
```

Commandes disponibles : `/status`, `/temp`, `/relais`, `/on K1`, `/off K1`, `/start`, `/stop`, `/consigne RF0 75.5`, `/recette NomRecette`, `/log`, `/aide`.

---

## Raccourcis clavier

### Application principale (Qt)

| Touche | Action |
|---|---|
| `F5` | Démarrer la simulation |
| `F6` | Arrêter la simulation |
| `F7` | Déployer vers le RPi |
| `F8` | Ouvrir le synoptique |
| `Ctrl+S` | Enregistrer |
| `Ctrl+N` | Nouveau projet |
| `Ctrl+O` | Ouvrir un projet |
| `Ctrl+G` | Configurateur GPIO (menu Raspberry Pi) |

### Canvas FBD

| Touche | Action |
|---|---|
| `F` | Ajuster la vue (fitView) |
| `Suppr` | Supprimer le bloc/fil sélectionné |
| `←↑→↓` | Déplacer le bloc du pas de grille |
| `Ctrl+Z` | Annuler (40 niveaux) |
| `Ctrl+Y` | Rétablir |
| `Ctrl+A` | Tout sélectionner |
| `Ctrl+G` *(focus canvas)* | Grouper les blocs sélectionnés |
| `Ctrl+Maj+G` | Dégrouper le bloc GROUP sélectionné |
| Double-clic sur GROUP | Entrer dans le groupe |
| `Échap` | Sortir du groupe (retour niveau parent) |

### Synoptique

| Touche | Action |
|---|---|
| `Tab` | Basculer mode édition/vue opérateur |
| `Ctrl+D` | Dupliquer le widget sélectionné |
| `Ctrl+S` | Sauvegarder le synoptique |
| `Suppr` | Supprimer le widget sélectionné |
| `←↑→↓` | Déplacer le widget du pas de grille |

