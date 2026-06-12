# pyblock  : loi_eau  (Plancher Chauffant) — VERSION AMÉLIORÉE v2
# VERSION  : 2026-05-31
#
# ── AMÉLIORATIONS vs v1 ──────────────────────────────────────
# [NEW 1] Correction d'ambiance : si T_amb < T_cons,
#         on augmente T_dep proportionnellement (k_amb)
# [NEW 2] Décalage (parallèle) : décalage fixe pour compenser
#         la lenteur thermique du plancher chauffant
# [NEW 3] T_ref ≠ T_cons : prise en compte des apports gratuits
#         (soleil, personnes, électroménager) via AV réglable
# [NEW 4] Tous les paramètres réglables via AV dans le synoptique
#
# Formule : T_dep = T_cons + pente × (T_ref - T_ext)
#                           + k_amb × (T_cons - T_amb)
#                           + décalage
#           clampée entre T_dep_min et T_dep_max
#
# Ports ENTRÉE :
#   A1 = T_ext          (sonde extérieure)
#   A2 = T_amb          (sonde ambiante)
#   A3 = T_dep          (sonde départ plancher)
#   A4 = T_cons_amb     (AV consigne ambiante)
#   A5 = corr_jn        (correction jour/nuit)
#   A6 = corr_dep_sol   (correction solaire)
#   A7 = T_dep_max      (AV max départ — sécu)
#   A8 = T_degom        (température dégommage V3V)
#
# NOUVEAUX AV réglables depuis synoptique :
#   "Pente_Loi_Eau"    → pente (défaut 0.7)
#   "Decalage_Loi_Eau" → parallèle °C (défaut 2.0)
#   "Tref_Loi_Eau"     → T_ref apports gratuits (défaut T_cons-2)
#   "Kamb_Loi_Eau"     → gain correction ambiance (défaut 1.5)
#   "Tdep_Min_Loi_Eau" → T départ mini (défaut 20.0)
#
# Ports SORTIE (inchangés) :
#   od1 = circulateur plancher
#   od2 = V3V ouvrir
#   od3 = V3V fermer
#   od4 = demande chauffage vers chaudière
#   od5 = surchauffe départ
#   OA1 = T_dep_consigne (affichage synoptique)
#   OA2 = T_dep_consigne avec correction solaire
#   OA3 = T_cons_amb corrigée jour/nuit
# ============================================================

T_ext        = float(A1 or 0.0)
T_amb        = float(A2 or 0.0)
T_dep        = float(A3 or 0.0)
T_cons_amb   = float(A4 or 0.0)
corr_jn      = float(A5 or 0.0)
corr_dep_sol = float(A6 or 0.0)
T_dep_max    = float(A7 or 35.0)
T_degom      = float(A8 or 0.0)

v3v_sol_pos  = bool(d1)
marche_ch    = bool(d2)
marche_sol   = bool(d3)
confort      = bool(d4)
arret_v3v    = bool(d5)

# ── Lecture paramètres AV réglables ─────────────────────────
pente    = float(read_analog("Pente_Loi_Eau")    or 0.0) or 0.7
decalage = float(read_analog("Decalage_Loi_Eau") or 0.0) if read_analog("Decalage_Loi_Eau") is not None else 2.0
T_ref    = float(read_analog("Tref_Loi_Eau")     or 0.0) or (T_cons_amb - 2.0)
k_amb    = float(read_analog("Kamb_Loi_Eau")     or 0.0) or 1.5
T_dep_min= float(read_analog("Tdep_Min_Loi_Eau") or 0.0) or 20.0

# Protections valeurs aberrantes
if pente    < 0.1 or pente    > 2.0: pente    = 0.7
if decalage < 0.0 or decalage > 10.0: decalage = 2.0
if k_amb    < 0.0 or k_amb    > 5.0: k_amb    = 1.5
if T_dep_min < 15.0 or T_dep_min > 30.0: T_dep_min = 20.0

# ── Lecture BP_Marche ────────────────────────────────────────
try:
    bp_marche_general = bool(read_signal("BP_Marche"))
except Exception:
    bp_marche_general = True

# ── State ────────────────────────────────────────────────────
if "t7"       not in state: state["t7"]       = 0.0
if "t_gom"    not in state: state["t_gom"]    = 0.0
if "v3v_pos"  not in state: state["v3v_pos"]  = 0.0
if "_cmd_ouv" not in state: state["_cmd_ouv"] = False
if "_cmd_fer" not in state: state["_cmd_fer"] = False

