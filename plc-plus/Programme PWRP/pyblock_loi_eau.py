# ============================================================
# pyblock  : loi_eau  (Plancher Chauffant)
# Version  : 2.0 — Corrections Avril 2026
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — transposition Proview 25-NOV-2023
# Remplace : CArit75, CArit232, Mux77, Timer11/12/21/22,
#            Wait×6, XOr3/8/9, Inv30/31, SR_R13/14, K7K8/K9
#
# Corrections v2.0 :
#   C1 — BP_Marche général : arrêt total si marche générale=False
#   C2 — BP_Marche_Cauffage_Solaire : od5 bloque forcage_open
#          (sécurité surchauffe prioritaire sur tout forçage)
#   C3 — Anti-gommage : séquence complète 6 s
#          (circ seul 2s → V3V ouverture 2s → V3V fermeture 2s)
#   C4 — Variables mortes sr13/sr14 supprimées du state
#
# Ports d'ENTRÉE (câbler dans RPI-PLC Studio) :
#   A1 = T_exterieur          (ANA1 + CTN_2)
#   A2 = T_ambiance           (ANA0 + CTN_1)
#   A3 = T_depart             (ANA6 + CTN_7 — départ chauffage)
#   A4 = T_consigne_ambiance  (AV.Conssigne_Ambiance)
#   A5 = correction_jn        (AV.Correction_Jour_Nuit)
#   A6 = correction_depart_sol(AV.Corection_Depart_V3V_Solaire)
#   A7 = T_depart_max         (AV.Conssigne_Depart_V3V_Max)
#   A8 = T_degommage          (AV.Cons_temp_de_marche_Degommage)
#   d1 = v3v_solaire_pos      (← RF1 de solaire_thermique)
#   d2 = marche_chauffage     (DV_tor-BP_Marche_Arret_Chauffage)
#   d3 = marche_sol           (DV_tor-BP_Marche_Cauffage_Solaire)
#   d4 = periode_confort      (← bloc Jours od1)
#   d5 = forcage_circ         (DV_tor-BP_Forcage_Circulateur_Planché)
#   d6 = forcage_close        (DV_tor-BP_Forcage_v3v_close)
#   d7 = forcage_open         (DV_tor-BP_Forcage_v3v_open)
#   d8 = arret_v3v            (DV_tor-BP_Arret_V3V)
#
# Ports de SORTIE :
#   OA1 = consigne_depart_chaudiere (loi d'eau brute → chaudiere)
#   OA2 = consigne_depart_solaire   (OA1 + correction sol)
#   OA3 = consigne_ambiance_corr    (Tj/N corrigé — affichage)
#   od1 = circ_plancher_on          → K9_Circulateur_Planche (GPIO6)
#   od2 = v3v_inc                   → K7_K8 BaseDirValve.oinc (GPIO17)
#   od3 = v3v_dec                   → K7_K8 BaseDirValve.odec (GPIO4)
#   od4 = demande_chaudiere_plancher→ pyblock chaudiere.d3
#   od5 = surchauffe_depart         (info — départ > consigne)
# ============================================================

T_ext        = A1
T_amb        = A2
T_dep        = A3
T_cons_amb   = A4
corr_jn      = A5
corr_dep_sol = A6
T_dep_max    = A7
T_degom      = A8

v3v_sol_pos  = d1
marche_ch    = d2
marche_sol   = d3
confort      = d4
forcage_circ = d5
forcage_close= d6
forcage_open = d7
arret_v3v    = d8

# ── State persistant entre cycles ──────────────────────────
# C4 : sr13/sr14 supprimés (n'étaient jamais utilisés)
if "t11"     not in state: state["t11"]     = 0.0    # Timer11 (4s) dépl. V3V
if "t21"     not in state: state["t21"]     = 0.0    # Timer21 (15s) période
if "t7"      not in state: state["t7"]      = 0.0    # Timer7  (1800s anti-gom)
if "t_gom"   not in state: state["t_gom"]   = 0.0    # C3 : séquence anti-gom (6s)
if "v3v_p"   not in state: state["v3v_p"]   = 0      # commande V3V (-1, 0, +1)
if "od5_prev"not in state: state["od5_prev"]= False  # surchauffe départ cycle N-1

# ── C1 : BP_Marche général ────────────────────────────────
# Si la marche générale est coupée → tout OFF, registres remis à 0
bp_marche_general = read_signal("BP_Marche")
if not bp_marche_general:
    od1 = od2 = od3 = od4 = od5 = False
    OA1 = OA2 = OA3 = 0.0
    # Remise à zéro douce pour éviter reprise brusque
    state["v3v_p"] = 0
    state["t11"]   = 0.0
    state["t21"]   = 0.0
    write_register("RF5", 0.0)
    write_register("RF6", 0.0)
    write_register("RF7", 0.0)
    write_register("RF8", 0.0)

