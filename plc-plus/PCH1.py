# ============================================================
# pyblock  : chaudiere
# Projet   : Régulation maison solaire + chaudière
# Auteur   : vinc
# VERSION  :  v1 — 2026-06-03
#
#
# Ports d'ENTRÉE :
#   A1 = T_chaudiere              (RF247)
#   A2 = T_ballon_haut            (RF114)
#   A3 = T_retour_plancher        (RF123)
#   A4 = T_consigne_depart        (RF318 ← loi_eau od4)
#   A5 = duree_marche_chaudiere   (RF227  DURÉE en minutes mini de marche chaudière
#   A6 = T_degommage              (RF209)le tepms de fonctionemment minimum de dégommage sec
#   A7 = T_marche_circulateur     (RF229)le tepms de fonctionemment minimum des circulateurs sec
#   A8 = T_consigne_ballons       (RF186)
#   A9 = T_bouclage               (RF270  verrou démarrage uniquement)
#   d1 = demande_ecs              (RF310 ← gestion_ecs od1)
#   d2 = demande_mini_ecs         (RF312 ← gestion_ecs od3)
#   d3 = demande_plancher         (RF316 ← loi_eau od4)
#   d4 = prod_chaudiere           (TOR_IN_4 Contact_Production)
#   d5 = alarme_chaudiere         (TOR_IN_1 Contact_Alarme)
#   d6 = circ_plancher            (RF218 ← loi_eau od6)
#   d7 = circ_ecs_ch              (RF196 ← gestion_ecs od4)
#   d8 = v3v_solaire_pos          (RF177 ← solaire_thermique od1)
#   d9 = arret_force              (DV.Arret_Chaudiere RF134)
#   d10= forcage_arret_auto       (DV.BP_Forcage_Arret_Auto_Chaudiere RF300)
#   d11= forcage_rehausse         (DV.Forcage_circulateur_réhausse)
#   d12= marche_chauffage         (DV.BP_Marche_Arret_Chauffage RF130)
#
# Ports de SORTIE :
#   od1 = autorisation_chaudiere  → K1 (RF238)
#   od2 = circ_rehausse_on        → K4 (RF239)
#   od3 = run_compteur_marche          (RF307)
#   OA1 = T_chaud + 5°C (synoptique)
# ============================================================

# ── Lecture entrées ──────────────────────────────────────────
T_chaud              = float(A1 or 0.0)   # T° chaudière
T_ball_h             = float(A2 or 0.0)   # T° ballon haut
T_ret_pl             = float(A3 or 0.0)   # T° retour plancher
T_cons_dep           = float(A4 or 0.0)   # consigne départ plancher (← loi_eau)
duree_marche_chaud   = float(A5 or 0.0)   # DURÉE de marche 
T_degom              = float(A6 or 0.0)   # Temps de anti-gommage
T_marche_c           = float(A7 or 0.0)   # T° déclenchement circulateurs
T_cons_bal           = float(A8 or 0.0)   # consigne ballons ECS
T_bouclage           = float(A9 or 0.0)   # T° bouclage (verrou démarrage uniquement)

dem_ecs          = bool(d1)
dem_mini         = bool(d2)
dem_planch       = bool(d3)
prod_ch          = bool(d4)
alarme           = bool(d5)
circ_pl          = bool(d6)
circ_ecs         = bool(d7)
v3v_sol          = bool(d8)
arret_force      = bool(d9)
forcage_arret    = bool(d10)
forcage_rehausse = bool(d11)
marche_chauffage = bool(d12)

# ── State persistant ─────────────────────────────────────────
if "sr_s8"    not in state: state["sr_s8"]    = False
if "sr_s9"    not in state: state["sr_s9"]    = False
if "sr_s10"   not in state: state["sr_s10"]   = False
if "w21"      not in state: state["w21"]      = 0.0
if "pulse3"   not in state: state["pulse3"]   = 0.0
if "cpt"      not in state: state["cpt"]      = 0.0
if "last_day" not in state: state["last_day"] = -1

