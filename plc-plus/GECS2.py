# ============================================================
# pyblock  : gestion_ecs  V2 - bugs corrigés
# Ports d'ENTRÉE :
#   A1  = T_capteurs_sol  A2  = T_ballon_bas    A3  = hyst_bas
#   A4  = T_chaudiere     A5  = T_ballon_haut   A6  = hyst_haut
#   A7  = T_consigne      A8  = T_ballon_mini   A9  = T_ballon_max
#   A10 = T_bouclage
#   d1=marche_ecs_sol  d2=marche_ecs_ch  d3=prod_chaudiere
#   d4=circ_plancher   d5=bp_marche      d6=forcage_circ_sol
#   d7=forcage_circ_ch d8=v3v_sol_on
# Ports de SORTIE :
#   od1=circ_ecs_sol  od2=circ_ecs_ch  od3=demande_mini_ch
#   od4=demande_ecs_ch  od5=solaire_actif  od6=ballon_plein
#   od7=run_cpt_sol   od8=run_cpt_ch    OA1=T_consigne_corrigée
# ============================================================

T_cap_sol   = float(A1  or 0.0)
T_ball_bas  = float(A2  or 0.0)
hyst_bas    = float(A3  or 0.0)
T_chaud     = float(A4  or 0.0)
T_ball_haut = float(A5  or 0.0)
hyst_haut   = float(A6  or 0.0)
T_cons      = float(A7  or 0.0)
T_mini_bal  = float(A8  or 0.0)   # FIX: était T_ballon_mini (NameError)
T_ball_max  = float(A9  or 0.0)
T_bouclage  = float(A10 or 0.0)

marche_sol  = bool(d1)
marche_ch   = bool(d2)
prod_ch     = bool(d3)
circ_planch = bool(d4)
bp_marche   = bool(d5)
v3v_sol_on  = bool(d8)

# ── State init ───────────────────────────────────────────────
if "sr_s6"  not in state: state["sr_s6"]  = False
if "sr_s7"  not in state: state["sr_s7"]  = False
if "t15"    not in state: state["t15"]    = 0.0
if "t16"    not in state: state["t16"]    = 0.0
if "w17"    not in state: state["w17"]    = 0.0
if "w26"    not in state: state["w26"]    = 0.0
if "sr_ecs" not in state: state["sr_ecs"] = False

# ── Sécurité ballon max ──────────────────────────────────────
secu_max_ok = T_ball_haut < T_ball_max

# ── Condition circulateur solaire ────────────────────────────
od1_cond = (
    T_cap_sol > (T_ball_bas + hyst_bas)
    and marche_sol
    and bp_marche
    )

# od5 : solaire actif (capacité à chauffer)
od5 = (T_cap_sol + hyst_bas) >= T_ball_bas

# SR_S6 : tempo 5s anti-micro-démarrage solaire
if od1_cond:
    state["w17"] += dt
    if state["w17"] >= 5.0:
        state["sr_s6"] = True
else:
    state["w17"] = 0.0

# t15 : anti-court-cycle 15s avant arrêt solaire
if not od1_cond and state["sr_s6"]:
    state["t15"] += dt
    if state["t15"] >= 15.0:
        state["sr_s6"] = False
        state["t15"]   = 0.0
else:
    state["t15"] = 0.0

# ── Condition circulateur chaudière ECS ─────────────────────
# FIX: parenthèses corrigées + T_ballon_mini -> T_mini_bal
# Démarrage circulateur ECS chaudière :
#   - T_ball_haut < T_mini_bal : ballon haut trop froid (mini prioritaire)
#   - T_ball_haut < T_cons     : ballon haut sous consigne normale
# COUPURE : T_ball_haut >= T_cons
ballon_plein = T_ball_haut >= T_cons

# K6 ne démarre que si la chaudière est assez chaude
# T_chaud = A4 = sonde température chaudière directe
chaudiere_chaude = T_chaud > (T_cons - 5.0)

od2_cond = (
    (T_ball_haut < T_mini_bal)        # urgence : ballon haut sous mini
    or (T_ball_haut < T_cons)         # normal  : ballon haut sous consigne
) and not ballon_plein and marche_ch and bp_marche and chaudiere_chaude

# SR_S7 : tempo 12s anti-micro-démarrage chaudière ECS
if od2_cond:
    state["w26"] += dt
    if state["w26"] >= 12.0:
        state["sr_s7"] = True
else:
    state["w26"] = 0.0

# t16 : anti-court-cycle 15s avant arrêt chaudière ECS
if not od2_cond and state["sr_s7"]:
    state["t16"] += dt
    if state["t16"] >= 15.0:
        state["sr_s7"] = False
        state["t16"]   = 0.0
else:
    state["t16"] = 0.0

# ── od3 : demande mini ballon → chaudière ───────────────────
od3 = T_ball_bas <= T_mini_bal

# ── od4 : demande ECS chaudière (SR hystérésis) ─────────────
if T_ball_haut <= (T_cons - hyst_haut) and not v3v_sol_on:
    state["sr_ecs"] = True    # ballon froid → demande
if T_ball_haut >= T_cons:
    state["sr_ecs"] = False   # ballon chaud → stop
od4 = state["sr_ecs"]

# ── od6 : ballon plein ───────────────────────────────────────
od6 = T_ball_haut >= T_cons

# ── Sorties finales ──────────────────────────────────────────
od1 = state["sr_s6"] and secu_max_ok and bp_marche and marche_sol # circ ECS solaire
od2 = state["sr_s7"] and secu_max_ok and bp_marche and marche_ch # circ ECS chaudière

# Synoptique
OA1 = T_cons
