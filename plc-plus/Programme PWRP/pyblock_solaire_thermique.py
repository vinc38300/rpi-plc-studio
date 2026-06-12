# ============================================================
# pyblock  : solaire_thermique
# Version  : 2.0 — Corrections Avril 2026
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# Remplace : CArit56, Compl0/1, Comph0/2, XOr1, Timer2,
#            Waith3, Or5, Inv13, CompteurSolaire
#
# Correction v2.0 :
#   C1 — BP_Marche_Cauffage_Solaire (d2) intégré dans la condition
#          de démarrage V3V solaire. Avant : d2 n'influençait que
#          le compteur de marche (od3). Désormais si d2=False,
#          la V3V solaire (K2) ne peut pas s'ouvrir.
#
# Ports d'ENTRÉE (câbler dans RPI-PLC Studio) :
#   A1 = T_capteurs      (ANA2 + CTN_3 corrigé)
#   A2 = T_retour        (ANA7 + CTN_8 corrigé)
#   A3 = T_secu_max      (AV.Secu_Panneaux_Solaire_Max)
#   A4 = T_secu_min      (AV.Secu_Paneaux_Solaire_Mini)
#   A5 = T_mini_marche   (AV.Conssigne_Panneaux_Solaire_Mini)
#   A6 = hyst_retour     (AV.Hyst_RetourFroid_Solaire)
#   d1 = bp_marche       (DV_tor-BP_Marche)
#   d2 = bp_marche_sol   (DV_tor-BP_Marche_Cauffage_Solaire)
#   d3 = forcage_v3v     (DV_tor-BP_Forcage_V3V_Solaire)
#
# Ports de SORTIE :
#   od1 = v3v_solaire_on      → K2_V3V__CH_Sol_Solaire    (GPIO11)
#   od2 = v3v_chaudiere_on    → K10_V3V__CH_Sol_Chaudiere (GPIO13)
#   od3 = run_compteur        → CompteurSolaire.run
#   OA1 = delta_T             (T_capteurs − T_retour, pour synoptique)
# ============================================================

T_cap    = A1    # Temp capteurs thermiques
T_ret    = A2    # Temp retour froid
T_secu_h = A3    # Sécurité haute panneaux
T_secu_l = A4    # Sécurité basse panneaux
T_mini   = A5    # Consigne mini de marche
hyst     = A6    # Hystérésis retour froid

bp_marche    = d1
bp_marche_sol= d2
forcage_v3v  = d3

# ── Initialisation state ────────────────────────────────────
if "t2"       not in state: state["t2"]       = 0.0    # Timer2 (120s)
if "waith"    not in state: state["waith"]    = 0.0    # Waith3 anti-court-cycle
if "v3v"      not in state: state["v3v"]      = False  # état courant V3V
if "compteur" not in state: state["compteur"] = 0.0

# ── Sécurités panneaux ─────────────────────────────────────
secu_haute = T_cap >= T_secu_h    # Comph0 / Comph2
secu_basse = T_cap <= T_secu_l    # Compl0 / Compl1
secu_ok    = (not secu_haute) and (not secu_basse)

# ── CArit56 : condition de marche solaire ──────────────────
# OA1 = T_retour + hyst ; od1 si OA1 < T_cap
OA1_crit = T_ret + hyst
# C1 : bp_marche_sol (d2) intégré dans cond_dt
# Avant : cond_dt = ... and bp_marche ...
# Après : cond_dt = ... and bp_marche and bp_marche_sol ...
# → BP_Marche_Cauffage_Solaire=False bloque désormais la V3V
cond_dt = (OA1_crit < T_cap) and bp_marche and bp_marche_sol and secu_ok
cond_dt = cond_dt and (T_cap > T_mini)

# ── Timer2 = 120s avant autorisation V3V solaire ───────────
# (forcage_v3v bypass le timer — comportement voulu en maintenance)
if cond_dt or forcage_v3v:
    state["t2"] += dt
else:
    state["t2"] = 0.0

timer2_ok = state["t2"] >= 120.0

# ── Waith3 : anti-court-cycle (délai retombée ~30s) ────────
if not (cond_dt or forcage_v3v):
    state["waith"] += dt
else:
    state["waith"] = 0.0

waith_off = state["waith"] >= 30.0

# ── XOr1 / logique V3V ─────────────────────────────────────
# V3V sol ON si condition validée + timer écoulé
want_sol = (cond_dt and timer2_ok) or forcage_v3v

if want_sol and not state["v3v"]:
    state["v3v"] = True
elif not want_sol and state["v3v"] and waith_off:
    state["v3v"] = False

# ── Sorties ────────────────────────────────────────────────
od1 = state["v3v"]                              # V3V → position solaire (K2)
od2 = not state["v3v"]                          # V3V → position chaudière (K10)
od3 = od1 and (bp_marche or bp_marche_sol)      # CompteurSolaire.run

# ΔT pour synoptique
OA1 = T_cap - T_ret

# Compteur temps marche (secondes → via state)
if od3:
    state["compteur"] += dt

write_register("RF0", OA1)        # ΔT synoptique
write_register("RF1", float(od1)) # état V3V pour loi_eau (d1 CArit75)
