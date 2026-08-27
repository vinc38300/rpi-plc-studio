# Guide PYBLOCK — RPi PLC Studio

Référence pratique du bloc PYBLOCK : son contrat d'entrées/sorties, les pièges classiques,
et une large collection d'exemples commentés, organisés par catégorie, réutilisables sur
d'autres projets que la chaudière Gialix.

## Sommaire

1. [Le contrat d'E/S](#1-le-contrat-des)
2. [Pièges classiques](#2-pièges-classiques)
3. Temporisation et séquencement
   - [3.1 Retard à l'enclenchement/déclenchement (TON/TOF maison)](#31-retard-à-lenclenchementdéclenchement)
   - [3.2 Clignotant à fréquence réglable](#32-clignotant-à-fréquence-réglable)
   - [3.3 Démarrage échelonné de plusieurs étages](#33-démarrage-échelonné-de-plusieurs-étages)
   - [3.4 Watchdog / détection de perte de communication](#34-watchdog--détection-de-perte-de-communication)
   - [3.5 Fenêtre horaire heures creuses / pleines](#35-fenêtre-horaire-heures-creuses--pleines)
4. Comparaisons et hystérésis
   - [4.1 Hystérésis entre deux sondes](#41-hystérésis-entre-deux-sondes)
   - [4.2 Anti-cyclage (min ON / min OFF)](#42-anti-cyclage-min-on--min-off)
   - [4.3 Alarme à deux seuils avec mémorisation](#43-alarme-à-deux-seuils-avec-mémorisation)
   - [4.4 Détection de divergence entre sondes redondantes](#44-détection-de-divergence-entre-sondes-redondantes)
5. Traitement du signal
   - [5.1 Détection de front montant/descendant](#51-détection-de-front-montantdescendant)
   - [5.2 Anti-rebond (debounce) sur une entrée logique](#52-anti-rebond-debounce-sur-une-entrée-logique)
   - [5.3 Lissage par moyenne glissante](#53-lissage-par-moyenne-glissante)
   - [5.4 Limiteur de vitesse de variation (rate limiter)](#54-limiteur-de-vitesse-de-variation-rate-limiter)
   - [5.5 Min/Max glissant sur une période](#55-minmax-glissant-sur-une-période)
   - [5.6 Correction de courbe non-linéaire par interpolation](#56-correction-de-courbe-non-linéaire-par-interpolation)
6. Calculs métier / énergie
   - [6.1 Intégration puissance → énergie (kWh)](#61-intégration-puissance--énergie-kwh)
   - [6.2 Compteur d'impulsions (débitmètre, compteur électrique)](#62-compteur-dimpulsions-débitmètre-compteur-électrique)
   - [6.3 Coût électrique HP/HC en temps réel](#63-coût-électrique-hphc-en-temps-réel)
7. Sécurité et robustesse
   - [7.1 Détection de capteur en défaut](#71-détection-de-capteur-en-défaut)
   - [7.2 Valeur de repli (failsafe) avec bascule automatique](#72-valeur-de-repli-failsafe-avec-bascule-automatique)
8. Communication
   - [8.1 Anti-spam de notifications](#81-anti-spam-de-notifications)
   - [8.2 Régulation proportionnelle simple (P seul)](#82-régulation-proportionnelle-simple-p-seul)
9. [Bonnes pratiques générales](#9-bonnes-pratiques-générales)

## 1. Le contrat d'E/S

Un PYBLOCK expose un jeu fixe de variables dans son contexte d'exécution — pas besoin de les
déclarer, elles existent déjà quand le code s'exécute :

| Catégorie | Variables | Câblage | Type |
|---|---|---|---|
| Entrées analogiques | `A1` … `A12` | `a1_ref` … `a12_ref` | `float` |
| Entrées logiques | `d1` … `d12` | `d1_ref` … `d12_ref` | `bool` |
| Entrées entières | `I1`, `I2` | `i1_ref`, `i2_ref` | `int` |
| Sorties analogiques | `OA1` … `OA12` | `oa1_ref` … `oa12_ref` | `float` |
| Sorties logiques | `od1` … `od12` | `od1_ref` … `od12_ref` | `bool` |
| Sortie entière | `OI1` | `oi1_ref` | `int` |
| Contexte | `dt` (secondes écoulées), `cycle` (n° de cycle), `state` (dict persistant) | — | — |

**`state` est la variable la plus importante** dès qu'un bloc doit "se souvenir" du cycle
précédent (hystérésis, anti-cyclage, front montant, moyenne glissante…). Elle survit d'un
cycle PLC au suivant ; tout ce que tu n'y stockes pas est réinitialisé à chaque exécution.

**Le nombre de ports réellement actifs** (`n_a`, `n_d`, `n_oa`, `n_od`) se règle dans les
paramètres du bloc — au-delà, les ports non câblés valent simplement `0`/`False`, ils
n'empêchent pas le code de tourner.

**Environnement restreint** — pas d'`exec`, `eval`, `open`, ni d'import dynamique. Imports
autorisés : `math`, `datetime`, `time`, `statistics`. Builtins disponibles : `abs`, `min`,
`max`, `round`, `int`, `float`, `bool`, `str`, `len`, `range`, `list`, `dict`, `sum`,
`sorted`, `enumerate`, `zip`, `any`, `all`, `print`.

## 2. Pièges classiques

- **`NameError` sur une variable que tu as bien définie** → presque toujours un copier-coller
  incomplet (ligne sautée, indentation cassée par un mélange espaces/tabulations). Recolle le
  bloc en entier et vérifie la première ligne.
- **`state` "oublie" une valeur** → tu dois toujours l'initialiser avec un test
  `if 'clé' not in state:` avant de t'en servir, sinon `KeyError` au premier cycle.
- **Un port câblé sur une constante plutôt qu'un registre** → si tu veux qu'une valeur (seuil,
  hystérésis…) soit réglable depuis l'extérieur sans retoucher le code, câble-la sur un port
  `A_n` relié à un `MEM` ou une variable AV nommée — jamais une constante en dur si tu veux
  la changer plus tard sans redéployer.
- **Oublier d'écrire la sortie** → si tu ne fais pas `od1 = ...` (ou `OA1 = ...`) explicitement
  à la fin de l'exécution, le port garde sa valeur par défaut (`False` / `0.0`), pas la
  dernière valeur du cycle précédent.
- **`dt` variable selon la charge du Pi** → ne jamais supposer un `dt` fixe pour les calculs de
  temps (compteurs, intégration) ; toujours multiplier/diviser par `dt` réellement fourni,
  jamais par le `scan_time_ms` théorique de la config.

---

## 3. Temporisation et séquencement

### 3.1 Retard à l'enclenchement/déclenchement

Équivalent maison d'un TON/TOF, utile quand tu veux combiner le délai avec une autre logique
dans le même bloc plutôt que d'ajouter un bloc TIMER séparé.

```python
delai_on_s  = 5.0    # délai avant d'activer après que d1 passe à True
delai_off_s = 2.0    # délai avant de désactiver après que d1 repasse à False

if 't' not in state:
    state['t']    = 0.0
    state['sortie'] = False

if d1:
    state['t'] = min(state['t'] + dt, delai_on_s + 1)
    if state['t'] >= delai_on_s:
        state['sortie'] = True
else:
    state['t'] = max(state['t'] - dt, -(delai_off_s + 1))
    if state['t'] <= -delai_off_s:
        state['sortie'] = False

od1 = state['sortie']
```

*Câblage : `d1`→entrée à temporiser, `od1`→sortie temporisée.*

### 3.2 Clignotant à fréquence réglable

Utile pour faire clignoter une LED synoptique, ou générer une impulsion cadencée sans bloc
dédié.

```python
periode_s = 1.0   # durée d'un cycle complet ON+OFF

if 't' not in state:
    state['t'] = 0.0

state['t'] = (state['t'] + dt) % periode_s
od1 = state['t'] < (periode_s / 2)
```

*Câblage : `od1`→sortie clignotante (aucune entrée nécessaire).*

### 3.3 Démarrage échelonné de plusieurs étages

Évite l'appel de puissance simultané de plusieurs étages électriques (cf. les 4 à 6 étages de
la chaudière Gialix) en les décalant dans le temps au démarrage.

```python
delai_entre_etages_s = 3.0
nb_etages = 4

if 'demarre' not in state:
    state['demarre'] = False
    state['t0']      = 0.0

if d1 and not state['demarre']:
    state['demarre'] = True
    state['t0'] = 0.0

if state['demarre']:
    state['t0'] += dt

t = state['t0']
od1 = state['demarre']                                  # étage 1 : immédiat
od2 = state['demarre'] and t >= delai_entre_etages_s      # étage 2
od3 = state['demarre'] and t >= 2 * delai_entre_etages_s  # étage 3
od4 = state['demarre'] and t >= 3 * delai_entre_etages_s  # étage 4

if not d1:
    state['demarre'] = False
```

*Câblage : `d1`→demande globale de marche, `od1`…`od4`→un contacteur par étage.*

### 3.4 Watchdog / détection de perte de communication

Détecte qu'une valeur ne bouge plus (capteur déconnecté, bus mort) plutôt que de continuer à
faire confiance à une dernière valeur figée sans le savoir.

```python
timeout_s = 30.0

if 'derniere_valeur' not in state:
    state['derniere_valeur'] = A1
    state['t_stable']        = 0.0

if A1 != state['derniere_valeur']:
    state['derniere_valeur'] = A1
    state['t_stable'] = 0.0
else:
    state['t_stable'] += dt

od1 = state['t_stable'] >= timeout_s   # True = capteur suspecté figé/déconnecté
```

*Câblage : `A1`→valeur surveillée, `od1`→alarme "capteur figé", à envoyer par exemple sur
Telegram via `notify_plc`.*

### 3.5 Fenêtre horaire heures creuses / pleines

Alternative logicielle à une horloge physique câblée sur l'entrée 20-21 du régulateur — utile
si tu veux une logique plus fine que ce que permet le paramètre n°23 du Gialix (ex. plusieurs
plages dans la journée).

```python
import datetime

now = datetime.datetime.now()
heure = now.hour + now.minute / 60.0

# Heures creuses : 22h30 -> 6h30 (plage à cheval sur minuit)
hc_debut, hc_fin = 22.5, 6.5
if hc_debut > hc_fin:
    en_hc = heure >= hc_debut or heure < hc_fin
else:
    en_hc = hc_debut <= heure < hc_fin

od1 = en_hc
```

*Câblage : `od1`→signal "en heures creuses", à combiner avec d'autres blocs (ex. autoriser la
relève électrique seulement en HC).*

---

## 4. Comparaisons et hystérésis

### 4.1 Hystérésis entre deux sondes

Déclenche quand `A1` dépasse `A2` d'au moins `seuil`, ne redescend qu'une fois l'écart
repassé sous `seuil - hyst`. Le `seuil` est fixe dans le code, l'`hyst` est piloté depuis
l'extérieur via `A3` (ex. un `MEM` réglable en live).

```python
seuil = 2.0                # écart minimum A1-A2 pour déclencher (°C), fixe
hyst  = max(0.0, A3)       # hystérésis pilotée depuis l'extérieur (registre)

if 'actif' not in state:
    state['actif'] = False

diff = A1 - A2

if state['actif']:
    if diff < (seuil - hyst):
        state['actif'] = False
else:
    if diff >= seuil:
        state['actif'] = True

od1 = state['actif']
```

*Câblage : `A1`→sonde 1, `A2`→sonde 2, `A3`→registre d'hystérésis, `od1`→relais/recette.*

### 4.2 Anti-cyclage (min ON / min OFF)

Empêche un relais de rebasculer trop vite (usure des contacteurs). Reprend le principe déjà
utilisé en interne par les blocs CHAUDIERE/ZONE_CHAUF du moteur, mais réutilisable pour
n'importe quelle sortie.

```python
seuil_on  = 50.0     # démarre si A1 < seuil_on
seuil_off = 55.0     # arrête si A1 >= seuil_off
min_on_s  = 60.0      # durée mini en marche avant de pouvoir s'arrêter
min_off_s = 30.0      # durée mini à l'arrêt avant de pouvoir redémarrer

if 'on' not in state:
    state['on'] = False
    state['t']  = 0.0

state['t'] += dt

if state['on']:
    if A1 >= seuil_off and state['t'] >= min_on_s:
        state['on'] = False
        state['t']  = 0.0
else:
    if A1 < seuil_on and state['t'] >= min_off_s:
        state['on'] = True
        state['t']  = 0.0

od1 = state['on']
```

*Câblage : `A1`→sonde pilotée, `od1`→relais de puissance.*

### 4.3 Alarme à deux seuils avec mémorisation

Une alarme "critique" doit souvent rester affichée/notifiée même après retour sous le seuil,
jusqu'à acquittement manuel (évite de noyer l'historique d'alertes en cas d'oscillation autour
du seuil).

```python
seuil_warning  = 80.0
seuil_critique = 90.0

if 'ack' not in state:
    state['ack'] = True   # pas d'alarme active au démarrage

if A1 >= seuil_critique and not state['ack']:
    pass   # déjà en alarme non acquittée, rien à faire
elif A1 >= seuil_critique:
    state['ack'] = False  # nouvelle alarme critique -> se réarme automatiquement

od1 = A1 >= seuil_warning              # simple dépassement, pas mémorisé
od2 = (not state['ack']) and A1 >= seuil_critique - 5   # alarme critique mémorisée

# Acquittement : câbler d2 sur un bouton/commande Telegram dédiée
if d2:
    state['ack'] = True
```

*Câblage : `A1`→sonde, `d2`→commande d'acquittement, `od1`→alarme warning (non mémorisée),
`od2`→alarme critique mémorisée jusqu'à acquittement.*

### 4.4 Détection de divergence entre sondes redondantes

Sur une installation où deux sondes mesurent en théorie la même grandeur (deux sondes
extérieures, par exemple), un écart anormal signale qu'une des deux dérive ou est mal
positionnée.

```python
ecart_max = 5.0   # écart maximum jugé normal (°C)

ecart = abs(A1 - A2)
od1 = ecart > ecart_max   # True = divergence suspecte entre les deux sondes

# Valeur "consolidée" utilisable en aval : moyenne si cohérentes, sinon la plus fiable (A1)
OA1 = (A1 + A2) / 2 if not od1 else A1
```

*Câblage : `A1`/`A2`→les deux sondes redondantes, `od1`→alarme divergence, `OA1`→valeur
consolidée à utiliser pour la régulation.*

---

## 5. Traitement du signal

### 5.1 Détection de front montant/descendant

Utile pour déclencher une action une seule fois au moment précis où une entrée change d'état
(ex. envoyer une notification Telegram seulement à l'instant où une alarme apparaît, pas à
chaque cycle tant qu'elle reste active).

```python
if 'prev' not in state:
    state['prev'] = d1

front_montant    = d1 and not state['prev']
front_descendant = (not d1) and state['prev']

state['prev'] = d1

od1 = front_montant       # impulsion d'un seul cycle PLC
od2 = front_descendant
```

*Câblage : `d1`→entrée logique surveillée, `od1`/`od2`→impulsions à consommer ailleurs
(ex. incrémenter un compteur, déclencher un envoi Telegram ponctuel).*

### 5.2 Anti-rebond (debounce) sur une entrée logique

Un bouton poussoir ou un contact sec mécanique peut "rebondir" (plusieurs transitions
parasites en quelques millisecondes) ; ce filtre n'accepte un changement d'état que s'il est
resté stable un minimum de temps.

```python
stabilite_requise_s = 0.05   # 50 ms

if 'valeur' not in state:
    state['valeur']  = d1
    state['candidat'] = d1
    state['t']        = 0.0

if d1 != state['candidat']:
    state['candidat'] = d1
    state['t'] = 0.0
else:
    state['t'] += dt
    if state['t'] >= stabilite_requise_s and state['candidat'] != state['valeur']:
        state['valeur'] = state['candidat']

od1 = state['valeur']
```

*Câblage : `d1`→entrée brute (bouton, fin de course…), `od1`→signal stabilisé.*

### 5.3 Lissage par moyenne glissante

Évite qu'une lecture instable (bruit électrique, contact imparfait) ne fasse "trembler" une
régulation en aval.

```python
N = 10   # taille de la fenêtre de lissage

if 'buf' not in state:
    state['buf'] = []

state['buf'].append(A1)
if len(state['buf']) > N:
    state['buf'].pop(0)

OA1 = sum(state['buf']) / len(state['buf'])
```

*Câblage : `A1`→sonde brute, `OA1`→valeur lissée, à utiliser ensuite comme entrée des autres
blocs (GT, COMPH…) à la place de la sonde brute.*

### 5.4 Limiteur de vitesse de variation (rate limiter)

Empêche une consigne de bouger trop vite d'un cycle à l'autre (protège une vanne motorisée ou
évite un à-coup de consigne chaudière après un changement brutal).

```python
max_pente = 0.5   # variation maximale autorisée par seconde (°C/s)

if 'valeur' not in state:
    state['valeur'] = A1   # initialisation sur la première lecture

delta_max = max_pente * dt
ecart     = A1 - state['valeur']
ecart     = max(-delta_max, min(delta_max, ecart))

state['valeur'] += ecart
OA1 = state['valeur']
```

*Câblage : `A1`→consigne ou valeur cible brute, `OA1`→consigne "adoucie" à appliquer réellement.*

### 5.5 Min/Max glissant sur une période

Suivi du minimum/maximum atteint sur une fenêtre de temps donnée (ex. température mini/maxi de
la journée), avec remise à zéro automatique.

```python
periode_s = 24 * 3600   # 24h

if 't' not in state:
    state['t']   = 0.0
    state['min'] = A1
    state['max'] = A1

state['t'] += dt
state['min'] = min(state['min'], A1)
state['max'] = max(state['max'], A1)

if state['t'] >= periode_s:
    state['t']   = 0.0
    state['min'] = A1
    state['max'] = A1

OA1 = state['min']
OA2 = state['max']
```

*Câblage : `A1`→sonde suivie, `OA1`→mini de la période, `OA2`→maxi de la période. Utile pour
un `/temp` Telegram enrichi ("mini du jour : X°C, maxi : Y°C").*

### 5.6 Correction de courbe non-linéaire par interpolation

Directement issu du travail fait sur la CTN de remplacement de la sonde extérieure Gialix :
au lieu de faire confiance à une simple formule Beta, on interpole une vraie table
constructeur point par point — plus fidèle si la courbe réelle s'écarte du modèle exponentiel
théorique.

```python
# Table (température, résistance) triée par température croissante — à adapter au capteur réel
table = [(-30, 171800), (-20, 98930), (-10, 58880), (0, 36130),
         (10, 22800), (20, 14770), (25, 12000), (30, 9804), (40, 6652)]

r_mesuree = A1   # résistance lue (Ω), déjà convertie en amont si besoin

# Interpolation linéaire entre les deux points encadrants
temp = table[0][0]
for i in range(len(table) - 1):
    t1, r1 = table[i]
    t2, r2 = table[i + 1]
    if r1 >= r_mesuree >= r2:
        frac = (r1 - r_mesuree) / (r1 - r2)
        temp = t1 + frac * (t2 - t1)
        break
else:
    temp = table[-1][0] if r_mesuree < table[-1][1] else table[0][0]

OA1 = temp
```

*Câblage : `A1`→résistance mesurée (Ω), `OA1`→température corrigée. Remplace avantageusement
une formule Beta générique quand tu as la vraie table constructeur (comme celle extraite de
la notice Gialix) plutôt que de supposer une courbe purement exponentielle.*

---

## 6. Calculs métier / énergie

### 6.1 Intégration puissance → énergie (kWh)

Transforme une mesure de puissance instantanée (W) en énergie cumulée (kWh), utile s'il n'y a
pas de compteur d'énergie dédié mais une sonde de courant/puissance.

```python
if 'kwh' not in state:
    state['kwh'] = 0.0

puissance_w = A1
state['kwh'] += (puissance_w * dt) / 3600.0 / 1000.0

OA1 = state['kwh']

# Remise à zéro mensuelle sur commande externe (ex. bouton Telegram /reset_compteur)
if d1:
    state['kwh'] = 0.0
```

*Câblage : `A1`→puissance instantanée (W), `d1`→commande de remise à zéro, `OA1`→énergie
cumulée (kWh).*

### 6.2 Compteur d'impulsions (débitmètre, compteur électrique)

Beaucoup de débitmètres et de compteurs électriques à sortie impulsionnelle donnent un front
par unité mesurée (ex. 1 impulsion = 1 litre, ou 1 Wh) — on compte les fronts pour en déduire
le débit/la puissance instantanée en plus du cumul.

```python
valeur_par_impulsion = 1.0   # ex. 1 litre par impulsion

if 'prev' not in state:
    state['prev']  = d1
    state['total'] = 0.0
    state['t_last_pulse'] = 0.0
    state['t'] = 0.0

state['t'] += dt

front = d1 and not state['prev']
state['prev'] = d1

if front:
    state['total'] += valeur_par_impulsion
    # débit instantané = 1 impulsion / temps écoulé depuis la précédente
    if state['t_last_pulse'] > 0:
        OA2 = valeur_par_impulsion / state['t_last_pulse'] * 3600.0   # unité/heure
    state['t_last_pulse'] = 0.0
else:
    state['t_last_pulse'] += dt

OA1 = state['total']
```

*Câblage : `d1`→entrée impulsionnelle, `OA1`→total cumulé, `OA2`→débit instantané estimé
(unité/heure).*

### 6.3 Coût électrique HP/HC en temps réel

Combine la fenêtre horaire (§3.5) et l'intégration d'énergie (§6.1) pour un calcul de coût
direct, utile pour un `/cout` Telegram par exemple.

```python
import datetime

prix_hp = 0.27   # €/kWh, à adapter à ton contrat
prix_hc = 0.20

if 'cout' not in state:
    state['cout'] = 0.0

now = datetime.datetime.now()
heure = now.hour + now.minute / 60.0
en_hc = heure >= 22.5 or heure < 6.5

puissance_w = A1
energie_kwh = (puissance_w * dt) / 3600.0 / 1000.0
prix = prix_hc if en_hc else prix_hp
state['cout'] += energie_kwh * prix

OA1 = state['cout']

if d1:   # remise à zéro externe
    state['cout'] = 0.0
```

*Câblage : `A1`→puissance instantanée (W), `d1`→remise à zéro, `OA1`→coût cumulé (€).*

---

## 7. Sécurité et robustesse

### 7.1 Détection de capteur en défaut

Une sonde déconnectée ou en court-circuit renvoie souvent une valeur physiquement
impossible (souvent un extrême type -50°C ou +150°C selon le driver) — mieux vaut le détecter
explicitement que de laisser la régulation "croire" une valeur absurde.

```python
plage_min, plage_max = -30.0, 100.0   # plage physique plausible pour une sonde extérieure

od1 = not (plage_min <= A1 <= plage_max)   # True = sonde en défaut

# Valeur de secours : dernière bonne valeur connue plutôt que la valeur absurde
if 'derniere_bonne' not in state:
    state['derniere_bonne'] = A1 if not od1 else 0.0

if not od1:
    state['derniere_bonne'] = A1

OA1 = state['derniere_bonne']
```

*Câblage : `A1`→sonde surveillée, `od1`→alarme "capteur en défaut", `OA1`→valeur sécurisée à
utiliser en aval (reste figée sur la dernière bonne valeur en cas de défaut, plutôt que de
transmettre une valeur aberrante à la régulation).*

### 7.2 Valeur de repli (failsafe) avec bascule automatique

Bascule automatiquement sur une sonde de secours si la sonde principale part en défaut —
utile combiné avec le bloc précédent, dans un système avec redondance matérielle.

```python
plage_min, plage_max = -30.0, 100.0

principale_ok = plage_min <= A1 <= plage_max
secours_ok    = plage_min <= A2 <= plage_max

if principale_ok:
    OA1 = A1
    od1 = False   # pas de bascule, tout va bien
elif secours_ok:
    OA1 = A2
    od1 = True    # bascule active, à notifier
else:
    OA1 = 20.0     # aucune des deux sondes fiable -> valeur neutre de sécurité
    od1 = True
    od2 = True     # alarme grave : plus aucune sonde fiable
```

*Câblage : `A1`→sonde principale, `A2`→sonde de secours, `OA1`→valeur utilisée par la
régulation, `od1`→"en mode secours", `od2`→alarme grave (aucune sonde fiable).*

---

## 8. Communication

### 8.1 Anti-spam de notifications

Empêche d'envoyer une notification à chaque cycle PLC tant qu'une condition reste vraie — ne
notifie qu'au changement d'état, avec un délai minimum de rappel si la situation persiste
longtemps.

```python
rappel_toutes_les_s = 3600   # rappel toutes les heures si l'alarme persiste

if 'prev' not in state:
    state['prev'] = False
    state['t_last_notif'] = -rappel_toutes_les_s

condition = A1 > 90.0   # exemple : sonde au-dessus de 90°C

nouvelle_alarme = condition and not state['prev']
rappel_du       = condition and state['prev'] and \
                  (state.get('t', 0) - state['t_last_notif'] >= rappel_toutes_les_s)

if 't' not in state:
    state['t'] = 0.0
state['t'] += dt

if nouvelle_alarme or rappel_du:
    od1 = True
    state['t_last_notif'] = state['t']
else:
    od1 = False

state['prev'] = condition
```

*Câblage : `A1`→sonde surveillée, `od1`→impulsion "à notifier maintenant", à relier à la
logique d'envoi Telegram (`notify_plc`) plutôt que de la déclencher en continu.*

### 8.2 Régulation proportionnelle simple (P seul)

Une régulation proportionnelle basique (pas un vrai PID complet) : plus l'écart à la consigne
est grand, plus la sortie de commande est forte, avec une limite haute/basse.

```python
consigne = A2
mesure   = A1
kp       = 5.0    # gain proportionnel, à ajuster empiriquement
sortie_min, sortie_max = 0.0, 100.0

erreur = consigne - mesure
sortie = kp * erreur
sortie = max(sortie_min, min(sortie_max, sortie))

OA1 = sortie
```

*Câblage : `A1`→mesure, `A2`→consigne, `OA1`→commande (ex. vers un bloc de modulation de
puissance). Pour une vraie régulation fine, préférer le bloc `PID` natif du moteur s'il existe
déjà — ce PYBLOCK sert surtout de base pédagogique ou de dépannage rapide.*

## 9. Bonnes pratiques générales

- **Toujours initialiser `state`** avec `if 'clé' not in state:` avant la première utilisation.
- **Un seul PYBLOCK = une seule responsabilité claire.** Mieux vaut trois petits blocs lisibles
  qu'un seul bloc de 100 lignes qui mélange hystérésis, anti-cyclage et lissage.
- **`print()` est ton ami pour déboguer** — les sorties apparaissent dans les logs du Studio,
  utile pour vérifier une valeur intermédiaire sans devoir tout re-câbler vers un `OA`.
- **Utiliser `run_pyblock_test`** (bouton test dans l'éditeur du bloc) avant de déployer sur le
  Pi — ça simule des valeurs d'entrée et vérifie la syntaxe sans risque pour le PLC en
  fonctionnement réel.
- **Ne jamais mettre de valeur réglable en dur dans le code** si tu penses vouloir la changer
  un jour sans redéployer — passe-la par un port `A_n`/`I_n` câblé sur un registre.
- **Toujours raisonner en `dt`, jamais en nombre de cycles** pour tout ce qui touche au temps
  (compteurs, intégration, temporisations) — le `scan_time_ms` théorique n'est qu'une cible, le
  cycle réel peut varier légèrement selon la charge du Raspberry Pi.
- **Documenter le "pourquoi" en commentaire**, pas juste le "quoi" — dans six mois, tu sauras
  relire *ce que* fait le code, mais pas forcément *pourquoi* ce seuil précis avait été choisi.
