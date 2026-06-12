# ============================================================
# pyblock  : solaire_thermique
# Projet   : Régulation maison solaire + chaudière
# Auteur   : regulech — modifié pour vanne monostable V3V
# VERSION  : CORRIGÉE — 2026
#
# ── CORRECTIONS APPLIQUÉES ──────────────────────────────────
# [FIX 1] od2 (signal "position chaudière" pour RUNTIMCNT) :
#         od2_ref était absent des params → valeur perdue.
#         
# [FIX 2] Toutes les lectures AV protégées contre None :
#         float(x or 0.0) évite TypeError si AV absente.
#
# MATÉRIEL V3V : vanne à rappel de ressort (monostable)
#   - K2 alimenté  (od1=True)  → position SOLAIRE
#   - K2 au repos  (od1=False) → position CHAUDIÈRE (ressort)
#   → K10 supprimé : inutile, la vanne revient seule
#
# Ports d'ENTRÉE :
#   A1 = T_capteurs      (sonde solaire corrigée   — RF261)
#   A2 = T_retour        (sonde retour corrigée    — RF264)
#   A3 = T_secu_max      (AV.Secu_Panneaux_Solaire_Max  — RF170)
#   A4 = T_secu_min      (AV.Secu_Panneaux_Solaire_Mini — RF171)
#   A5 = T_mini_marche   (AV.Consigne_Panneaux_Solaire_Mini — RF172)
#   A6 = hyst_retour     (AV.Hyst_RetourFroid_Solaire — RF173)
#   d1 = bp_marche       (DV BP_Marche  — RF272)
#   d2 = bp_marche_sol   (DV BP_Marche_Chauffage_Solaire — RF285)
#   d3 = forcage_v3v     (DV BP_Forcage_V3V_Solaire — RF283)
#
# Ports de SORTIE :
#   od1 = K2 (GPIO11)  → vanne solaire (alimenté=solaire, repos=chaudière)
#   od2 = signal "position chaudière" → RUNTIMCNT B1034
#              ⚠ Ajouter od2_ref dans params Studio !
#   od3 = run_compteur → CompteurSolaire.run (RF179)
#   OA1 = delta_T      (T_capteurs − T_retour, synoptique)
# ============================================================

T_cap    = float(A1 or 0.0)   # Temp capteurs thermiques
T_ret    = float(A2 or 0.0)   # Temp retour froid
T_secu_h = float(A3 or 0.0)   # Sécurité haute panneaux
T_secu_l = float(A4 or 0.0)   # Sécurité basse panneaux
T_mini   = float(A5 or 0.0)   # Consigne mini de marche
hyst     = float(A6 or 0.0)   # Hystérésis retour froid

bp_marche     = bool(d1)
bp_marche_sol = bool(d2)
forcage_v3v   = bool(d3)

# ── Initialisation state ─────────────────────────────────────
if "t2"    not in state: state["t2"]    = 0.0   # Timer2 (120s délai avant solaire)
if "waith" not in state: state["waith"] = 0.0   # Anti-court-cycle (30s délai retombée)
if "v3v"   not in state: state["v3v"]   = False # état courant V3V

# ── Sécurités panneaux ───────────────────────────────────────
secu_haute = T_cap >= T_secu_h
secu_basse = T_cap <= T_secu_l
secu_ok    = (not secu_haute) and (not secu_basse)

# ── Condition de marche solaire ──────────────────────────────
OA1_crit = T_ret + hyst
cond_dt  = (OA1_crit < T_cap) and bp_marche and bp_marche_sol and secu_ok
cond_dt  = cond_dt and (T_cap > T_mini)

# ── Timer 120s avant autorisation solaire ────────────────────
if cond_dt or forcage_v3v:
    state["t2"] += dt
else:
    state["t2"] = 0.0

timer2_ok = state["t2"] >= 120.0

# ── Anti-court-cycle : délai 30s avant retombée ──────────────
if not (cond_dt or forcage_v3v):
    state["waith"] += dt
else:
    state["waith"] = 0.0

waith_off = state["waith"] >= 30.0

# ── Logique V3V (vanne monostable) ──────────────────────────
want_sol = (cond_dt and timer2_ok) or forcage_v3v

if want_sol and not state["v3v"]:
    state["v3v"] = True
elif not want_sol and state["v3v"] and waith_off:
    state["v3v"] = False

# ── Sorties ──────────────────────────────────────────────────
od1 = state["v3v"]           # K2 : vanne alimentée = position SOLAIRE
od2 = not state["v3v"]       # Signal "position chaudière" pour RUNTIMCNT
                              # [FIX 1] ⚠ Câbler od2 dans Studio ou ajouter od2_ref
od3 = od1 and (bp_marche or bp_marche_sol)  # CompteurSolaire.run

# ΔT pour synoptique
OA1 = T_cap - T_ret

# Registres partagés
write_register("RF0",  OA1)           # ΔT synoptique
write_register("RF1",  float(od1))    # état V3V pour loi_eau (P8_LOI d1)
write_register("RF14", float(od3))    # run compteur solaire