# ── Validité T° chaudière ────────────────────────────────────
T_valid = (0.0 < T_chaud < 110.0)

# Plancher chauffant :
#   "assez chaud" = T_bouclage ≥ T_cons_dep (consigne départ loi d'eau)
#   Ex : T_bouclage 28°C < T_cons_dep 30.5°C → chaudière nécessaire
#   Ex : T_bouclage 45°C ≥ T_cons_dep 25°C  → solaire suffit, chaudière bloquée
bouclage_ok_planch = (T_bouclage >= T_cons_dep) 

# ECS / Ballons :
#   "assez chaud" = T_bouclage proche de la consigne ballon (seuil +5°C)
#   Ex : T_bouclage 28°C < T_cons_bal 78°C+5 = 84°C → chaudière nécessaire
#   Ex : T_bouclage 74°C ≥ 73°C → chaleur résiduelle suffisante
bouclage_ok_ecs = (T_bouclage >= (T_ball_h + 5.0))

# ── SR_S8 : ECS chaudière ─────────────────────────────────────
#   SET   : dem_ecs ET T° valide ET bouclage insuffisant pour ECS
#   RESET : demande ECS terminée (ballon plein ou mode éteint)
auto_ecs = T_valid and dem_ecs and (not bouclage_ok_ecs)
if auto_ecs:    state["sr_s8"] = True
if not dem_ecs: state["sr_s8"] = False

# ── SR_S9 : plancher chauffant ────────────────────────────────
#   SET   : dem_planch ET solaire insuffisant ET bouclage froid
#   RESET : demande plancher terminée
auto_planch = T_valid and dem_planch and (not bouclage_ok_planch) and ( not v3v_sol)
if auto_planch:    state["sr_s9"] = True
if not dem_planch: state["sr_s9"] = False

# ── SR_S10 : mini ballon ──────────────────────────────────────
#   SET   : dem_mini ET bouclage insuffisant pour ECS
#   RESET : ballon plein (T_ball_h ≥ consigne)
if dem_mini and (not bouclage_ok_ecs): state["sr_s10"] = True
if T_ball_h >= T_cons_bal:             state["sr_s10"] = False

# ── Autorisation globale chaudière ───────────────────────────
auto_ch = state["sr_s8"] or state["sr_s9"] or state["sr_s10"]

# ── Anti-gommage annuel (30 janvier, 30 s) ───────────────────
# datetime est fourni par le moteur PyBlock
now = datetime.datetime.now()
if now.month == 1 and now.day == 30 and state["last_day"] != 30:
    state["last_day"] = 30
    state["pulse3"]   = 30.0
if state["pulse3"] > 0:
    state["pulse3"] -= dt
    auto_ch = True   # force l'autorisation pendant le pulse

# ── Arrêt forcé — priorité absolue ──────────────────────────
if arret_force:
    auto_ch = False
    state["sr_s8"] = state["sr_s9"] = state["sr_s10"] = False

# ── Autorisation chaudière finale ────────────────────────────
auto_final = (auto_ch
              and (not alarme)
              and (not arret_force)
              and marche_chauffage
              )
od1 = auto_final   # K1 — autorisation brûleur

# ── Circulateur réhausse K4 ─────────────────────────────────
# K4 = récupération chaleur résiduelle par inertie uniquement.
# Déclenché par forcage_rehausse (DV manuel dans synoptique).
# Quand chaudière à l'arrêt : ouvre V3V + K4 pour vider
# ballon tampon et chaudière de leur chaleur résiduelle.
# T_marche_c = seuil T° mini bouclage pour autoriser K4
bouclage_chaud = T_bouclage >= ((T_ball_h + 5.0) or (T_cons_dep))
od2 = forcage_rehausse or bouclage_chaud   # K4 — réhausse inertie


