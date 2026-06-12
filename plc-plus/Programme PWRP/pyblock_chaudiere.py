# ============================================================
# pyblock  : chaudiere
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# Remplace : CArit55, CArit91, XOr0/10, Inv12/14, Inv47-53,
#            Timer0/1, Wait21/22/25/31-33, And31, Pulse3,
#            SR_S8/9/10, RunTimeCntFo227M
#
# Ports d'ENTRÉE (câbler dans RPI-PLC Studio) :
#   A1 = T_chaudiere           (ANA3 + CTN_4)
#   A2 = T_ballon_haut         (ANA4 + CTN_5 — Ballon_Haut1)
#   A3 = T_retour_plancher     (ANA7 + CTN_8 — Retour_Froid_Planché)
#   A4 = T_consigne_depart     (← RF5 de loi_eau)
#   A5 = T_marche_chaudiere    (AV.Cons_Temp_de_Marche_Chaudière)
#   A6 = T_degommage           (AV.Cons_temp_de_marche_Degommage)
#   A7 = T_marche_circulateur  (AV.Cons_temp_de_marche_Circulateur)
#   d1 = demande_ecs           (← RF2 de gestion_ecs = od4 CArit81)
#   d2 = demande_mini_ecs      (← RF3 de gestion_ecs = od3 CArit81)
#   d3 = demande_plancher      (← RF7 de loi_eau = od4 CArit75)
#   d4 = prod_chaudiere        (TOR_IN_4 Contact_Production)
#   d5 = alarme_chaudiere      (TOR_IN_1 Contact_Alarme)
#   d6 = circ_plancher         (← RF6 de loi_eau)
#   d7 = circ_ecs_ch           (← RF4 de gestion_ecs)
#   d8 = v3v_solaire_pos       (← RF1 de solaire_thermique)
#   — Lire via read_signal :
#   arret_force     = read_signal("Arret_Chaudiere")
#   forcage_arret   = read_signal("BP_Forcage_Arret_Auto_Chaudiere")
#   forcage_rehausse= read_signal("Forcage_circulateur_réausse")
#   marche_chauffage= read_signal("BP_Marche_Arret_Chauffage")
#
# Ports de SORTIE :
#   od1 = autorisation_chaudiere → K1_Autorisation_Chaudiere (GPIO5)
#   od2 = circ_rehausse_on       → K4_Cir_Rehausse_Chaudiere (GPIO10)
#   od3 = run_compteur_marche    → RunTimeCntFo227M_Chaudiere.run
#   OA1 = T_chaud_plus5          (T_chaud + 5°C, pour synoptique)
# ============================================================

import math, datetime

T_chaud    = A1
T_ball_h   = A2
T_ret_pl   = A3
T_cons_dep = A4     # loi d'eau OA1
T_marche   = A5
T_degom    = A6
T_marche_c = A7

dem_ecs    = d1
dem_mini   = d2
dem_planch = d3
prod_ch    = d4
alarme     = d5
circ_pl    = d6
circ_ecs   = d7
v3v_sol    = d8

# Lectures DV complémentaires
arret_force      = read_signal("Arret_Chaudiere")
forcage_arret    = read_signal("BP_Forcage_Arret_Auto_Chaudiere")
forcage_rehausse = read_signal("Forcage_circulateur_réausse")
marche_chauffage = read_signal("BP_Marche_Arret_Chauffage")

