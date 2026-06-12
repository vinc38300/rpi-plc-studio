# ============================================================
# pyblock  : gestion_ecs
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# Remplace : CArit81, SR_S6/7, Comph4, Timer15/16, Wait17/26-29,
#            Inv15/16, CompteurECS_Solaire, CompteurECSChaudiere
#
# Ports d'ENTRÉE (câbler dans RPI-PLC Studio) :
#   A1 = T_capteurs_sol  (ANA2 + CTN_3  — Solaire_Thermique)
#   A2 = T_ballon_bas    (ANA5 + CTN_6)
#   A3 = hyst_bas        (AV.Hyst_Ballon_Bas)
#   A4 = T_chaudiere     (ANA3 + CTN_4)
#   A5 = T_ballon_haut   (ANA4 + CTN_5)
#   A6 = hyst_haut       (AV.Hyst_Ballon_Haut)
#   A7 = T_consigne      (AV.Conssigne_Ballons)
#   A8 = T_ballon_mini   (AV.Conssigne_MINI_Ballons_S_CH)
#   d1 = marche_ecs_sol  (DV_tor-BP_Marche_ECS_Solair)
#   d2 = marche_ecs_ch   (DV_tor-BP_Marche_ECS_Chaudiere)
#   d3 = prod_chaudiere  (TOR_IN_4 Contact_Production)
#   d4 = circ_plancher   (← od1 loi_eau  = d2 CArit81)
#   d5 = bp_marche       (DV_tor-BP_Marche)
#   d6 = forcage_circ_sol(DV_tor-BP_Forcage_Circulateur_Solaire)
#   d7 = forcage_circ_ch (DV_tor-BP_Forcage_Circulateur_Chaudier)
#   A_max = T_ballon_max (AV.Conssigne_Ballons_Max  lire via read_analog)
#
# Ports de SORTIE :
#   od1 = circ_ecs_solaire_on    → K5_Circulateur_ECS_Solaire  (GPIO22)
#   od2 = circ_ecs_chaudiere_on  → K6_Circulateur_ECS_Chaudiere(GPIO27)
#   od3 = demande_chaudiere_mini → pyblock chaudiere.d_mini
#   od4 = demande_chaudiere_ecs  → pyblock chaudiere.demande_ecs
#   od5 = solaire_actif          (solaire suffisant pour ECS)
#   od6 = ballon_plein           (reset ECS)
#   od7 = run_compteur_sol       → CompteurECS_Solaire.run
#   od8 = run_compteur_ch        → CompteurECSChaudiere.run
#   OA1 = T_consigne_corr        (ballon haut corrigé, pour affichage)
# ============================================================


T_cap_sol  = A1
T_ball_bas = A2
hyst_bas   = A3
T_chaud    = A4
T_ball_haut= A5
hyst_haut  = A6
T_cons     = A7
T_mini_bal = A8

# Lectures AV complémentaires
T_ball_max  = read_analog("Conssigne_Ballons_Max")
T_bouclage  = read_analog("Temp_Bouclage")   # ANA8 direct

marche_sol  = d1
marche_ch   = d2
prod_ch     = d3
circ_planch = d4
bp_marche   = d5
forcage_sol = d6
forcage_ch  = d7

# ── State ──────────────────────────────────────────────────
if "sr_s6"  not in state: state["sr_s6"]  = False   # SR_S6 circ sol
if "sr_s7"  not in state: state["sr_s7"]  = False   # SR_S7 circ ch
if "t15"    not in state: state["t15"]    = 0.0     # Timer15 (15s sol)
if "t16"    not in state: state["t16"]    = 0.0     # Timer16 (15s ch)
if "w17"    not in state: state["w17"]    = 0.0     # Wait17  (5s)
if "w18"    not in state: state["w18"]    = 0.0     # Wait18  (5s)
if "w26"    not in state: state["w26"]    = 0.0     # Wait26-29 (12s)
if "cpt_sol"not in state: state["cpt_sol"]= 0.0
if "cpt_ch" not in state: state["cpt_ch"] = 0.0

# ── CArit81 — logique ECS ──────────────────────────────────

# Sécurité ballon max (Comph4)
secu_max_ok = T_ball_haut < T_ball_max

# od1 : circulateur solaire
# (T_cap + hyst) < T_ballon_bas → manque d'énergie → circ
od1_cond = (T_cap_sol + hyst_bas) < T_ball_bas and marche_sol and bp_marche

# od5 : solaire actif (T_capteurs ≥ consigne)
od5 = ((T_cap_sol + hyst_bas) >= T_cons)

# Consigne ballon haut corrigé
OA1_corr = T_cons + hyst_haut

# SR_S6 : ECS solaire (set/reset)
if od1_cond:
    state["w17"] += dt
    if state["w17"] >= 5.0:
        state["sr_s6"] = True
else:
    state["w17"] = 0.0

# Timer15 anti-court-cycle circulateur solaire
if not od1_cond and state["sr_s6"]:
    state["t15"] += dt
    if state["t15"] >= 15.0:
        state["sr_s6"] = False
        state["t15"] = 0.0
else:
    state["t15"] = 0.0

# od2 : circulateur chaudière ECS
# T_chaud > 60°C ET production ET T_chaud > T_ballon_haut
od2_cond = (T_chaud > 60.0) and prod_ch and (T_chaud > T_ball_haut) and marche_ch

# SR_S7 : ECS chaudière
if od2_cond:
    state["w26"] += dt
    if state["w26"] >= 12.0:
        state["sr_s7"] = True
else:
    state["w26"] = 0.0

if not od2_cond and state["sr_s7"]:
    state["t16"] += dt
    if state["t16"] >= 15.0:
        state["sr_s7"] = False
        state["t16"] = 0.0
else:
    state["t16"] = 0.0

# od3 : demande mini ballon → chaudière
od3 = T_ball_bas <= T_mini_bal

# od4 : demande ECS chaudière (set/reset via od6/od7)
if "sr_ecs" not in state: state["sr_ecs"] = False
od6_set   = T_ball_haut < OA1_corr     # set
od7_reset = T_ball_haut >= T_cons      # reset
if od6_set:  state["sr_ecs"] = True
if od7_reset:state["sr_ecs"] = False
od4 = state["sr_ecs"]

# od6 : ballon plein (pour reset compteur)
od6 = T_ball_haut >= T_cons

# ── Forçages ───────────────────────────────────────────────
od1_fin = (state["sr_s6"] or forcage_sol) and secu_max_ok
od2_fin = (state["sr_s7"] or forcage_ch)  and secu_max_ok

# ── Sorties ────────────────────────────────────────────────
od1 = od1_fin                     # circ ECS solaire
od2 = od2_fin                     # circ ECS chaudière
od5 = od5                         # solaire suffisant
od7 = od1_fin                     # run compteur sol
od8 = od2_fin                     # run compteur ch

OA1 = OA1_corr                    # consigne corrigée pour synoptique

# Compteurs
if od7: state["cpt_sol"] += dt
if od8: state["cpt_ch"]  += dt

write_register("RF2", float(od4))  # demande_ecs → chaudiere d1
write_register("RF3", float(od3))  # demande_mini → chaudiere d2
write_register("RF4", float(od1))  # circ plancher info
