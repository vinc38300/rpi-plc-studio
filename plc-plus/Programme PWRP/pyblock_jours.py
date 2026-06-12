# ============================================================
# pyblock  : bloc_jours
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# Remplace : CArit116/127/132/148-153, 7×SR_R, ~60 nœuds
#
# Ports d'ENTRÉE (à câbler dans RPI-PLC Studio) :
#   A1  = heure_courante     (LocalTime.Hour  — RF14)
#   I1  = jour_semaine       (LocalTime.WDay  — 0=lun..6=dim)
#   d1..d7 = Lundi..Dimanche (DV_tor actifs)
#   AV  heures : lire via read_analog("Prog_Heure_de_début_L") etc.
#
# Port de SORTIE :
#   od1 = periode_confort    (→ loi_eau + chaudiere)
#   OA1 = correction_jn active (float, pour affichage)
#
# Variables state (persistantes) :
#   state["sr"][j]  = flip-flop SR par jour (0-6)
# ============================================================


# ── Lecture heure courante ──────────────────────────────────
heure = int(A1)          # A1 = heure 0-23 (LocalTime.Hour)
wday  = int(I1)          # I1 = 0=lun..6=dim (LocalTime.WDay)

# Jours actifs : d1=Lundi, d2=Mardi, ... d7=Dimanche
jours_actifs = [d1, d2, d3, d4, d5, d6, d7]

# Noms des jours pour les clés AV (L M ME J V S D)
CODES = ["L", "M", "ME", "J", "V", "S", "D"]

# ── Initialisation SR ──────────────────────────────────────
if "sr" not in state:
    state["sr"] = [False] * 7

# ── Boucle sur les 7 jours ─────────────────────────────────
for j in range(7):
    if not jours_actifs[j]:
        state["sr"][j] = False
        continue

    cod = CODES[j]
    h_deb = int(read_analog(f"Prog_Heure_de_début_{cod}"))
    h_fin = int(read_analog(f"Prog_Heure_de_fin_{cod}"))

    # SR_R équivalent : set sur heure début, reset sur heure fin
    if wday == j:
        if heure == h_deb:
            state["sr"][j] = True    # SET
        if heure == h_fin:
            state["sr"][j] = False   # RESET

# ── Sortie période confort ──────────────────────────────────
od1 = any(state["sr"])              # OR de tous les SR_R

# Correction jour/nuit disponible si confort actif
corr_jn = read_analog("Correction_Jour_Nuit")
OA1 = float(corr_jn) if od1 else 0.0

# écriture registre pour synoptique
write_register("RF13", OA1)
