# RPi-PLC Studio

Atelier de programmation PLC en **FBD** (Function Block Diagram) pour Raspberry Pi, avec déploiement à distance, supervision web (synoptique/SCADA) et pont domotique MQTT.

Conçu à l'origine pour piloter une installation de chauffage (solaire thermique + chaudière + plancher chauffant), mais utilisable pour tout automatisme à base de GPIO/I²C sur Raspberry Pi.

## Sommaire

- [Aperçu](#aperçu)
- [Architecture](#architecture)
- [Fonctionnalités](#fonctionnalités)
- [Installation](#installation)
- [Démarrage rapide](#démarrage-rapide)
- [Structure du dépôt](#structure-du-dépôt)
- [Déploiement](#déploiement)
- [Limitations connues](#limitations-connues)
- [Licence](#licence)

## Aperçu

RPi-PLC Studio se compose de deux applications distinctes :

- **Studio** (PC Linux, PyQt5) : éditeur graphique FBD pour construire la logique de l'automate, simulateur intégré, éditeur de synoptique, et gestion du déploiement SSH.
- **Serveur RPi** (Raspberry Pi, Flask) : exécute le programme compilé en temps réel, pilote les GPIO/ADS1115, expose une interface web de supervision, et communique avec des services externes (MQTT, Telegram).

Le programme est conçu sur PC dans le Studio, puis transféré sur le Raspberry Pi par SSH/SFTP en un clic.

## Architecture

```
┌─────────────────────────┐         SSH / SFTP          ┌──────────────────────────┐
│   RPi-PLC Studio (PC)    │ ───────────────────────────▶│   Serveur RPi (Flask)     │
│                          │                              │                          │
│  • Éditeur FBD (PyQt5)   │                              │  • Moteur PLC (scan 100ms)│
│  • Simulation locale     │                              │  • GPIO (gpiod/lgpio)     │
│  • Éditeur synoptique    │                              │  • ADS1115 (sondes NTC)   │
│  • core/deployer.py      │                              │  • Web SCADA + synoptique │
└─────────────────────────┘                              │  • Pont MQTT              │
                                                           │  • Notifications Telegram │
                                                           └──────────────────────────┘
                                                                       │
                                                                MQTT (broker externe)
                                                                       │
                                                          Home Assistant / Venus OS / etc.
```

## Fonctionnalités

- Éditeur FBD complet : blocs logiques (AND/OR/XOR/NOT…), temporisateurs, compteurs, bascules SR, PID, comparateurs, calculs analogiques, capteurs (PT100/PT1000/NTC), connecteurs inter-pages.
- Simulation locale dans le Studio avant tout déploiement.
- Synoptique web personnalisable (widgets température, jauges, commandes, courbes de tendance).
- Programmation horaire hebdomadaire (P5_JOURS) avec consignes par jour.
- Pont MQTT bidirectionnel (Subscribe/Publish) pour intégration domotique externe.
- Notifications Telegram (alarmes, rapport quotidien).
- Sauvegardes automatiques du programme à chaque déploiement.
- Diagnostic intelligent du Raspberry Pi avant déploiement (`smart_check`) : détecte les paquets manquants, les fichiers serveur obsolètes, et propose l'action adaptée (programme seul / mise à jour service / installation complète).

## Installation

### Studio (PC Linux — Ubuntu 22.04+, Debian 12+)

```bash
sudo apt install ./rpi-plc-studio_3.4-1.deb
```

ou depuis les sources :

```bash
sudo bash install-studio.sh
```

### Serveur (Raspberry Pi — Bookworm/Bullseye, 32 ou 64 bits)

```bash
sudo dpkg -i rpi-plc_3.4-serveur-arm64.deb && sudo apt-get install -f
```

ou depuis les sources :

```bash
sudo bash install.sh
```

Dépendances installées automatiquement : `python3-gpiod` (v2, GPIO natif Bookworm) ou `lgpio` en repli, `flask`, `flask-socketio`, `smbus2` (ADS1115), `requests`.

> **Pont MQTT (optionnel)** : `paho-mqtt` n'est pas installé automatiquement par `install.sh`. Si vous utilisez le bloc MQTT, installez-le manuellement sur le RPi : `pip3 install paho-mqtt --break-system-packages`.

## Démarrage rapide

1. Lancer le Studio, créer un nouveau projet ou ouvrir un `.plcproj` existant.
2. Construire la logique dans l'éditeur FBD (glisser-déposer depuis la palette).
3. Tester en simulation locale (bouton **START**).
4. Configurer la connexion SSH du Raspberry Pi (menu **Raspberry Pi → Déployer**).
5. Cliquer sur **🔍 Scanner réseau** puis **Analyser** pour un diagnostic automatique, ou directement **🚀 Déployer**.
6. Ouvrir l'interface web de supervision : `http://<ip-du-rpi>:5000/scada`.

## Structure du dépôt

```
.
├── core/                   # Moteur PLC (simulation) et logique de déploiement
│   ├── plc_engine.py       # Compilation FBD → exécution (utilisé par le Studio uniquement)
│   ├── deployer.py         # Connexion SSH/SFTP, smart_check, deploy()/deploy_prog_only()
│   └── project.py          # Sérialisation des fichiers .plcproj
├── ui/                     # Interface PyQt5 du Studio
│   ├── main_window.py
│   ├── block_editor.py     # Compilation des blocs FBD → JSON
│   ├── fbd_canvas.js       # Canvas FBD (HTML/JS embarqué via QWebEngine)
│   ├── synoptic_canvas.js  # Éditeur de synoptique
│   ├── deploy_dialog.py    # Fenêtre de déploiement
│   └── rpi_monitor.py      # Monitoring temps réel du RPi connecté
├── rpi_server/             # Tout ce qui s'exécute réellement sur le Raspberry Pi
│   ├── server.py           # Serveur Flask + moteur PLC temps réel (le vrai moteur en prod)
│   ├── mqtt_bridge.py       # Pont MQTT Subscribe/Publish
│   ├── telegram_bot.py
│   ├── auth.py / backup_manager.py / recipes.py / calibration.py / report_generator.py
│   ├── templates/          # Pages web (SCADA, synoptique desktop/mobile)
│   ├── static/             # JS/CSS/icônes servis par Flask
│   └── rpi-plc.service     # Unit systemd
├── resources/              # Thèmes Qt, icônes, documentation HTML
├── install.sh               # Installation serveur RPi depuis les sources
├── install-studio.sh        # Installation Studio PC depuis les sources
└── *.deb                    # Paquets pré-construits (arm64 + amd64)
```

> **Point d'attention architectural** : `core/plc_engine.py` (et sa copie dans `resources/`) ne sert qu'à la **simulation locale dans le Studio**. Le moteur qui tourne réellement en production sur le Raspberry Pi est une classe `PLCEngine` distincte, intégrée directement dans `rpi_server/server.py`. Toute correction de la logique d'exécution doit être appliquée aux **deux** endroits si elle doit être visible en simulation *et* en production.

## Déploiement

Le Studio propose deux modes, tous deux gérés par `core/deployer.py` :

| Mode | Déclenché par | Transfère |
|---|---|---|
| **Programme seul** | `deploy_prog_only()` | `programme.json`, `synoptic.json`, `config.json` (fusion GPIO/sondes), et **tous les fichiers de `SERVER_FILES`** (mise à jour silencieuse si nécessaire) |
| **Complet** | `deploy()` | Idem + arrêt propre du service, libération GPIO, redémarrage du serveur |

`smart_check()` analyse le Raspberry Pi avant déploiement (OS, GPIO, dépendances Python, fichiers serveur présents/à jour, état du service) et recommande l'action adaptée.

> **⚠ Ajouter un nouveau fichier serveur** (ex. un futur `xyz_bridge.py` dans `rpi_server/`) **ne suffit pas** à le faire déployer automatiquement : il doit explicitement être ajouté à la liste `SERVER_FILES` en tête de `core/deployer.py`, sinon aucun bouton de déploiement ne le transférera jamais, même après des dizaines de déploiements répétés.

## Limitations connues

- `install.sh` ne vérifie/installe pas `paho-mqtt` automatiquement (à faire manuellement si le bloc MQTT est utilisé).
- Le moteur de simulation Studio (`core/plc_engine.py`) et le moteur de production (`rpi_server/server.py`) sont deux implémentations distinctes qui doivent être maintenues en parallèle.
- `smart_check()` compare les fichiers par **taille** (pas par hash) — un fichier modifié mais de taille identique au fichier distant ne sera pas détecté comme obsolète.

## Licence

[GPLv3](LICENSE) (GNU General Public License v3.0).

Concrètement : n'importe qui peut utiliser, étudier et modifier le code librement, y compris à des fins commerciales — mais toute version modifiée ou redistribuée doit rester sous GPLv3 et son code source doit être fourni aux destinataires. Il est donc impossible pour un tiers de prendre ce projet, de le fermer, et de le revendre sans en redonner le code source.
