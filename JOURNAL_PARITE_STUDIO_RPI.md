# Journal — Parité moteur studio (`core/plc_engine.py`) / moteur RPi (`rpi_server/server.py`)

Ce document reprend tout le travail fait pour vérifier et aligner le comportement du moteur
du RPi sur celui du studio, dans l'ordre où il a été fait. Il sert à reprendre le travail
plus tard sans tout refaire, et à ne pas perdre le fil des écarts encore ouverts.

**À faire avant toute nouvelle session sur ce sujet** : relire la section « Sujets ouverts »
ci-dessous, elle liste ce qui reste à faire ou à vérifier.

---

## Sujets ouverts (à reprendre en priorité)

| Sujet | État | Détail |
|---|---|---|
| `ramp` | non corrigé | La sortie DONE compare deux flottants à l'égalité exacte sur le RPi → peut s'activer un cycle trop tard. Signalé, jamais corrigé. À vérifier si un programme utilise `ramp` de façon sensible au timing. |
| `sel` | non corrigé | Avec l'entrée G non câblée, le RPi choisit IN1, le studio choisit IN0. Signalé, jamais corrigé. Aucun projet audité à ce jour n'utilise `SEL` sans G câblé. |
| `mux` | non corrigé | Le RPi ne lit l'index que dans un bit M et ne gère que 4 entrées ; avec un index en registre RF, il renvoie toujours IN0. Signalé, jamais corrigé. |
| `compare` avec l'opérateur `ne` | bug situé dans le **studio**, pas le RPi | L'éditeur écrit `ne`, le studio attend `neq` et renvoie toujours faux ; le RPi est correct sur ce point précis. Correctif proposé mais jamais appliqué : `core/plc_engine.py` et sa copie `resources/plc_engine.py`. |
| `pid`, `plancher`, `solar`, `carithm` | couverture faible | Peu de scénarios testés par rapport aux autres types. À creuser avant de s'appuyer dessus pour une nouvelle fonctionnalité. |
| Blocs hors `exec_block` (MQTT, pages) | jamais testés | `tests/parity_fuzz.py` ne compare que ce qui passe par `exec_block`. |
| Fichiers résiduels dans le projet | non nettoyés | `rpi_server/server.py.old`, `rpi_server/server_py.patch`, et les fichiers `.old` / « copie » dans `ui/` (`block_editor.py.old`, `block_editor copie.py`, `fbd_canvas.js.old`, `fbd_canvas copie.js`, `synoptic_canvas.js.old`, `synoptic_canvas copie.js`, `templates/synoptic.html.old`, `static/synoptic_canvas.js.old`). Le déployeur ne les envoie pas, mais ils prêtent à confusion. |
| Test sur RPi réel | jamais fait | Tout le travail ci-dessous a été vérifié en simulation sur poste de travail (sans GPIO, sans le service systemd réel), sauf le déploiement lui-même qui, lui, a réussi sur le RPi réel (voir phase 6). |
| `rpi_server/config.json` embarqué dans le `.deb` studio | à surveiller | Contient vos noms de GPIO réels et l'identifiant de chat Telegram. Présent depuis avant ce travail, non introduit par les correctifs ci-dessous — à garder en tête si ce `.deb` est partagé. |

---

## Chronologie des travaux

### Phase 1 — Vérification initiale (avant ce fil de travail détaillé)
- Question de départ : le moteur du RPi est-il à jour de toutes les modifications du studio ?
- Vérifié : `core/plc_engine.py` et `resources/plc_engine.py` identiques (md5 égaux).
- Vérifié : `rpi_server/server.py` contient le correctif CONN, identique à l'octet près à `correctif_conn.zip`.
- Testé sur 2 montages (PyBlock+STOAV+CONN, DV→CONN→PyBlock) : registres et variables `av2/av3/av4` identiques entre les deux moteurs.
- Non vérifié à ce stade : le RPi réel (simulation seulement), et le déploiement lui-même — **le déployeur ne comparait alors que la taille de `server.py`**, pas son contenu (corrigé en phase 5).