if not bp_marche_general:
    od1 = od2 = od3 = od4 = od5 = False
    OA1 = OA2 = OA3 = 0.0
    state["_cmd_ouv"] = False
    state["_cmd_fer"] = False
    # FIX: écriture explicite des od_refs pour compatibilité ancienne version
    # [nettoyé] od_ref gère RF218 #, 0.0)   # od1 circ plancher K9
    # [nettoyé] od_ref gère RF219 #, 0.0)   # od2 V3V ouvrir K7
    # [nettoyé] od_ref gère RF220 #, 0.0)   # od3 V3V fermer K8
    # [nettoyé] od_ref gère RF316 #, 0.0)   # od4 demande plancher → P9_CH.d3

else:
    # ── FORMULE LOI D'EAU AMÉLIORÉE ─────────────────────────
    # Correction consigne ambiante (jour/nuit)
    OA3 = T_cons_amb + corr_jn if confort else T_cons_amb

    # Écart ambiance : si la maison est froide, on monte T_dep
    ecart_amb = max(0.0, OA3 - T_amb)   # toujours positif ou nul

    # Formule complète
    T_dep_cons = (T_cons_amb
                  + pente * (T_ref - T_ext)    # courbe de chauffe
                  + k_amb * ecart_amb           # correction ambiance
                  + decalage)                   # parallèle / masse thermique

    # Clampage entre min et max
    T_dep_cons = max(T_dep_min, min(T_dep_cons, T_dep_max))

    OA1 = T_dep_cons

    # Correction solaire (apport solaire → baisser consigne départ)
    OA2 = max(T_dep_min, OA1 - corr_dep_sol) if v3v_sol_pos else OA1

    consigne_active = OA2 if v3v_sol_pos else OA1

    # ── Demande de chauffage ─────────────────────────────────
    demande_chauff = T_amb < OA3

    # ── Surchauffe départ (V3V ferme) ───────────────────────
    od5 = T_dep > (consigne_active + 0.5)

    # ── Circulateur ──────────────────────────────────────────
    od1 = marche_ch              # forçage circ géré par XOR graphique (DV synoptique)

    # ── Régulation V3V proportionnelle ──────────────────────
    TRAVEL_TIME = 133.0   # secondes
    V3V_DB      = 1.5     # bande morte °C

    if   state["_cmd_ouv"]: state["v3v_pos"] = min(100.0, state["v3v_pos"] + (dt / TRAVEL_TIME) * 100.0)
    elif state["_cmd_fer"]: state["v3v_pos"] = max(0.0,   state["v3v_pos"] - (dt / TRAVEL_TIME) * 100.0)

    kv3v_raw = read_analog("Kv3v")
    kv3v     = float(kv3v_raw) if kv3v_raw is not None else 20.0
    if kv3v == 0.0: kv3v = 20.0

    target_pos = max(0.0, min(100.0, (consigne_active - T_dep) * kv3v))
    if od5:
        target_pos = 0.0

    if not arret_v3v:
        # forçage_open / forcage_close supprimés : gérés par XOR K7/K8 graphiques
        if   False:  pass  # placeholder (forçage via DV synoptique → XOR K7/K8)
        elif target_pos > state["v3v_pos"] + V3V_DB: cmd_ouv = True;  cmd_fer = False
        elif target_pos < state["v3v_pos"] - V3V_DB: cmd_ouv = False; cmd_fer = True
        else:                                         cmd_ouv = False; cmd_fer = False
    else:
        cmd_ouv = False; cmd_fer = False

    state["_cmd_ouv"] = cmd_ouv
    state["_cmd_fer"] = cmd_fer
    od2 = cmd_ouv
    od3 = cmd_fer

    # ── Anti-gommage V3V (toutes les 30 min, 6s) ────────────
    state["t7"] += dt
    if state["t7"] >= 1800.0:
        state["t7"]   = 0.0
        state["t_gom"] = 6.0

    if state["t_gom"] > 0:
        state["t_gom"] -= dt
        od1 = True
        if not arret_v3v:
            if   state["t_gom"] > 4.0: pass
            elif state["t_gom"] > 2.0: od2 = True;  od3 = False
            else:                      od2 = False; od3 = True

    od4 = demande_chauff and marche_ch and (not v3v_sol_pos)

