# ============================================================
# pyblock  : solaire_thermique
# VERSION  : V5 — correction cond_dt (deadlock V3V)
#
# ── BUG V4 (corrigé ici) ────────────────────────────────────
# La formule cond_dt V4 contenait :
#   (T_cap > T_ret) OR (T_BalB < T_cap + hyst)
#
# Problème : la 2e condition T_BalB < T_cap + hyst reste VRAIE
# dès que T_cap > T_BalB − hyst (soit ~18°C avec hyst=5 et
# T_BalB=23°C).
# → cond_dt = True MÊME quand T_cap < T_BalB
# → not(cond_dt) = False → waith ne s'accumule jamais
# → V3V BLOQUÉE en position solaire toute la journée (deadlock)
#
# CORRECTION : remplacer par le différentiel physique
#   deltaT = T_cap − T_BalB
#   cond_dt = deltaT > 0  (panneau réellement plus chaud que ballon)
# Les timers 120 s (démarrage) et 30 s (arrêt) assurent
# l'anti-oscillation sans fausser la condition de base.
#
# Ports :
#   A1=T_cap    A2=T_ret    A3=T_secu_h  A4=T_secu_l
#   A5=T_mini   A6=hyst(inutilisé dans cond_dt)  A7=T_BalB
#   d1=bp_marche  d2=bp_marche_sol  d3=forcage_v3v
#   od1=K2(solaire)  od2=K10(chaudière)  OA1=deltaT
# ============================================================

T_cap    = float(A1 or 0.0)
T_ret    = float(A2 or 0.0)
T_secu_h = float(A3 or 0.0)
T_secu_l = float(A4 or 0.0)
T_mini   = float(A5 or 0.0)
hyst     = float(A6 or 0.0)   # conservé pour compatibilité (non utilisé dans cond_dt)
T_BalB   = float(A7 or 0.0)

bp_marche     = bool(d1)
bp_marche_sol = bool(d2)
forcage_v3v   = bool(d3)

if "t2"    not in state: state["t2"]    = 0.0
if "waith" not in state: state["waith"] = 0.0
if "v3v"   not in state: state["v3v"]   = False

secu_ok = (T_cap < T_secu_h) and (T_cap > T_secu_l)

# ── Condition différentielle (V5) ────────────────────────────
# Le panneau doit être PLUS CHAUD que le bas du ballon.
# Les timers 120 s / 30 s assurent l'anti-oscillation.
deltaT = T_cap - T_BalB

cond_dt = (
    deltaT > 0
    and bp_marche
    and bp_marche_sol
    and secu_ok
    and (T_cap > T_mini)
)

# ── Timer 120 s (démarrage) ───────────────────────────────────
# Ne tourne QUE quand v3v=False (mise en marche seulement)
if not state["v3v"]:
    if cond_dt or forcage_v3v:
        state["t2"] = min(120.0, state["t2"] + dt)
    else:
        state["t2"] = 0.0
timer2_ok = state["t2"] >= 120.0

# ── Timer 30 s anti-court-cycle (arrêt) ──────────────────────
# Ne tourne QUE quand v3v=True ET cond_dt devient False.
# Ne se remet PAS à zéro si cond_dt revient brièvement.
# Seul le passage v3v→False remet waith à zéro.
if state["v3v"] and not (cond_dt or forcage_v3v):
    state["waith"] += dt
elif not state["v3v"]:
    state["waith"] = 0.0
waith_off = state["waith"] >= 30.0

# ── Machine d'état V3V ───────────────────────────────────────
if not state["v3v"]:
    # OFF → ON : panneau chaud confirmé depuis 120 s
    if (cond_dt and timer2_ok) or forcage_v3v:
        state["v3v"] = True
        state["waith"] = 0.0
else:
    # ON → OFF : panneau froid depuis 30 s (accumulé sans reset)
    if not (cond_dt or forcage_v3v) and waith_off:
        state["v3v"] = False
        state["t2"] = 0.0

# ── Sorties ──────────────────────────────────────────────────
od1 = state["v3v"] and bp_marche and bp_marche_sol   # K2 — V3V solaire
od2 = not od1                                          # K10 — V3V chaudière (miroir exact)
OA1 = deltaT   # différentiel panneau − ballon bas (plus lisible en synoptique)
