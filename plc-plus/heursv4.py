# ============================================================
# pyblock  : bloc_jours  VERSION CORRIGÉE V2
#
# CORRECTIONS:
#  BUG 1: SET/RESET sur comparaison de plage (pas heure exacte)
#         → fiable même si un scan rate l'heure pile
#  BUG 3: wday corrigé: LocalTime.WDay=0=Dim (Proview)
#         converti en 0=Lun (Python) via (I1-1)%7
#  BUG 4: _init_done remis à False à minuit (nouveau jour)
#  BUG 5: plages passant minuit gérées en boucle principale
#  BUG 7: accents supprimés des noms AV
#
# Ports d'ENTRÉE:
#   A1  = heure courante   (LocalTime.Hour  RF144)
#   I1  = jour semaine     (LocalTime.WDay  RF145 — 0=Dim..6=Sam Proview)
#   d1..d7 = Lun..Dim activés (DV RF147-153)
# Ports de SORTIE:
#   od1 = periode_confort  (RF302)
#   OA1 = correction_jn    (RF323)
# ============================================================

# ── Lecture entrées ──────────────────────────────────────────
heure = int(A1 or 0)          # 0-23

# wday: moteur envoie now.weekday() directement (0=Lun..6=Dim)
# Plus de conversion nécessaire depuis le fix engine
wday = int(I1 or 0)               # 0=Lun..6=Dim (Python weekday, engine patché)

jours_actifs = [bool(d1), bool(d2), bool(d3), bool(d4),
                bool(d5), bool(d6), bool(d7)]

# Noms AV sans accents (FIX BUG 7)
CODES = ["L", "M", "ME", "J", "V", "S", "D"]

# ── State init ───────────────────────────────────────────────
if "sr"         not in state: state["sr"]         = [False]*7
if "_init_done" not in state: state["_init_done"]  = False
if "_last_hour" not in state: state["_last_hour"]  = -1

# FIX BUG 4: remettre _init_done à False à minuit (changement de jour)
if heure == 0 and state["_last_hour"] == 23:
    state["_init_done"] = False
state["_last_hour"] = heure

# ── Fonction: est-on dans la plage [h_deb, h_fin[ ? ─────────
def dans_plage(h, h_deb, h_fin):
    if h_deb == h_fin:
        return False          # plage nulle = jamais actif
    if h_deb < h_fin:
        return h_deb <= h < h_fin
    else:                     # FIX BUG 5: passage minuit
        return h >= h_deb or h < h_fin

# ── Init au (re)démarrage: recalcul SR depuis heure courante ─
if not state["_init_done"]:
    for j in range(7):
        if not jours_actifs[j]:
            state["sr"][j] = False
            continue
        cod   = CODES[j]
        h_deb = int(read_analog(f"Prog_Heure_Debut_{cod}") or 0)
        h_fin = int(read_analog(f"Prog_Heure_Fin_{cod}")   or 0)
        # Actif si c'est le bon jour ET dans la plage
        state["sr"][j] = (wday == j) and dans_plage(heure, h_deb, h_fin)
    state["_init_done"] = True

# ── Boucle principale: SET/RESET par comparaison de plage ───
# FIX BUG 1: comparaison de plage → fiable à chaque scan
for j in range(7):
    if not jours_actifs[j]:
        state["sr"][j] = False
        continue

    cod   = CODES[j]
    h_deb = int(read_analog(f"Prog_Heure_Debut_{cod}") or 0)
    h_fin = int(read_analog(f"Prog_Heure_Fin_{cod}")   or 0)

    if wday == j:
        # On est le bon jour: SET si dans plage, RESET sinon
        state["sr"][j] = dans_plage(heure, h_deb, h_fin)
    else:
        # Pas le bon jour → toujours éteint
        state["sr"][j] = False

# ── Sortie ───────────────────────────────────────────────────
od1 = any(state["sr"])

corr_jn = float(read_analog("Correction_Jour_Nuit") or 0.0)
OA1 = 0.0 if od1 else corr_jn  # FIX: 0 pendant confort(jour), corr_jn pendant nuit
