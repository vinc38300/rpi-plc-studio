# ============================================================
# pyblock  : gestion_ecs
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# VERSION  : CORRIGÉE — 2026
#
# ── CORRECTIONS APPLIQUÉES ──────────────────────────────────
# [FIX CRITIQUE] SR_ECS : logique set/reset corrigée.
#   AVANT (bug) : od6_set = T_ball_haut < T_cons + hyst
#                 od7_reset = T_ball_haut >= T_cons
#   → entre T_cons et T_cons+hyst les deux étaient vrais,
#     le reset gagnait → ballon jamais chauffé dans la plage normale.
#   APRÈS (correct) :
#                 SET   quand T_ball_haut <  T_cons          (ballon froid)
#                 RESET quand T_ball_haut >= T_cons + hyst   (ballon plein)
#   → l'hystérésis est au-DESSUS de la consigne, logique Proview SR standard.
#
# [FIX 2] od5, od6, od7, od8 sans référence RF dans les params :
# [FIX 3] Toutes lectures AV protégées contre None (or 0.0).
#
# Ports d'ENTRÉE :
#   A1  = T_capteurs_sol  (ANA2  — RF262)
#   A2  = T_ballon_bas    (ANA5  — RF269)
#   A3  = hyst_bas        (AV.Hyst_Ballon_Bas     — RF182)
#   A4  = T_chaudiere     (ANA3  — RF265)
#   A5  = T_ballon_haut   (ANA4  — RF260)
#   A6  = hyst_haut       (AV.Hyst_Ballon_Haut    — RF185)
#   A7  = T_consigne      (AV.Conssigne_Ballons   — RF186)
#   A8  = T_ballon_mini   (AV.Conssigne_MINI_Ballons_S_CH — RF187)
#   A9  = T_ballon_max    (AV.Conssigne_Ballons_Max — RF199)
#   A10 = T_bouclage      (ANA8 — RF271)
#   d1  = marche_ecs_sol  (DV_ECS_SOL — RF275)
#   d2  = marche_ecs_ch   (DV_ECS_CH  — RF279)
#   d3  = prod_chaudiere  (TOR_IN_4   — RF273)
#   d4  = circ_plancher   (CIRC_PL_ON — RF309)
#   d5  = bp_marche       (DV_MARCHE  — RF274)
# ####  d6  = forcage_circ_sol(DV_FCIRC_SOL — RF296)
# ####  d7  = forcage_circ_ch (DV_FCIRC_CH  — RF292)
#   d8  = v3v_sol_on      (V3V_SOL_ON   — RF304)
#
# Ports de SORTIE :
#   od1 = circ_ecs_solaire_on    → K5 (GPIO22) — RF195
#   od2 = circ_ecs_chaudiere_on  → K6 (GPIO27) — RF196
#   od3 = demande_mini_chaudiere             — RF312
#   od4 = demande_ecs_chaudiere              — RF310
#   od5 = solaire_actif   
#   od6 = ballon_plein    
#   od7 = run_compteur_sol 
#   od8 = run_compteur_ch  
#   OA1 = T_consigne_corrigée (synoptique)
# ============================================================

T_cap_sol   = float(A1  or 0.0)
T_ball_bas  = float(A2  or 0.0)
hyst_bas    = float(A3  or 0.0)
T_chaud     = float(A4  or 0.0)
T_ball_haut = float(A5  or 0.0)
hyst_haut   = float(A6  or 0.0)
T_cons      = float(A7  or 0.0)
T_mini_bal  = float(A8  or 0.0)
T_ball_max  = float(A9  or 0.0)   # Conssigne_Ballons_Max
T_bouclage  = float(A10 or 0.0)   # ANA8

marche_sol  = bool(d1)
marche_ch   = bool(d2)
prod_ch     = bool(d3)
circ_planch = bool(d4)
bp_marche   = bool(d5)
v3v_sol_on  = bool(d8)   # V3V_SOL_ON — position solaire

# ── State ────────────────────────────────────────────────────
if "sr_s6"  not in state: state["sr_s6"]  = False
if "sr_s7"  not in state: state["sr_s7"]  = False
if "t15"    not in state: state["t15"]    = 0.0
if "t16"    not in state: state["t16"]    = 0.0
if "w17"    not in state: state["w17"]    = 0.0
if "w18"    not in state: state["w18"]    = 0.0
if "w26"    not in state: state["w26"]    = 0.0
if "cpt_sol"not in state: state["cpt_sol"]= 0.0
if "cpt_ch" not in state: state["cpt_ch"] = 0.0
if "sr_ecs" not in state: state["sr_ecs"] = False

# ── Sécurité ballon max ──────────────────────────────────────
secu_max_ok = T_ball_haut < T_ball_max

# ── od1 : circulateur solaire ────────────────────────────────
od1_cond = T_cap_sol > (T_ball_bas + hyst_bas) and marche_sol and bp_marche

# od5 : solaire actif (capacité à chauffer)
od5 = (T_cap_sol + hyst_bas) >= T_cons

# Consigne ballon haut corrigée
OA1_corr = T_cons + hyst_haut

# SR_S6 : ECS solaire — temporisation 5s anti-micro-démarrage
if od1_cond:
    state["w17"] += dt
    if state["w17"] >= 5.0:
        state["sr_s6"] = True
else:
    state["w17"] = 0.0

# Timer15 anti-court-cycle circulateur solaire (15s avant arrêt)
if not od1_cond and state["sr_s6"]:
    state["t15"] += dt
    if state["t15"] >= 15.0:
        state["sr_s6"] = False
        state["t15"]   = 0.0
else:
    state["t15"] = 0.0

# ── od2 : circulateur chaudière ECS ─────────────────────────
# [CORRECTION] prod_ch supprimé — la T° chaudière suffit,
# le brûleur peut être éteint, la chaudière reste utilisable par inertie.
od2_cond = (
    (T_chaud > 60.0)              # chaudière assez chaude pour l'ECS
    and (T_chaud > T_ball_haut)   # peut encore monter le ballon
    and marche_ch                 # mode ECS chaudière activé
    and (not v3v_sol_on)          # V3V pas en position solaire
)

# SR_S7 : ECS chaudière — temporisation 12s
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
        state["t16"]   = 0.0
else:
    state["t16"] = 0.0

# ── od3 : demande mini ballon → chaudière ───────────────────
od3 = T_ball_bas <= T_mini_bal

# ── [FIX CRITIQUE] od4 : demande ECS chaudière corrigée ────
# APRÈS (correct) : hystérésis AU-DESSUS de la consigne
#   SET   quand T_ball_haut <  T_cons            (ballon froid → demander)
#   RESET quand T_ball_haut >= T_cons + hyst_haut (ballon plein → arrêter)
if T_ball_haut < T_cons:
    state["sr_ecs"] = True    # SET : ballon trop froid, demande ECS
if T_ball_haut >= T_cons + hyst_haut:
    state["sr_ecs"] = False   # RESET : ballon chaud à satisfaction
od4 = state["sr_ecs"]

# od6 : ballon plein (atteint la consigne)
od6 = T_ball_haut >= T_cons

# ── Sorties ──────────────────────────────────────────────────
od1 = od1_fin
od2 = od2_fin 
OA1 = OA1_corr

if od7: state["cpt_sol"] += dt
if od8: state["cpt_ch"]  += dt

