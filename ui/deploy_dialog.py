"""
ui/deploy_dialog.py — Fenêtre de déploiement SSH vers le Raspberry Pi
Enrichie avec : monitoring post-déploiement, config avancée, scan réseau
"""

import os
import json
import threading
from PyQt5.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QFormLayout,
    QScrollArea,
    QLabel, QLineEdit, QPushButton, QTextEdit,
    QGroupBox, QFileDialog, QProgressBar, QSpinBox,
    QTabWidget, QWidget, QCheckBox, QDialogButtonBox, QDoubleSpinBox,
    QTableWidget, QTableWidgetItem, QHeaderView, QSplitter,
    QFrame, QComboBox, QMessageBox
)
from PyQt5.QtCore import Qt, pyqtSignal, QObject, QTimer
from PyQt5.QtGui import QFont, QTextCursor, QColor


class LogSignal(QObject):
    """Signal thread-safe pour envoyer des logs vers l'UI."""
    message = pyqtSignal(str)
    done    = pyqtSignal(bool, str)
    status  = pyqtSignal(dict)   # pour le monitoring


class DeployDialog(QDialog):
    """Fenêtre modale de déploiement SSH."""

    deploy_done = pyqtSignal(bool)

    def __init__(self, rpi_config: dict, program: list, parent=None,
                 synoptic: dict = None):
        super().__init__(parent)
        self.rpi_config  = dict(rpi_config)
        self.program     = program
        self.synoptic    = synoptic or {}   # synoptique à déployer
        self.deployer    = None
        self._sig        = LogSignal()
        self._sig.message.connect(self._append_log)
        self._sig.done.connect(self._on_done)
        self._sig.status.connect(self._update_status)
        self._monitor_timer = QTimer()
        self._monitor_timer.timeout.connect(self._poll_status)

        self.setWindowTitle("Déploiement vers Raspberry Pi")
        self.setMinimumWidth(660)
        self.setMinimumHeight(640)
        self.resize(700, 750)
        self._build_ui()

    def _build_ui(self):
        lay = QVBoxLayout(self)
        lay.setSpacing(8)
        lay.setContentsMargins(10, 10, 10, 10)

        tabs = QTabWidget()

        # ── Onglet 1 : Configuration SSH ─────────────────────────────────────
        cfg_tab = QWidget()
        form = QFormLayout(cfg_tab)
        form.setContentsMargins(14, 14, 14, 14)
        form.setSpacing(10)

        self.host_edit = QLineEdit(self.rpi_config.get("host", "192.168.1.100"))
        self.host_edit.setPlaceholderText("ex: 192.168.1.100 ou raspberrypi.local")
        form.addRow("Adresse IP / Hostname :", self.host_edit)

        self.port_spin = QSpinBox()
        self.port_spin.setRange(1, 65535)
        self.port_spin.setValue(self.rpi_config.get("port", 22))
        form.addRow("Port SSH :", self.port_spin)

        self.user_edit = QLineEdit(self.rpi_config.get("user", "pi"))
        form.addRow("Utilisateur :", self.user_edit)

        self.pass_edit = QLineEdit(self.rpi_config.get("password", ""))
        self.pass_edit.setEchoMode(QLineEdit.Password)
        self.pass_edit.setPlaceholderText("Laisser vide si clé SSH")
        form.addRow("Mot de passe :", self.pass_edit)

        key_row = QHBoxLayout()
        self.key_edit = QLineEdit(self.rpi_config.get("key_path", ""))
        self.key_edit.setPlaceholderText("Optionnel : chemin vers la clé privée SSH")
        key_btn = QPushButton("…")
        key_btn.setFixedWidth(32)
        key_btn.clicked.connect(self._browse_key)
        key_row.addWidget(self.key_edit)
        key_row.addWidget(key_btn)
        form.addRow("Clé SSH :", key_row)

        self.dir_edit = QLineEdit(self.rpi_config.get("remote_dir", "/home/pi/rpi-plc"))
        form.addRow("Dossier distant :", self.dir_edit)

        self.web_port_spin = QSpinBox()
        self.web_port_spin.setRange(1024, 65535)
        self.web_port_spin.setValue(self.rpi_config.get("web_port", 5000))
        form.addRow("Port web SCADA :", self.web_port_spin)

        # Info programme
        info_box = QGroupBox("Programme à déployer")
        info_lay = QHBoxLayout(info_box)
        # Format multi-pages ou liste plate
        if isinstance(self.program, dict) and "pages" in self.program:
            pg_list = self.program["pages"]
            blocs = sum(len(p.get("blocks",[])) for p in pg_list)
            pages = len(pg_list)
        else:
            blocs = len(self.program) if self.program else 0
            pages = len(set(b.get("page","P1") for b in (self.program or [])))
        # Synoptique multi-pages
        if isinstance(self.synoptic, dict) and "pages" in self.synoptic:
            syn_count = sum(len(p.get("widgets",[]))
                            for p in self.synoptic["pages"])
        else:
            syn_count = len(self.synoptic.get("widgets", []))
        info_text = f"📦  {blocs} bloc(s)  ·  {pages} page(s)"
        if syn_count:
            info_text += f"  ·  🖥 {syn_count} widget(s) synoptique"
        info_lay.addWidget(QLabel(info_text))
        form.addRow(info_box)

        # Boutons SSH
        ssh_row = QHBoxLayout()
        gen_btn  = QPushButton("🔑 Générer clé SSH")
        gen_btn.clicked.connect(self._generate_key)
        copy_btn = QPushButton("📋 Copier clé sur RPi")
        copy_btn.clicked.connect(self._copy_key)
        scan_btn = QPushButton("🔍 Scanner réseau")
        scan_btn.clicked.connect(self._scan_network)
        ssh_row.addWidget(gen_btn)
        ssh_row.addWidget(copy_btn)
        ssh_row.addWidget(scan_btn)
        ssh_row.addStretch()
        form.addRow("", ssh_row)

        tabs.addTab(cfg_tab, "⚙ Config SSH")

        # ── Onglet 2 : Journal ────────────────────────────────────────────────
        log_tab = QWidget()
        log_lay = QVBoxLayout(log_tab)
        log_lay.setContentsMargins(6, 6, 6, 6)
        self.log_edit = QTextEdit()
        self.log_edit.setReadOnly(True)
        self.log_edit.setFont(QFont("JetBrains Mono", 9))
        log_lay.addWidget(self.log_edit)
        tabs.addTab(log_tab, "📋 Journal")

        # ── Onglet 3 : Monitoring RPi ─────────────────────────────────────────
        mon_tab = QWidget()
        mon_lay = QVBoxLayout(mon_tab)
        mon_lay.setContentsMargins(10, 10, 10, 10)
        mon_lay.setSpacing(8)

        # URL SCADA
        url_row = QHBoxLayout()
        self.url_label = QLabel("URL : —")
        self.url_label.setStyleSheet("color: #58a6ff; font-size: 13px;")
        self.open_btn  = QPushButton("🌐 Ouvrir SCADA")
        self.open_btn.clicked.connect(self._open_scada)
        self.open_btn.setEnabled(False)
        url_row.addWidget(self.url_label)
        url_row.addStretch()
        url_row.addWidget(self.open_btn)
        mon_lay.addLayout(url_row)

        # Tableau de statut
        self.status_table = QTableWidget(0, 2)
        self.status_table.setHorizontalHeaderLabels(["Indicateur", "Valeur"])
        self.status_table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeToContents)
        self.status_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.status_table.setMaximumHeight(200)
        self.status_table.verticalHeader().setVisible(False)
        mon_lay.addWidget(self.status_table)

        # Températures en direct
        temp_group = QGroupBox("🌡 Températures en direct")
        temp_lay   = QVBoxLayout(temp_group)
        self.temp_table = QTableWidget(0, 3)
        self.temp_table.setHorizontalHeaderLabels(["Sonde", "Température", "État"])
        self.temp_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.temp_table.verticalHeader().setVisible(False)
        temp_lay.addWidget(self.temp_table)
        mon_lay.addWidget(temp_group)

        # Boutons monitoring
        mon_btn_row = QHBoxLayout()
        self.refresh_btn = QPushButton("⟳ Actualiser")
        self.refresh_btn.clicked.connect(self._poll_status)
        self.refresh_btn.setEnabled(False)
        self.auto_refresh = QCheckBox("Actualisation auto (5s)")
        self.auto_refresh.toggled.connect(self._toggle_auto_refresh)
        mon_btn_row.addWidget(self.refresh_btn)
        mon_btn_row.addWidget(self.auto_refresh)
        mon_btn_row.addStretch()
        mon_lay.addLayout(mon_btn_row)
        mon_lay.addStretch()

        tabs.addTab(mon_tab, "📡 Monitoring")

        # ── Onglet 4 : Config avancée (dans un QScrollArea) ─────────────────
        adv_scroll = QScrollArea()
        adv_scroll.setWidgetResizable(True)
        adv_scroll.setFrameShape(QScrollArea.NoFrame)
        adv_tab_inner = QWidget()
        adv_lay = QVBoxLayout(adv_tab_inner)
        adv_lay.setContentsMargins(14, 14, 14, 14)
        adv_lay.setSpacing(12)

        # Scan time
        scan_group = QGroupBox("Moteur PLC")
        scan_form  = QFormLayout(scan_group)
        self.scan_ms_spin = QSpinBox()
        self.scan_ms_spin.setRange(10, 5000)
        self.scan_ms_spin.setValue(self.rpi_config.get("scan_time_ms", 100))
        self.scan_ms_spin.setSuffix(" ms")
        scan_form.addRow("Période de scan :", self.scan_ms_spin)
        self.autostart_cb = QCheckBox("Démarrage automatique au boot")
        self.autostart_cb.setChecked(self.rpi_config.get("auto_start", True))
        scan_form.addRow(self.autostart_cb)
        adv_lay.addWidget(scan_group)

        # Sécurité
        sec_group = QGroupBox("Sécurité SCADA")
        sec_form  = QFormLayout(sec_group)
        self.sec_enabled_cb = QCheckBox("Activer le login")
        self.sec_enabled_cb.setChecked(
            self.rpi_config.get("security", {}).get("enabled", False))
        sec_form.addRow(self.sec_enabled_cb)
        self.sec_user_edit = QLineEdit(
            self.rpi_config.get("security", {}).get("username", "admin"))
        sec_form.addRow("Utilisateur :", self.sec_user_edit)
        self.sec_pass_edit = QLineEdit(
            self.rpi_config.get("security", {}).get("password", "plc1234"))
        self.sec_pass_edit.setEchoMode(QLineEdit.Password)
        sec_form.addRow("Mot de passe SCADA :", self.sec_pass_edit)
        adv_lay.addWidget(sec_group)

        # Telegram
        tg_group = QGroupBox("🤖 Bot Telegram — Alertes & commandes")
        tg_lay   = QVBoxLayout(tg_group)
        tg_form  = QFormLayout()
        tg_form.setLabelAlignment(Qt.AlignRight)
        tg_form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
        tg_form.setRowWrapPolicy(QFormLayout.DontWrapRows)

        self.tg_enabled_cb = QCheckBox("Activer le bot Telegram")
        self.tg_enabled_cb.setChecked(
            self.rpi_config.get("telegram", {}).get("enabled", False))
        tg_form.addRow(self.tg_enabled_cb)

        # Token avec bouton afficher/masquer — sans removeRow (incompatible PyQt5 < 5.13)
        self.tg_token_edit = QLineEdit(
            self.rpi_config.get("telegram", {}).get("token", ""))
        self.tg_token_edit.setEchoMode(QLineEdit.Password)
        self.tg_token_edit.setPlaceholderText("123456789:ABCdef... (obtenir via @BotFather)")
        self.tg_show_btn = QPushButton("👁")
        self.tg_show_btn.setFixedWidth(30)
        self.tg_show_btn.setCheckable(True)
        self.tg_show_btn.setToolTip("Afficher/masquer le token")
        self.tg_show_btn.toggled.connect(
            lambda on: self.tg_token_edit.setEchoMode(
                QLineEdit.Normal if on else QLineEdit.Password))
        tg_token_row = QHBoxLayout()
        tg_token_row.setSpacing(4)
        tg_token_row.addWidget(self.tg_token_edit)
        tg_token_row.addWidget(self.tg_show_btn)
        tg_form.addRow("Token bot :", tg_token_row)

        # Chat IDs
        tg_cfg = self.rpi_config.get("telegram", {})
        chat_ids_raw = tg_cfg.get("chat_ids", [])
        self.tg_chatids_edit = QLineEdit(", ".join(str(c) for c in chat_ids_raw))
        self.tg_chatids_edit.setPlaceholderText("123456789, 987654321 (séparer par virgule)")
        tg_form.addRow("Chat ID(s) :", self.tg_chatids_edit)

        # Seuils alarmes
        self.tg_alarm_high_spin = QDoubleSpinBox()
        self.tg_alarm_high_spin.setRange(20, 150)
        self.tg_alarm_high_spin.setSuffix(" °C")
        self.tg_alarm_high_spin.setValue(float(tg_cfg.get("alarm_high", 90.0)))
        tg_form.addRow("Alarme haute :", self.tg_alarm_high_spin)

        self.tg_alarm_low_spin = QDoubleSpinBox()
        self.tg_alarm_low_spin.setRange(-30, 30)
        self.tg_alarm_low_spin.setSuffix(" °C")
        self.tg_alarm_low_spin.setValue(float(tg_cfg.get("alarm_low", 2.0)))
        tg_form.addRow("Alarme gel :", self.tg_alarm_low_spin)

        self.tg_alarm_cooldown = QSpinBox()
        self.tg_alarm_cooldown.setRange(60, 3600)
        self.tg_alarm_cooldown.setSuffix(" s")
        self.tg_alarm_cooldown.setValue(int(tg_cfg.get("alarm_cooldown_s", 600)))
        tg_form.addRow("Anti-spam alarmes :", self.tg_alarm_cooldown)

        # Notifications relais et PLC
        self.tg_notify_relays_cb = QCheckBox("Notifier les changements d'état relais")
        self.tg_notify_relays_cb.setChecked(tg_cfg.get("notify_relays", True))
        tg_form.addRow(self.tg_notify_relays_cb)

        self.tg_relay_cooldown = QSpinBox()
        self.tg_relay_cooldown.setRange(5, 300)
        self.tg_relay_cooldown.setSuffix(" s")
        self.tg_relay_cooldown.setValue(int(tg_cfg.get("relay_cooldown_s", 30)))
        tg_form.addRow("Anti-spam relais :", self.tg_relay_cooldown)

        self.tg_notify_plc_cb = QCheckBox("Notifier démarrage/arrêt PLC")
        self.tg_notify_plc_cb.setChecked(tg_cfg.get("notify_plc", True))
        tg_form.addRow(self.tg_notify_plc_cb)

        # Rapport quotidien
        self.tg_report_cb = QCheckBox("Rapport quotidien (températures + relais + consignes)")
        self.tg_report_cb.setChecked(tg_cfg.get("report_enabled", True))
        tg_form.addRow(self.tg_report_cb)

        self.tg_report_hour_spin = QSpinBox()
        self.tg_report_hour_spin.setRange(0, 23)
        self.tg_report_hour_spin.setSuffix(" h")
        self.tg_report_hour_spin.setValue(int(tg_cfg.get("report_hour", 8)))
        tg_form.addRow("Heure rapport :", self.tg_report_hour_spin)

        tg_lay.addLayout(tg_form)

        # Instructions + bouton test
        tg_help = QLabel(
            "<small><b>Comment configurer :</b><br>"
            "1. Créer un bot via <b>@BotFather</b> → /newbot → copier le token<br>"
            "2. Envoyer un message au bot → aller sur<br>"
            "&nbsp;&nbsp;<tt>api.telegram.org/bot<i>TOKEN</i>/getUpdates</tt><br>"
            "3. Copier le <b>chat.id</b> et le coller dans Chat ID(s)</small>"
        )
        tg_help.setWordWrap(True)
        tg_help.setStyleSheet("color:#8b949e; padding:4px;")
        tg_lay.addWidget(tg_help)

        tg_test_btn = QPushButton("📨 Tester la connexion Telegram")
        tg_test_btn.clicked.connect(self._test_telegram)
        tg_lay.addWidget(tg_test_btn)

        adv_lay.addWidget(tg_group)

        # ── Groupe Email SMTP ─────────────────────────────────────────────
        email_group = QGroupBox("📧 Alertes Email SMTP (en complément Telegram)")
        email_lay   = QVBoxLayout(email_group)
        email_form  = QFormLayout()
        email_form.setLabelAlignment(Qt.AlignRight)
        email_form.setFieldGrowthPolicy(QFormLayout.ExpandingFieldsGrow)
        email_form.setRowWrapPolicy(QFormLayout.DontWrapRows)

        email_cfg = self.rpi_config.get("email", {})

        self.email_enabled_cb = QCheckBox("Activer les alertes email")
        self.email_enabled_cb.setChecked(email_cfg.get("enabled", False))
        email_form.addRow(self.email_enabled_cb)

        self.email_smtp_edit = QLineEdit(email_cfg.get("smtp_host", "smtp.gmail.com"))
        email_form.addRow("Serveur SMTP :", self.email_smtp_edit)

        self.email_port_spin = QSpinBox()
        self.email_port_spin.setRange(1, 65535)
        self.email_port_spin.setValue(int(email_cfg.get("smtp_port", 587)))
        email_form.addRow("Port SMTP :", self.email_port_spin)

        self.email_user_edit = QLineEdit(email_cfg.get("user", ""))
        self.email_user_edit.setPlaceholderText("votre@gmail.com")
        email_form.addRow("Utilisateur :", self.email_user_edit)

        self.email_pass_edit = QLineEdit(email_cfg.get("password", ""))
        self.email_pass_edit.setEchoMode(QLineEdit.Password)
        self.email_pass_edit.setPlaceholderText("Mot de passe ou App Password Google")
        email_form.addRow("Mot de passe :", self.email_pass_edit)

        self.email_to_edit = QLineEdit(", ".join(email_cfg.get("to", [])))
        self.email_to_edit.setPlaceholderText("dest1@mail.com, dest2@mail.com")
        email_form.addRow("Destinataire(s) :", self.email_to_edit)

        self.email_prefix_edit = QLineEdit(email_cfg.get("subject_prefix", "[RPi-PLC]"))
        email_form.addRow("Préfixe sujet :", self.email_prefix_edit)

        email_lay.addLayout(email_form)

        email_help = QLabel(
            "<small><b>Gmail :</b> Activer la validation en 2 étapes puis créer un "
            "<b>App Password</b> dans Compte Google → Sécurité.<br>"
            "Serveur : smtp.gmail.com · Port : 587</small>"
        )
        email_help.setWordWrap(True)
        email_help.setStyleSheet("color:#8b949e; padding:4px;")
        email_lay.addWidget(email_help)

        email_test_btn = QPushButton("📨 Tester l'envoi email")
        email_test_btn.clicked.connect(self._test_email)
        email_lay.addWidget(email_test_btn)

        adv_lay.addWidget(email_group)

        save_adv_btn = QPushButton("💾 Générer config.json et déployer")
        save_adv_btn.clicked.connect(self._deploy_with_config)
        adv_lay.addWidget(save_adv_btn)
        adv_lay.addStretch()

        adv_scroll.setWidget(adv_tab_inner)
        tabs.addTab(adv_scroll, "🔧 Avancé")

        lay.addWidget(tabs)
        self.tabs = tabs

        # ── Barre de progression ──────────────────────────────────────────────
        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        lay.addWidget(self.progress)

        # ── Boutons principaux ────────────────────────────────────────────────
        btn_row = QHBoxLayout()
        self.test_btn = QPushButton("🔌 Tester")
        self.test_btn.clicked.connect(self._test_connection)
        btn_row.addWidget(self.test_btn)
        self.check_btn = QPushButton("🔍 Analyser RPi")
        self.check_btn.setToolTip("Vérifie le RPi et propose le déploiement adapté (complet ou programme seul)")
        self.check_btn.clicked.connect(self._run_smart_check)
        btn_row.addWidget(self.check_btn)
        self.diag_btn = QPushButton("🩺 Diagnostic")
        self.diag_btn.setToolTip("Vérifications complètes : service, port, fichiers, log RPi…")
        self.diag_btn.clicked.connect(self._run_diagnostic)
        btn_row.addWidget(self.diag_btn)
        btn_row.addStretch()
        self.cancel_btn = QPushButton("Fermer")
        self.cancel_btn.clicked.connect(self.reject)
        btn_row.addWidget(self.cancel_btn)
        self.deploy_btn = QPushButton("🚀 Déployer complet")
        self.deploy_btn.setObjectName("btn_deploy")
        self.deploy_btn.clicked.connect(self._start_deploy)
        btn_row.addWidget(self.deploy_btn)
        self.prog_btn = QPushButton("⚡ Programme seul")
        self.prog_btn.setToolTip("Envoie uniquement le programme et le synoptique (RPi déjà configuré)")
        self.prog_btn.setStyleSheet("background-color: #1a2f45; color: #58a6ff;")
        self.prog_btn.clicked.connect(self._deploy_prog_only)
        btn_row.addWidget(self.prog_btn)
        lay.addLayout(btn_row)

    # ── Config ────────────────────────────────────────────────────────────────
    def _get_config(self) -> dict:
        return {
            "host":         self.host_edit.text().strip(),
            "port":         self.port_spin.value(),
            "user":         self.user_edit.text().strip(),
            "password":     self.pass_edit.text(),
            "key_path":     self.key_edit.text().strip(),
            "remote_dir":   self.dir_edit.text().strip(),
            "web_port":     self.web_port_spin.value(),
            "scan_time_ms": self.scan_ms_spin.value(),
            "auto_start":   self.autostart_cb.isChecked(),
            "security": {
                "enabled":  self.sec_enabled_cb.isChecked(),
                "username": self.sec_user_edit.text().strip(),
                "password": self.sec_pass_edit.text(),
            },
            "telegram": self._get_telegram_config(),
            "email":    self._get_email_config(),
        }

    def _get_telegram_config(self) -> dict:
        """Retourne la config Telegram — omet le token s'il est vide pour préserver l'existant."""
        token = self.tg_token_edit.text().strip()
        cfg = {
            "enabled":          self.tg_enabled_cb.isChecked(),
            "chat_ids":         [c.strip() for c in self.tg_chatids_edit.text().split(",") if c.strip()],
            "alarm_high":       self.tg_alarm_high_spin.value(),
            "alarm_low":        self.tg_alarm_low_spin.value(),
            "alarm_cooldown_s": self.tg_alarm_cooldown.value(),
            "notify_relays":    self.tg_notify_relays_cb.isChecked(),
            "relay_cooldown_s": self.tg_relay_cooldown.value(),
            "notify_plc":       self.tg_notify_plc_cb.isChecked(),
            "report_enabled":   self.tg_report_cb.isChecked(),
            "report_hour":      self.tg_report_hour_spin.value(),
        }
        if token:   # n'inclure le token que s'il est rempli
            cfg["token"] = token
        return cfg

    def _browse_key(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Clé SSH privée", os.path.expanduser("~/.ssh"), "Tous (*)")
        if path:
            self.key_edit.setText(path)

    # ── Actions SSH ───────────────────────────────────────────────────────────
    def _build_deployer(self):
        from core.deployer import RPiDeployer
        cfg = self._get_config()
        return RPiDeployer(
            host=cfg["host"], port=cfg["port"], user=cfg["user"],
            password=cfg["password"], key_path=cfg["key_path"],
            remote_dir=cfg["remote_dir"],
            log_cb=lambda m: self._sig.message.emit(m),
        )

    def _test_connection(self):
        self.tabs.setCurrentIndex(1)
        self._append_log("🔌 Test de connexion SSH…")
        self._set_busy(True)
        d = self._build_deployer()

        def _run():
            r = d.connect()
            if r.success:
                _, out, _ = d.run("uname -a && python3 --version && hostname -I")
                self._sig.message.emit(f"[OK] {out.strip()}")
                # Activer le monitoring
                cfg = self._get_config()
                url = f"http://{cfg['host']}:{cfg['web_port']}/scada"
                self._sig.message.emit(f"[WEB] {url}")
            self._sig.done.emit(r.success, r.message)

        threading.Thread(target=_run, daemon=True).start()

    def _start_deploy(self):
        self.tabs.setCurrentIndex(1)
        self._set_busy(True)
        cfg = getattr(self, "_deploy_cfg", None) or self._get_config()
        self._deploy_cfg = None  # reset
        self.rpi_config.update(cfg)
        d = self._build_deployer()
        synoptic = self.synoptic  # capture

        def _run():
            r = d.deploy(self.program, synoptic=synoptic,
                         extra_config={"telegram": cfg.get("telegram", {}),
                                       "security": cfg.get("security", {}),
                                       "scan_time_ms": cfg.get("scan_time_ms", 100),
                                       "auto_start": cfg.get("auto_start", True)})
            if r.success:
                # Activer le monitoring post-déploiement
                cfg2 = self._get_config()
                self._rpi_url = f"http://{cfg2['host']}:{cfg2['web_port']}"
                self._sig.message.emit(f"\n🌐 SCADA disponible : {self._rpi_url}/scada")
                self._sig.message.emit(f"🖥 Synoptique : {self._rpi_url}/synoptic")
                self._sig.message.emit(f"📱 PWA installable sur mobile")
            self._sig.done.emit(r.success, r.message)

        threading.Thread(target=_run, daemon=True).start()

    def _deploy_with_config(self):
        """Génère config.json et déploie."""
        cfg = self._get_config()
        self.rpi_config.update(cfg)

        # Charger le config.json existant et le mettre à jour
        try:
            from pathlib import Path
            base = Path(__file__).parent.parent / "rpi_server" / "config.json"
            if base.exists():
                existing = json.loads(base.read_text())
            else:
                existing = {}

            tg_cfg = cfg.get("telegram", {})
            existing.update({
                "scan_time_ms": cfg["scan_time_ms"],
                "web_port":     cfg["web_port"],
                "auto_start":   cfg["auto_start"],
                "security":     cfg["security"],
                "telegram":     tg_cfg,
            })

            # Sauvegarder dans config.json local (pour les prochains déploiements)
            base.write_text(json.dumps(existing, indent=2, ensure_ascii=False))
            self._append_log(
                f"[CONFIG] config.json local mis à jour "
                f"(scan={cfg['scan_time_ms']}ms, "
                f"telegram={'✅' if tg_cfg.get('enabled') else '—'})"
            )
        except Exception as e:
            self._append_log(f"[WARN] Impossible de mettre à jour config.json : {e}")

        self._deploy_cfg = self._get_config()  # sauvegarde pour _start_deploy
        self._start_deploy()

    def _get_email_config(self) -> dict:
        """Retourne la config email — omet le mot de passe si vide."""
        cfg = {
            "enabled":        self.email_enabled_cb.isChecked(),
            "smtp_host":      self.email_smtp_edit.text().strip(),
            "smtp_port":      self.email_port_spin.value(),
            "user":           self.email_user_edit.text().strip(),
            "to":             [t.strip() for t in self.email_to_edit.text().split(",") if t.strip()],
            "subject_prefix": self.email_prefix_edit.text().strip() or "[RPi-PLC]",
        }
        pwd = self.email_pass_edit.text()
        if pwd:
            cfg["password"] = pwd
        return cfg

    def _test_email(self):
        """Test d'envoi email depuis le dialog de configuration."""
        import requests as _req
        cfg   = self._get_config()
        host  = cfg.get("host", "")
        port  = cfg.get("web_port", 5000)
        url   = f"http://{host}:{port}/api/email/test"
        try:
            r = _req.post(url, timeout=20)
            data = r.json()
            if data.get("ok"):
                from PyQt5.QtWidgets import QMessageBox
                QMessageBox.information(self, "Email OK",
                    "✅ Email de test envoyé avec succès !")
            else:
                from PyQt5.QtWidgets import QMessageBox
                QMessageBox.warning(self, "Erreur email",
                    f"❌ {data.get('error', 'Erreur inconnue')}")
        except Exception as e:
            from PyQt5.QtWidgets import QMessageBox
            err_msg = "Impossible de contacter le RPi : " + str(e) + "\n\n"\
                      "Assurez-vous que le serveur RPi est démarré."
            QMessageBox.warning(self, "Erreur email", err_msg)

    def _test_telegram(self):
        """Teste la connexion Telegram dans un thread séparé (évite le freeze UI)."""
        token    = self.tg_token_edit.text().strip()
        chat_ids = [c.strip() for c in self.tg_chatids_edit.text().split(",") if c.strip()]
        if not token:
            QMessageBox.warning(self, "Telegram", "Token manquant.")
            return
        if not chat_ids:
            QMessageBox.warning(self, "Telegram", "Chat ID manquant.")
            return
        self._append_log("[TG] Test via le RPi (POST /api/telegram/test)…")
        self.tabs.setCurrentIndex(1)
        cfg2   = self._get_config()
        rpi_url = f"http://{cfg2['host']}:{cfg2.get('web_port',5000)}/api/telegram/test"

        def _run():
            import requests as _rq, json as _json
            try:
                r = _rq.post(rpi_url, timeout=15)
                # Vérifier le content-type avant de parser JSON
                ct = r.headers.get("Content-Type", "")
                if r.status_code >= 500:
                    self._sig.message.emit(
                        f"[TG] ❌ Erreur serveur RPi ({r.status_code}) — "
                        f"le server.py sur le RPi est peut-être l'ancienne version. "
                        f"Refaire un déploiement complet depuis PLC Studio."
                    )
                    return
                if "application/json" not in ct and not r.text.strip().startswith("{"):
                    self._sig.message.emit(
                        f"[TG] ❌ Réponse inattendue du RPi (non-JSON). "
                        f"Refaire un déploiement complet."
                    )
                    return
                data = r.json()
                if data.get("ok"):
                    chat_ids = data.get("chat_ids", [])
                    self._sig.message.emit(
                        f"[TG] ✅ Message test envoyé depuis le RPi !"
                        + (f" (chat_ids: {chat_ids})" if chat_ids else "")
                    )
                else:
                    err = data.get("error", "Erreur inconnue")
                    self._sig.message.emit(f"[TG] ❌ Erreur : {err}")
                    # Conseils selon l'erreur
                    if "chat not found" in err or "getUpdates" in err or "start" in err:
                        self._sig.message.emit(
                            "[TG] 💡 Solution : ouvrir Telegram → chercher ton bot "
                            "→ appuyer sur Démarrer ou envoyer /start → réessayer"
                        )
                    elif "Unauthorized" in err or "token" in err.lower():
                        self._sig.message.emit(
                            "[TG] 💡 Solution : vérifier le token dans "
                            "SCADA (192.168.1.49:5000/scada) → ✈ Telegram"
                        )
                    elif "desactive" in err or "désactivé" in err:
                        self._sig.message.emit(
                            "[TG] 💡 Solution : cocher 'Activer le bot' dans "
                            "SCADA → ✈ Telegram → 💾 Sauvegarder"
                        )
            except Exception as e:
                self._sig.message.emit(
                    f"[TG] ❌ Impossible de joindre le RPi ({rpi_url}): {e}"
                )

        import threading as _th
        _th.Thread(target=_run, daemon=True).start()

    def _generate_key(self):
        from core.deployer import RPiDeployer
        key_path = os.path.expanduser("~/.ssh/rpi_plc_id_ed25519")
        pub = RPiDeployer.generate_ssh_key(key_path)
        self.key_edit.setText(key_path)
        self._append_log(f"[SSH] Clé générée : {key_path}")
        self._append_log(f"[SSH] Clé publique :\n{pub}")

    def _copy_key(self):
        from core.deployer import RPiDeployer
        key_path = self.key_edit.text().strip()
        pub_file = key_path + ".pub"
        if not os.path.isfile(pub_file):
            self._append_log("[ERR] Aucune clé publique. Générer d'abord une clé SSH.")
            return
        pub = open(pub_file).read().strip()
        d = self._build_deployer()
        self._set_busy(True)

        def _run():
            r = d.connect()
            if r.success:
                r2 = d.copy_ssh_key(pub)
                self._sig.done.emit(r2.success, r2.message)
            else:
                self._sig.done.emit(False, r.message)

        threading.Thread(target=_run, daemon=True).start()

    def _scan_network(self):
        """Cherche des RPi sur le réseau local (ping sweep 192.168.x.x)."""
        self.tabs.setCurrentIndex(1)
        self._append_log("[SCAN] Recherche de RPi sur le réseau local (SSH:22)…")
        self._set_busy(True)

        def _run():
            import socket, concurrent.futures
            base = ".".join(self.host_edit.text().strip().split(".")[:3]) + "."
            if not all(c.isdigit() or c == "." for c in base):
                base = "192.168.1."

            found = []
            def _check(ip):
                try:
                    s = socket.socket()
                    s.settimeout(0.3)
                    if s.connect_ex((ip, 22)) == 0:
                        try:
                            hostname = socket.gethostbyaddr(ip)[0]
                        except Exception:
                            hostname = "?"
                        found.append((ip, hostname))
                    s.close()
                except Exception:
                    pass

            with concurrent.futures.ThreadPoolExecutor(max_workers=50) as ex:
                ex.map(_check, [f"{base}{i}" for i in range(1, 255)])

            if found:
                self._sig.message.emit(f"[SCAN] {len(found)} hôte(s) avec SSH trouvé(s) :")
                for ip, host in sorted(found):
                    self._sig.message.emit(f"  → {ip}  ({host})")
                    if "rasp" in host.lower() or "rpi" in host.lower():
                        self._sig.message.emit(f"     ★ Probable Raspberry Pi !")
            else:
                self._sig.message.emit(f"[SCAN] Aucun hôte SSH trouvé sur {base}0/24")

            self._sig.done.emit(True, "Scan terminé")

        threading.Thread(target=_run, daemon=True).start()

    # ── Monitoring ────────────────────────────────────────────────────────────
    def _open_scada(self):
        import webbrowser
        cfg = self._get_config()
        url = f"http://{cfg['host']}:{cfg['web_port']}/scada"
        webbrowser.open(url)

    def _toggle_auto_refresh(self, checked: bool):
        if checked:
            self._monitor_timer.start(5000)
            self._poll_status()
        else:
            self._monitor_timer.stop()

    def _poll_status(self):
        cfg = self._get_config()
        url = f"http://{cfg['host']}:{cfg['web_port']}/api/state"

        def _run():
            try:
                import urllib.request, json as _json
                with urllib.request.urlopen(url, timeout=3) as r:
                    data = _json.loads(r.read())
                    self._sig.status.emit(data)
            except Exception:
                pass

        threading.Thread(target=_run, daemon=True).start()

    def _update_status(self, data: dict):
        self.refresh_btn.setEnabled(True)
        self.open_btn.setEnabled(True)
        cfg = self._get_config()
        self.url_label.setText(f"URL : http://{cfg['host']}:{cfg['web_port']}/scada")

        # Tableau statut
        rows = [
            ("PLC",       "▶ RUN" if data.get("running") else "■ STOP"),
            ("Cycles",    f"{data.get('cycle', 0):,}"),
            ("Erreurs",   str(data.get("error_count", 0))),
            ("Mode",      "Matériel" if data.get("on_rpi") else "Simulation"),
            ("Sondes OK", f"{sum(1 for v in data.get('analog',{}).values() if v.get('celsius') is not None)}/12"),
        ]
        self.status_table.setRowCount(len(rows))
        for i, (k, v) in enumerate(rows):
            self.status_table.setItem(i, 0, QTableWidgetItem(k))
            item = QTableWidgetItem(v)
            if k == "PLC" and "RUN" in v:
                item.setForeground(QColor("#3fb950"))
            elif k == "Erreurs" and v != "0":
                item.setForeground(QColor("#f85149"))
            self.status_table.setItem(i, 1, item)

        # Tableau températures
        analog = data.get("analog", {})
        channels = sorted(analog.keys(), key=lambda x: int(x[3:]) if x[3:].isdigit() else 0)
        self.temp_table.setRowCount(len(channels))
        for i, ch in enumerate(channels):
            info = analog[ch]
            t    = info.get("celsius")
            name = info.get("name", ch)
            self.temp_table.setItem(i, 0, QTableWidgetItem(name))
            if t is not None:
                temp_item = QTableWidgetItem(f"{t:.1f} °C")
                color = "#f85149" if t > 85 else ("#d29922" if t > 50 else "#00d4ff")
                temp_item.setForeground(QColor(color))
                self.temp_table.setItem(i, 1, temp_item)
                state = "🔴 ALARME" if t > 85 else ("🟡 Chaud" if t > 50 else "🟢 Normal")
                self.temp_table.setItem(i, 2, QTableWidgetItem(state))
            else:
                self.temp_table.setItem(i, 1, QTableWidgetItem("N/C"))
                self.temp_table.setItem(i, 2, QTableWidgetItem("⚫ Hors-ligne"))

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _run_smart_check(self):
        """Analyse le RPi et propose l'action adaptée."""
        self.tabs.setCurrentIndex(1)
        self._append_log("\n🔍 Analyse intelligente du RPi en cours…")
        self._set_busy(True)
        d = self._build_deployer()
        synoptic = self.synoptic

        def _run():
            r = d.connect()
            if not r.success:
                self._sig.message.emit(f"❌ Connexion impossible : {r.message}")
                self._sig.done.emit(False, r.message)
                return
            check = d.smart_check()
            for line in check.get("lines", []):
                self._sig.message.emit(line)

            action = check.get("action", "full_install")

            # Proposer l'action adaptée via signal thread-safe
            self._sig.message.emit(f"\n{'─'*52}")
            if action == "prog_only":
                self._sig.message.emit("✅ RPi conforme — déploiement programme + config GPIO")
                # Déployer programme + synoptique + config.json (GPIO)
                r2 = d.deploy_prog_only(self.program, synoptic=synoptic)
                self._sig.done.emit(r2.success, r2.message)
            elif action == "update_server":
                self._sig.message.emit("🟡 Service à mettre à jour — déploiement complet recommandé")
                self._sig.done.emit(True, "Cliquez 🚀 Déployer complet pour mettre à jour")
            else:
                self._sig.message.emit("🔴 Installation complète nécessaire")
                self._sig.done.emit(True, "Cliquez 🚀 Déployer complet pour installer")

        threading.Thread(target=_run, daemon=True).start()

    def _deploy_prog_only(self):
        """Envoie uniquement programme.json + synoptic.json et redémarre le service."""
        self.tabs.setCurrentIndex(1)
        self._append_log("\n⚡ Déploiement programme seul…")
        self._set_busy(True)
        d = self._build_deployer()
        synoptic = self.synoptic

        def _run():
            r = d.connect()
            if not r.success:
                self._sig.done.emit(False, r.message)
                return
            r2 = d.deploy_prog_only(self.program, synoptic=synoptic)
            self._sig.done.emit(r2.success, r2.message)

        threading.Thread(target=_run, daemon=True).start()

    def _append_log(self, msg: str):
        self.log_edit.append(msg.rstrip())
        self.log_edit.moveCursor(QTextCursor.End)

    def _run_diagnostic(self):
        """Lance le diagnostic complet du RPi."""
        self.tabs.setCurrentIndex(1)
        sep = "─" * 50
        self._append_log(f"\n🔍 Diagnostic RPi en cours…\n{sep}")
        self._set_busy(True)
        d = self._build_deployer()

        def _run():
            r = d.connect()
            if not r.success:
                self._sig.message.emit(f"❌ Connexion impossible : {r.message}")
                self._sig.done.emit(False, r.message)
                return
            lines = d.diagnose()
            for line in lines:
                self._sig.message.emit(line)
            sep2 = "─" * 50
            self._sig.message.emit(f"\n{sep2}")
            self._sig.done.emit(True, "Diagnostic terminé")

        threading.Thread(target=_run, daemon=True).start()

    def _set_busy(self, busy: bool):
        self.progress.setVisible(busy)
        for btn in [self.deploy_btn, self.test_btn, self.prog_btn, self.check_btn]:
            btn.setEnabled(not busy)
        if hasattr(self, "diag_btn"):
            self.diag_btn.setEnabled(not busy)

    def _on_done(self, success: bool, msg: str):
        self._set_busy(False)
        self._append_log(f"\n{'✓' if success else '✗'} {msg}\n")
        # S'assurer que rpi_config contient la config complète (telegram inclus)
        # pour que main_window puisse la persister dans le projet
        if success:
            try:
                self.rpi_config.update(self._get_config())
            except Exception:
                pass
        self.deploy_done.emit(success)
        if success:
            self.tabs.setCurrentIndex(2)  # Aller au monitoring
            self.refresh_btn.setEnabled(True)
            self.open_btn.setEnabled(True)
            cfg = self._get_config()
            self.url_label.setText(
                f"URL : http://{cfg['host']}:{cfg['web_port']}/scada")
            self.auto_refresh.setChecked(True)  # Démarrer le monitoring auto