# ── State ──────────────────────────────────────────────────
if "sr_s8"  not in state: state["sr_s8"]  = False  # SR_S8 auto ch ECS
if "sr_s9"  not in state: state["sr_s9"]  = False  # SR_S9 auto ch plancher
if "sr_s10" not in state: state["sr_s10"] = False  # SR_S10 auto ch mini
if "t0"     not in state: state["t0"]     = 0.0    # Timer0 (délai démarrage)
if "t1"     not in state: state["t1"]     = 0.0    # Timer1 (délai circulateur)
if "w21"    not in state: state["w21"]    = 0.0    # Wait21 (5s)
if "w25"    not in state: state["w25"]    = 0.0    # Wait25 (2s)
if "w31"    not in state: state["w31"]    = 0.0    # Wait31 (15s ECS)
if "pulse3" not in state: state["pulse3"] = 0.0    # Pulse3 anti-gommage
if "cpt"    not in state: state["cpt"]    = 0.0    # compteur marche (s)
if "last_day"not in state:state["last_day"]= -1    # pour anti-gommage

# ── Vérification validité température chaudière ─────────────
T_valid = (0.0 < T_chaud < 110.0)

# ── CArit55 — routage des demandes ─────────────────────────
# od1 ECS : valide ET demande ECS
auto_ecs     = T_valid and dem_ecs
# od2 plancher : valide ET demande plancher ET V3V pas en sol
auto_planch  = T_valid and dem_planch and (not v3v_sol)

# SR_S8 : autorisation ECS
if auto_ecs:                state["sr_s8"] = True
if dem_ecs is False:        state["sr_s8"] = False

# SR_S9 : autorisation plancher
if auto_planch:             state["sr_s9"] = True
if not dem_planch:          state["sr_s9"] = False

# SR_S10 : autorisation mini ballon
if dem_mini:                state["sr_s10"] = True
if T_ball_h >= read_analog("Conssigne_Ballons"): state["sr_s10"] = False

# ── CArit91 — réhausse + contrôle T° ───────────────────────
OA1_plus5 = T_chaud + 5.0
T_cible   = max(T_cons_dep, T_ball_h)

# od2 : contrôle température (T_chaud+5 suffisant)
od2_ctrl = (OA1_plus5 >= T_cible) and (OA1_plus5 > 65.0)

# od1 : demande de réhausse circulateur
# si contrôle OK, pas de prod, autorisation, ET circ pl ou ecs
auto_ch = state["sr_s8"] or state["sr_s9"] or state["sr_s10"]
od1_reh = od2_ctrl and (not prod_ch) and (not forcage_arret) and auto_ch \
          and (circ_pl or circ_ecs)

# od3 : si aucun circ ET pas marche → éteint (Inv51-53)
od3_on = (circ_pl or circ_ecs) or marche_chauffage

# ── Anti-gommage annuel (Pulse3, 3s — I1=30 janv) ──────────
now = datetime.datetime.now()
if now.month == 1 and now.day == 30 and state["last_day"] != 30:
    state["last_day"] = 30
    state["pulse3"]   = 3.0  # arme l'impulsion 3s

if state["pulse3"] > 0:
    state["pulse3"] -= dt
    auto_ch = True   # forçage brève autorisation

# ── XOr0 : bascule auto / forçage arrêt ────────────────────
if arret_force:
    auto_ch = False
    state["sr_s8"] = state["sr_s9"] = state["sr_s10"] = False

# ── Délai Wait21=5s avant circulateur réhausse ─────────────
if od1_reh or forcage_rehausse:
    state["w21"] += dt
else:
    state["w21"] = 0.0

circ_reh_ok = (state["w21"] >= 5.0) or forcage_rehausse

# ── Autorisation chaudière finale ──────────────────────────
# K1 : AND(auto_ch, !alarme, marche, !arret)
auto_final = auto_ch and (not alarme) and (not arret_force) and od3_on

# Temporisation démarrage Timer0 = 0s (immédiat dans Proview)
od1 = auto_final

# Circulateur réhausse K4
od2 = circ_reh_ok and auto_final

# Compteur de marche
od3 = od1
if od3: state["cpt"] += dt

# ── Sorties analogiques ────────────────────────────────────
OA1 = OA1_plus5   # T_chaud+5 pour synoptique

write_register("RF9",  float(od1))   # autorisation → synoptique
write_register("RF10", float(od2))   # réhausse → synoptique