### Phase 2 — Extension à tous les types de blocs
- Le moteur compte 89 types de blocs (pas 70, première estimation fausse).
- Fuzz manuel : 16 variantes par type, 6 cycles, comparaison registres/bits M/GPIO/variables nommées.
- Résultat : 65 identiques, 24 différents.
- Écarts confirmés par lecture de code : `deadb` (zone morte non retranchée + sortie inversée), `avg` (préremplissage différent), `scale` (bloc compilé par l'éditeur ne faisait rien sur le RPi), `mod` (signe du reste sur les négatifs), `integ` (sortie « borne atteinte » absente du RPi), `pid` (implémentations différentes), `sr`/`sr_r`/`rs` (entrée S/R non câblée traitée comme active sur le RPi, inactive sur le studio), lecture d'un registre RF comme booléen (seuil ≥0.5 sur le RPi contre « non nul » sur le studio).
- Écarts dus au matériel, non comparables en simulation : `sensor`, `ds_in`, `localtime`, `input`, `output`, `contactor`.
- À creuser identifié à ce stade : `timer`, `ctu`, `ctd`, `ctud`, `runtimcnt`, `runtimecnt`, `backup`, `carithm`, `plancher`, `solar`, `ramp`.
- Bug confirmé : `ctd` plante (`KeyError 'cv'`) si le compteur est utilisé avant d'être initialisé.

### Phase 3 — Premiers correctifs
Corrections appliquées sur le moteur RPi (le studio sert de référence) :
- `ctd` : suppression d'un doublon de branche qui se battait sur le même compteur ; démarrage du décompte à la présélection.
- `sr`, `sr_r`, `rs` : entrée S ou R non câblée traitée comme inactive ; bit par défaut de `sr_s` aligné sur `M0`.
- Lecture d'un registre RF comme booléen : toute valeur non nulle est vraie (au lieu de ≥0.5).
- `integ` : l'intégrateur ne reste plus bloqué à 0 sans entrée Reset câblée ; sortie « borne atteinte » ajoutée.
- `scale` : lit et écrit désormais les mêmes clés (`reg_ref`/`reg_out`) que le studio, résultat borné.
- `deadb`, `avg`, `mod` : alignés sur le studio.
- Ajout de `import math` au niveau du module.
- Vérification : 24 scénarios ciblés → 7/24 identiques avant, 24/24 après. Comparaison ancien/nouveau `server.py` sur les 89 types : seuls les types visés ont changé.
- Nouveaux écarts trouvés à cette occasion (non corrigés à l'époque) : `timer` (entrée IN non câblée déclenche en permanence, `et_ref`/`pt_ref` ignorés), `sel`, `mux`, `compare_f` (`le` toujours faux, `eq` sans tolérance), `ramp`, `compare` avec `ne` (bug situé dans le studio, voir tableau ci-dessus).
- Pas encore comparés à ce stade : `pid`, `plancher`, `solar`, `runtimcnt`, `backup`, `carithm` avec les clés réellement générées par l'éditeur.
- Deux points signalés comme sensibles : le retranchement de la zone morte par `deadb` peut changer la sortie de programmes déjà déployés qui comptaient sur l'ancien comportement ; `integ`/`sr`/`scale`/`ctd` changent aussi le comportement de programmes déjà déployés.

### Phase 4 — Banc de test automatisé et nouveaux bugs trouvés
- Écriture de `tests/parity_fuzz.py` : compare automatiquement le studio et le RPi sur tous les types de blocs, en générant des variantes aléatoires par type et en comparant registres/bits M/GPIO/variables nommées sur plusieurs cycles.
- Ce banc a révélé des bugs que le fuzz manuel n'avait pas trouvés :
  - **Isolation des erreurs** : une exception dans un bloc arrêtait tout le cycle de scan (le RPi n'avait pas de `try/except` par bloc, contrairement au studio). Corrigé : chaque bloc est maintenant isolé, l'erreur est journalisée (`self.error`) sans bloquer les blocs suivants.
  - `write_dv` : ne savait écrire que sur une variable nommée, pas sur un GPIO (entier) ni un bit `Mn`. Corrigé — nécessaire pour que les blocs métier (`zone_chauf`, `ecs_bloc`, `plancher`, `chaudiere`, `solar`) écrivent correctement leur sortie.
  - `add`/`sub`/`mul`/`div` : valeurs par défaut de l'entrée B et de la sortie non alignées sur le studio quand elles ne sont pas câblées. Corrigé (sans effet pratique : l'éditeur câble toujours ces clés, vérifié plus tard en phase 8).
  - `sr_s` : n'acceptait pas les alias `s_cond`/`r_cond` utilisés par `sr`/`sr_r`. Corrigé.
- Livré : `server.py` (md5 `fe8da640a5b28b547b3d3950e542d128`), `correctif_server.patch`, `tests/parity_fuzz.py`, `tests/test_block_isolation.py`.
- Résultat : 78/89 types identiques ; le reste dépend du matériel ou de combinaisons de clés que l'éditeur ne génère jamais.
- **Ce `server.py` a été déployé avec succès sur le RPi réel** (journal de déploiement vérifié : service systemd actif, PID confirmé).

### Phase 5 — Déployeur : comparaison par contenu (md5) plutôt que par taille
- Constat de départ : le déployeur ne comparait que la taille des fichiers, donc une modification d'un caractère avec la même taille de fichier passait inaperçue.
- Ajout dans `core/deployer.py` : `local_md5`, `remote_md5s` (une seule commande SSH pour tous les fichiers), `verify_uploaded`. `smart_check` compare désormais le contenu (repli sur la taille si `md5sum` est absent du RPi). `deploy_prog_only` et `deploy()` revérifient le md5 après envoi et **bloquent le redémarrage du service si `server.py` ne correspond pas**.
- Testé avec un RPi simulé (dossier local) : fichier identique, fichier de même taille mais contenu différent (cas clé), fichier absent, chemin avec apostrophe/espace, détection par `smart_check` d'un `server.py` de même taille mais différent.
- Livré : `deployer.py`, `correctif_deployer.patch`, `tests/test_deployer_md5.py`.
- **Vérifié sur déploiement réel** : le journal a affiché `[MD5] ✅` pour les 19 fichiers serveur, service systemd redémarré avec succès.

### Phase 6 — Comparaison pilotée par les clés réellement générées par l'éditeur
- Constat : le fuzz précédent testait des combinaisons de clés qu'`ui/block_editor.py` ne produit jamais, ce qui faussait certains résultats.
- Extraction par analyse du code source (AST) des clés réellement écrites par l'éditeur pour chaque type de bloc → `tests/editor_keys.json`.
- Nouvelle comparaison limitée à ces clés, avec des valeurs réalistes : la plupart des écarts précédemment signalés (`pid`, `plancher`, `runtimcnt`, `carithm`, `timer`, `sel`, `mux`, `ctu`, `ctud`, `sr`, `backup`) se sont révélés **identiques** dans les conditions réellement produites par l'éditeur.
- Quatre écarts réels confirmés à ce stade :
  - `ctd` avec présélection à 0 (la sortie s'active dès le premier cycle sur le RPi, pas sur le studio).
  - `compare` sans opérateur fourni (jamais le cas avec l'éditeur, qui écrit toujours `op`).
  - `compare_f` sans seuil fourni (jamais le cas avec l'éditeur, qui écrit toujours `threshold`).
  - `counter` avec une présélection câblée sur un registre qui augmente après que le seuil a été atteint (cas réel possible si un programme câble un `PV` variable).

### Phase 7 — Alignement des 4 derniers écarts + découverte d'un bug réel supplémentaire
- `ctd` : la sortie « compteur atteint » est désormais sticky (mise à jour seulement lors du décompte ou du chargement), comme le studio. `ctu`/`ctud` inchangés (le studio les recalcule déjà à chaque cycle).
- `counter` : la sortie « atteint » ne redescend plus jamais toute seule ; elle ne peut être remise à faux que par un reset, comme le studio.
- `compare` : **en creusant ce cas, un vrai bug a été trouvé et corrigé, pas seulement une question de valeur par défaut**. Le moteur RPi exécutait ce bloc deux fois par cycle : une fois correctement, une seconde fois via une branche héritée de l'ancien moteur de bureau, qui ne lisait pas les bits M et écrasait le bon résultat par un mauvais. Cette branche dupliquée a été supprimée. C'est le correctif le plus significatif de cette série — il pouvait toucher tout programme avec un bloc `compare` câblé sur un bit M plutôt qu'un registre.
- `compare_f` : seuil par défaut aligné sur le studio (sans effet pratique, voir phase 6).
- `neq` ajouté comme alias accepté de `ne` dans `compare` (le studio accepte les deux ; l'éditeur n'émet que `ne`, donc sans effet pratique non plus).
- Livré : `server.py` (md5 `c9cbe1210f05683326160d3ad36c90cb`), `correctif_server.patch` (diff depuis la version déjà déployée en phase 4).

### Phase 8 — Reconstruction des deux paquets `.deb`
- Métadonnées de paquet (contrôle, dépendances, scripts `postinst`/`prerm`/`postrm`) extraites des deux derniers `.deb` existants : `rpi-plc-studio_3.5-12.deb` et `rpi-plc_3.5-8-serveur.deb`.
- Reconstruits avec le code source courant (incluant tous les correctifs ci-dessus), versions incrémentées : studio `3.5-12` → `3.5-13`, serveur `3.5-8` → `3.5-9`.
- Vérifications : tous les `.py` compilent, liste des fichiers identique à l'ancienne (à l'exception des `__pycache__` obsolètes volontairement retirés), permissions des scripts préservées, installation à blanc réussie via `dpkg` dans un environnement isolé, `server.py` embarqué conforme au md5 livré.
- Non testé : l'exécution réelle des scripts `postinst` (accès `systemctl`, groupes système, `/boot/firmware/config.txt`) — à valider sur une vraie machine PC et un vrai RPi.

### Phase 9 — Vérification de compatibilité d'un projet existant (`Chauffage_Maison_V3Bon.plcproj`)
- Audit des 357 blocs du projet : aucun des types modifiés (`ctd`, `counter`, `compare`, `compare_f`) n'y est utilisé.
- Les 9 blocs `ADD` du projet ont leurs deux entrées toujours câblées sur un registre précis → le changement de valeur par défaut ne s'y applique jamais.
- `BACKUP` (41 blocs) non affecté (aucun changement de code ne le concerne).
- Conclusion : ce projet peut être redéployé sans changement de comportement attendu.

---

## Outils créés (à conserver dans le projet, dossier `tests/`)

| Fichier | Rôle |
|---|---|
| `tests/parity_fuzz.py` | Compare automatiquement le studio et le RPi sur tous les types de blocs. Option `--editor-keys tests/editor_keys.json --ignore-named` pour se limiter aux combinaisons réellement produites par l'éditeur (le mode le plus fiable pour juger de l'impact sur un vrai projet). Option `--raw` pour un fuzz complet sans restriction. |
| `tests/editor_keys.json` | Clés réellement écrites par `ui/block_editor.py` pour chaque type de bloc. **À régénérer si `block_editor.py` change** (la logique d'extraction est dans `parity_fuzz.py`, fonction d'analyse AST utilisée en phase 6 — à ressortir si besoin). |
| `tests/test_block_isolation.py` | Vérifie qu'un bloc en erreur n'empêche pas l'exécution des blocs suivants du même cycle. |
| `tests/test_deployer_md5.py` | Vérifie la comparaison md5 du déployeur avec un RPi simulé (fichier identique, même taille mais contenu différent, fichier absent, chemin avec caractères spéciaux). |

### Procédure — lancer les tests

Prérequis : Python 3.9+, aucune dépendance externe à installer (les tests tournent en
simulation ; `paho-mqtt` et `RPi.GPIO` sont optionnels, leur absence n'empêche pas
`rpi_server/server.py` de se charger). Se placer à la racine du projet avant de lancer
les commandes ci-dessous (dossier contenant `core/`, `ui/`, `rpi_server/`, `tests/`).

**1. `tests/parity_fuzz.py` — comparaison studio/RPi, à lancer après toute modification
d'un des deux moteurs.**

Usage courant, le plus fiable (limité aux combinaisons réellement produites par l'éditeur) :
```bash
python3 tests/parity_fuzz.py --editor-keys tests/editor_keys.json --ignore-named
```
Code retour `0` = aucun écart en dehors du matériel/horloge, `1` sinon. En cas d'écart,
la sortie liste le bloc généré et les valeurs qui divergent (`studio=... rpi=...`).

Options utiles :
```
--n N            nombre de variantes aléatoires par type (défaut 24)
--cycles N        nombre de cycles simulés par variante (défaut 6)
--seed N          graine aléatoire (fixer pour reproduire exactement un résultat)
--types t1,t2     limiter à certains types de blocs (ex. --types ctd,counter,compare)
--detail N        nombre d'exemples d'écarts affichés par type (0 = juste le compte)
--raw             fuzz complet, sans se limiter aux clés/valeurs de l'éditeur
--editor-keys F   limiter aux clés du JSON F (tests/editor_keys.json)
--ignore-named    ignorer les variables AV/DV nommées (stockage différent studio/RPi,
                   sans rapport avec un vrai écart de comportement)
--studio PATH     chemin d'un autre plc_engine.py à comparer (défaut core/plc_engine.py)
--rpi PATH        chemin d'un autre server.py à comparer (défaut rpi_server/server.py)
```
`--studio`/`--rpi` servent aussi à comparer deux versions de RPi entre elles (régression) :
```bash
python3 tests/parity_fuzz.py --studio ancien/server.py --rpi rpi_server/server.py --n 40
```
(indiquer un `server.py` dans `--studio` compare alors « ancien » vs « nouveau » RPi, pas
RPi contre studio — utile pour vérifier qu'un correctif n'a rien cassé d'autre).

**Si `ui/block_editor.py` change**, régénérer `tests/editor_keys.json` avant de se fier à
`--editor-keys` (sinon il reflète l'ancien éditeur) : reprendre le script d'extraction AST
utilisé en phase 6 de ce journal (parcourt les branches `if bt == "..."` de
`ui/block_editor.py` et relève les clés assignées à `blk[...]` pour chaque type).

**2. `tests/test_block_isolation.py` — vérifie qu'un bloc en erreur n'arrête pas les
blocs suivants.**
```bash
python3 tests/test_block_isolation.py rpi_server/server.py
```
Fait tourner une vraie boucle de scan (thread `_scan_loop`) avec un bloc volontairement
cassé suivi d'une bobine ; réussit si la bobine s'active malgré l'erreur. Code retour `0`
= isolation OK, `1` sinon. Prend un chemin de `server.py` en argument, pour comparer une
ancienne version :
```bash
python3 tests/test_block_isolation.py chemin/vers/ancien_server.py
```

**3. `tests/test_deployer_md5.py` — vérifie la comparaison md5 du déployeur.**
```bash
python3 tests/test_deployer_md5.py
```
Aucun argument : simule un RPi avec un dossier local et un `Sftp`/`run` factices. Teste
la lecture des md5, un fichier absent, un fichier de même taille mais de contenu
différent (le cas que la taille seule ne détecte pas), un chemin avec espace/apostrophe,
et que `smart_check` classe bien ce dernier cas comme obsolète. Affiche `OK`/`ECHEC`
ligne par ligne puis un résumé ; code retour `0` si tout passe.

**Lancer les trois d'affilée** (ex. avant un déploiement, après une modification du
moteur ou du déployeur) :
```bash
python3 tests/parity_fuzz.py --editor-keys tests/editor_keys.json --ignore-named \
  && python3 tests/test_block_isolation.py rpi_server/server.py \
  && python3 tests/test_deployer_md5.py \
  && echo "TOUT EST OK"
```

---

## Comment reprendre ce travail plus tard
Donnez ce fichier en contexte, dites ce que vous voulez faire, et en particulier si ça touche
un des « Sujets ouverts » en tête de document. Si `ui/block_editor.py` a changé depuis la
phase 6, il faudra régénérer `tests/editor_keys.json` avant de se fier à une comparaison
« clés éditeur ».