else:

    # ── CArit75 — Loi d'eau ────────────────────────────────
    # OA1 = 0.6*(Tc - Text) + Tc   (loi d'eau linéaire extérieur)
    OA1 = 0.6 * (T_cons_amb - T_ext) + T_cons_amb
    OA1 = min(OA1, T_dep_max)        # sécurité départ max

    # OA2 = consigne solaire (+ correction si V3V en position sol)
    OA2 = OA1 + corr_dep_sol if v3v_sol_pos else OA1

    # OA3 = consigne ambiance corrigée Jour/Nuit
    OA3 = T_cons_amb + corr_jn if confort else T_cons_amb

    # Demande de chauffe (ambiance < consigne Tj/N)
    demande_chauff = T_amb < OA3

    # Consigne active selon position V3V
    consigne_active = OA2 if v3v_sol_pos else OA1

    # ── Surchauffe départ V3V (d2 de CArit75) ─────────────
    od5 = T_dep > (consigne_active + 0.5)

    # ── Circulateur plancher chaudière (si pas sol) ───────
    od6_circ_ch = (not v3v_sol_pos) and marche_ch and demande_chauff

    # ── Circulateur plancher solaire ──────────────────────
    od1_circ_sol = (v3v_sol_pos
                    and (not state["od5_prev"])
                    and marche_sol
                    and marche_ch
                    and demande_chauff)

    # Circulateur plancher final : OR + forçage
    od1 = od6_circ_ch or od1_circ_sol or forcage_circ

    # ── CArit232 — Régulation V3V départ ──────────────────
    # Période Timer21 = 15s
    state["t21"] += dt
    if state["t21"] >= 15.0:
        state["t21"] = 0.0
        if T_dep < (consigne_active - 0.5):
            state["v3v_p"] = 1     # → inc (ouverture)
        elif T_dep > (consigne_active + 0.5):
            state["v3v_p"] = -1    # → dec (fermeture)
        else:
            state["v3v_p"] = 0

    # Durée impulsion V3V Timer11 = 4s
    if state["v3v_p"] != 0:
        state["t11"] += dt
        if state["t11"] >= 4.0:
            state["v3v_p"] = 0
            state["t11"]   = 0.0
    else:
        state["t11"] = 0.0

    # ── C2 : Sécurité surchauffe sur forcage_open ─────────
    # od5=True (départ trop chaud) annule tout ordre d'ouverture,
    # y compris le forçage manuel — la sécurité prime sur tout
    if od5:
        forcage_open = False
        if state["v3v_p"] == 1:      # si une impulsion d'ouverture
            state["v3v_p"] = -1      # était en cours → inverser
            state["t11"]   = 0.0     # et repart impulsion fermeture

    # Forçages XOr8/9 — arret_v3v neutralise les deux relais
    if not arret_v3v:
        od2 = (state["v3v_p"] == 1)  or forcage_open    # K7 inc
        od3 = (state["v3v_p"] == -1) or forcage_close   # K8 dec
    else:
        od2 = False
        od3 = False

    # ── C3 : Anti-gommage plancher Timer7 = 1800s ─────────
    # Séquence 6s toutes les 30 min pour exercer V3V et circulateur
    #   Phase 0→2s : circulateur seul (vérif hydraulique)
    #   Phase 2→4s : ouverture V3V (K7)
    #   Phase 4→6s : fermeture V3V (K8)
    state["t7"] += dt
    if state["t7"] >= 1800.0:
        state["t7"]   = 0.0
        state["t_gom"]= 6.0          # arme la séquence

    if state["t_gom"] > 0:
        state["t_gom"] -= dt
        od1 = True                   # circulateur actif toute la séquence
        if not arret_v3v:
            if   state["t_gom"] > 4.0:   # 0→2s : circ seul
                pass                      # od2/od3 déjà calculés
            elif state["t_gom"] > 2.0:   # 2→4s : ouvrir V3V
                od2 = True;  od3 = False
            else:                         # 4→6s : fermer V3V
                od2 = False; od3 = True

    # ── Demande chaudière pour plancher ───────────────────
    od4 = demande_chauff and marche_ch and (not v3v_sol_pos)

    # ── Mémorisation surchauffe pour cycle suivant ─────────
    state["od5_prev"] = od5

    # ── Registres partagés inter-pyblocks ─────────────────
    write_register("RF5", OA1)          # consigne départ → chaudiere.A4
    write_register("RF6", float(od1))   # circ plancher  → ecs.d4 + chaudiere.d6
    write_register("RF7", float(od4))   # demande planch → chaudiere.d3
    write_register("RF8", float(od5))   # surchauffe     → info synoptique
