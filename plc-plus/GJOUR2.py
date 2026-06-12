# ============================================================
# pyblock  : bloc_jours
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# VERSION  : CORRIGÉE — 2026
#
# ── CORRECTIONS APPLIQUÉES ──────────────────────────────────
# [FIX 1] n_i doit être mis à 1 dans les PARAMS du bloc pour
#         que le port I1 (jour_semaine) soit créé par le runtime.
#         (Modification à faire dans RPI-PLC Studio, pas dans le code)
#
# [FIX 2] SR invalidé au reboot : à l'init, on recalcule si
#         l'heure courante est déjà dans une plage active.
#         Avant : un redémarrage pendant la période de confort
#         laissait le SR à True jusqu'à l'heure de fin suivante.
#
# [FIX 3] h_deb == h_fin : si début = fin, le SET et le RESET
#         se déclenchaient dans le même scan → bistable toujours False.
#         Maintenant on vérifie SET avant RESET avec elif.
#
# Ports d'ENTRÉE (à câbler dans RPI-PLC Studio) :
#   A1  = heure_courante     (LocalTime.Hour  — RF144)
#   I1  = jour_semaine       (LocalTime.WDay  — 0=lun..6=dim)
#              ⚠ n_i DOIT être 1 dans les params du bloc !
#   d1..d7 = Lundi..Dimanche (DV_tor actifs — RF147-RF153)
#   AV  heures : lire via read_analog("Prog_Heure_de_début_L") etc.
#
# Port de SORTIE :
#   od1 = periode_confort    (→ loi_eau + chaudiere — RF302)
#   OA1 = correction_jn active (float, pour affichage)
#
# Variables state (persistantes) :
#   state["sr"][j]       = flip-flop SR par jour (0-6)
#   state["_init_done"]  = flag d'initialisation (FIX 2)
# ============================================================

# ── Lecture heure courante ──────────────────────────────────
heure = int(A1)          # A1 = heure 0-23 (LocalTime.Hour)
wday  = int(I1)          # I1 = 0=lun..6=dim (LocalTime.WDay)

# Jours actifs : d1=Lundi, d2=Mardi, ... d7=Dimanche
jours_actifs = [d1, d2, d3, d4, d5, d6, d7]

# Noms des jours pour les clés AV (L M ME J V S D)
CODES = ["L", "M", "ME", "J", "V", "S", "D"]

# ── [FIX 2] Initialisation SR avec recalcul horaire ─────────
if "sr" not in state:
    state["sr"]        = [False] * 7
    state["_init_done"] = False

# Premier scan après (re)démarrage : recalculer les SR
# depuis l'heure courante pour éviter un confort "fantôme"
if not state["_init_done"]:
    for j in range(7):
        if not jours_actifs[j]:
            state["sr"][j] = False
            continue
        cod   = CODES[j]
        h_deb = int(read_analog(f"Prog_Heure_de_début_{cod}") or 0)
        h_fin = int(read_analog(f"Prog_Heure_de_fin_{cod}")   or 0)
        # On est dans la plage si wday==j ET heure dans [h_deb, h_fin[
        if wday == j and h_deb != h_fin:
            if h_deb < h_fin:
                state["sr"][j] = h_deb <= heure < h_fin
            else:                          # plage qui passe minuit
                state["sr"][j] = heure >= h_deb or heure < h_fin
        else:
            state["sr"][j] = False
    state["_init_done"] = True

# ── Boucle sur les 7 jours ──────────────────────────────────
for j in range(7):
    if not jours_actifs[j]:
        state["sr"][j] = False
        continue

    cod   = CODES[j]
    h_deb = int(read_analog(f"Prog_Heure_de_début_{cod}") or 0)
    h_fin = int(read_analog(f"Prog_Heure_de_fin_{cod}")   or 0)

    # [FIX 3] elif : évite SET+RESET dans le même scan si h_deb==h_fin
    if wday == j:
        if heure == h_deb and h_deb != h_fin:
            state["sr"][j] = True     # SET
        elif heure == h_fin:
            state["sr"][j] = False    # RESET

# ── Sortie période confort ───────────────────────────────────
od1 = any(state["sr"])              # OR de tous les SR_R

# Correction jour/nuit disponible si confort actif
corr_jn = read_analog("Correction_Jour_Nuit") or 0.0
OA1 = float(corr_jn) if od1 else 0.0

# Écriture registre pour synoptique
