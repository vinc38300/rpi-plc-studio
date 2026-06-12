#!/usr/bin/env python3
"""
test_pyblocks.py — Simulateur local des 5 pyblocks sans RPi
Projet : Chauffage Maison (regulech)

Usage :
    python3 test_pyblocks.py            # tous les scénarios
    python3 test_pyblocks.py --scenario hiver
    python3 test_pyblocks.py --scenario ete
    python3 test_pyblocks.py --scenario gel
    python3 test_pyblocks.py --scenario panne_chaudiere
    python3 test_pyblocks.py --verbose
"""
import math, datetime, argparse, time, sys, json

# ─────────────────────────────────────────────────────────────
# MOTEUR PYBLOCK MINIMAL
# ─────────────────────────────────────────────────────────────
class PyBlockEngine:
    """Mini-moteur qui exécute les pyblocks dans l'ordre du scan."""

    SCAN_ORDER = [
        "jours",
        "solaire_thermique",
        "loi_eau",
        "gestion_ecs",
        "chaudiere",
    ]

    def __init__(self):
        self.registers = {f"RF{i}": 0.0 for i in range(16)}
        self.memory    = {f"M{i}": False for i in range(32)}
        self.av_vars   = {}
        self.dv_vars   = {}
        self.states    = {name: {} for name in self.SCAN_ORDER}
        self.cycle     = 0
        self.scan_dt   = 0.1   # 100 ms

        # Chargement des codes pyblocks
        self.codes = {}
        import os
        folder = os.path.dirname(os.path.abspath(__file__))
        base   = os.path.join(folder, "regulech_maison")
        for name in self.SCAN_ORDER:
            path = os.path.join(base, f"pyblock_{name}.py")
            if os.path.exists(path):
                self.codes[name] = open(path).read()
            else:
                print(f"  WARN : {path} introuvable — bloc ignoré")

    def read_analog(self, ref):
        if ref in self.registers: return self.registers[ref]
        if ref.lower() in self.av_vars: return float(self.av_vars[ref.lower()])
        return 0.0

    def read_signal(self, ref):
        if ref in self.memory:   return self.memory[ref]
        if ref in self.dv_vars:  return bool(self.dv_vars.get(ref, False))
        return False

    def write_register(self, ref, value):
        self.registers[ref] = float(value)

    def write_signal(self, ref, value):
        self.memory[ref] = bool(value)

    def run_block(self, name, inputs_a, inputs_d, inputs_i=None):
        """Exécute un pyblock avec les entrées fournies.
        inputs_a : dict A1..A8 → float
        inputs_d : dict d1..d8 → bool
        inputs_i : dict I1..I2 → int  (optionnel)
        Retourne (OA_dict, od_dict, OI1)
        """
        if name not in self.codes:
            return {}, {}, 0

        ctx = {
            **{f"A{i}": float(inputs_a.get(f"A{i}", 0.0)) for i in range(1, 9)},
            **{f"d{i}": bool(inputs_d.get(f"d{i}", False))  for i in range(1, 9)},
            **{f"I{i}": int((inputs_i or {}).get(f"I{i}", 0))for i in range(1, 3)},
            **{f"OA{i}": 0.0  for i in range(1, 9)},
            **{f"od{i}": False for i in range(1, 9)},
            "OI1": 0,
            "dt":    self.scan_dt,
            "cycle": self.cycle,
            "state": self.states[name],
            "read_analog":    self.read_analog,
            "read_signal":    self.read_signal,
            "write_register": self.write_register,
            "write_signal":   self.write_signal,
            "math": math,
            "abs": abs, "min": min, "max": max, "round": round,
        }
        try:
            exec(self.codes[name], ctx)
        except Exception as e:
            print(f"  ERREUR [{name}] : {e}")
        return (
            {f"OA{i}": ctx.get(f"OA{i}", 0.0) for i in range(1, 9)},
            {f"od{i}": ctx.get(f"od{i}", False) for i in range(1, 9)},
            ctx.get("OI1", 0),
        )

    def scan(self, scenario):
        """Un cycle de scan complet dans l'ordre P5→P6→P8→P7→P9."""
        self.cycle += 1
        T  = scenario["temperatures"]
        DV = scenario["dv"]
        AV = scenario["av"]
        now = scenario.get("now", datetime.datetime.now())

        # Charger les AV dans le moteur
        for k, v in AV.items():
            self.av_vars[k.lower()] = v
        for k, v in DV.items():
            self.dv_vars[k.lower()] = v

        results = {}

        # ── 1. BLOC JOURS ─────────────────────────────────────
        OA, od, _ = self.run_block("jours",
            {"A1": float(now.hour)},
            {f"d{j+1}": DV.get(["Lundi","Mardi","Mercredi","Jeudi",
                                  "Vendredi","Samedi","Dimanche"][j], True)
             for j in range(7)},
            {"I1": now.weekday()},
        )
        periode_confort = od["od1"]
        self.memory["M0"] = periode_confort
        results["jours"] = {"periode_confort": periode_confort}

        # ── 2. SOLAIRE THERMIQUE ──────────────────────────────
        OA, od, _ = self.run_block("solaire_thermique",
            {"A1": T["capteurs"], "A2": T["retour_froid"],
             "A3": AV.get("Secu_Panneaux_Solaire_Max", 95.0),
             "A4": AV.get("Secu_Paneaux_Solaire_Mini", 5.0),
             "A5": AV.get("Conssigne_Panneaux_Solaire_Mini", 35.0),
             "A6": AV.get("Hyst_RetourFroid_Solaire", 5.0)},
            {"d1": DV.get("BP_Marche", True),
             "d2": DV.get("BP_Marche_Cauffage_Solaire", True),
             "d3": DV.get("BP_Forcage_V3V_Solaire", False)},
        )
        v3v_sol = od["od1"]
        self.registers["RF1"] = float(v3v_sol)
        results["solaire"] = {
            "v3v_sol_on":       od["od1"],
            "v3v_chaud_on":     od["od2"],
            "run_cpt_sol":      od["od3"],
            "delta_T_capteurs": OA["OA1"],
        }

        # ── 3. LOI D'EAU / PLANCHER ──────────────────────────
        OA, od, _ = self.run_block("loi_eau",
            {"A1": T["exterieur"],  "A2": T["ambiance"],
             "A3": T["depart"],
             "A4": AV.get("Conssigne_Ambiance", 19.0),
             "A5": AV.get("Correction_Jour_Nuit", 2.0),
             "A6": AV.get("Corection_Depart_V3V_Solaire", 3.0),
             "A7": AV.get("Conssigne_Depart_V3V_Max", 50.0),
             "A8": AV.get("Cons_temp_de_marche_Degommage", 60.0)},
            {"d1": v3v_sol,
             "d2": DV.get("BP_Marche_Arret_Chauffage", True),
             "d3": DV.get("BP_Marche_Cauffage_Solaire", True),
             "d4": periode_confort,
             "d5": DV.get("BP_Forcage_Circulateur_Planché", False),
             "d6": DV.get("BP_Forcage_v3v_close", False),
             "d7": DV.get("BP_Forcage_v3v_open", False),
             "d8": DV.get("BP_Arret_V3V", False)},
        )
        circ_plancher    = od["od1"]
        consigne_depart  = OA["OA1"]
        demande_plancher = od["od4"]
        self.registers["RF5"] = consigne_depart
        self.registers["RF6"] = float(circ_plancher)
        self.registers["RF7"] = float(demande_plancher)
        results["loi_eau"] = {
            "consigne_depart":   round(OA["OA1"], 1),
            "consigne_sol":      round(OA["OA2"], 1),
            "consigne_amb_corr": round(OA["OA3"], 1),
            "circ_plancher_K9":  od["od1"],
            "v3v_inc_K7":        od["od2"],
            "v3v_dec_K8":        od["od3"],
            "demande_chaud_pl":  od["od4"],
            "surchauffe_dep":    od["od5"],
        }

        # ── 4. GESTION ECS ───────────────────────────────────
        OA, od, _ = self.run_block("gestion_ecs",
            {"A1": T["capteurs"],    "A2": T["ballon_bas"],
             "A3": AV.get("Hyst_Ballon_Bas", 3.0),
             "A4": T["chaudiere"],   "A5": T["ballon_haut"],
             "A6": AV.get("Hyst_Ballon_Haut", 5.0),
             "A7": AV.get("Conssigne_Ballons", 55.0),
             "A8": AV.get("Conssigne_MINI_Ballons_S_CH", 45.0)},
            {"d1": DV.get("BP_Marche_ECS_Solair", True),
             "d2": DV.get("BP_Marche_ECS_Chaudiere", True),
             "d3": DV.get("Contact_Production_Chaudiere", False),
             "d4": circ_plancher,
             "d5": DV.get("BP_Marche", True),
             "d6": DV.get("BP_Forcage_Circulateur_Solaire", False),
             "d7": DV.get("BP_Forcage_Circulateur_Chaudier", False)},
        )
        dem_ecs  = od["od4"]
        dem_mini = od["od3"]
        self.registers["RF2"] = float(dem_ecs)
        self.registers["RF3"] = float(dem_mini)
        self.registers["RF4"] = float(od["od2"])
        results["ecs"] = {
            "circ_ecs_sol_K5":   od["od1"],
            "circ_ecs_ch_K6":    od["od2"],
            "demande_ecs_chaud": od["od4"],
            "demande_mini":      od["od3"],
            "solaire_actif":     od["od5"],
            "ballon_plein":      od["od6"],
        }

        # ── 5. CHAUDIÈRE ─────────────────────────────────────
        OA, od, _ = self.run_block("chaudiere",
            {"A1": T["chaudiere"],   "A2": T["ballon_haut"],
             "A3": T["retour_froid"],"A4": consigne_depart,
             "A5": AV.get("Cons_Temp_de_Marche_Chaudiere", 35.0),
             "A6": AV.get("Cons_temp_de_marche_Degommage", 60.0),
             "A7": AV.get("Cons_temp_de_marche_Circulateur", 30.0)},
            {"d1": dem_ecs,  "d2": dem_mini,
             "d3": demande_plancher,
             "d4": DV.get("Contact_Production_Chaudiere", False),
             "d5": DV.get("Contact_Alarme_Chaudiere", False),
             "d6": circ_plancher,
             "d7": od["od2"],   # circ_ecs_ch depuis ecs
             "d8": v3v_sol},
        )
        results["chaudiere"] = {
            "autorisation_K1":   od["od1"],
            "circ_rehausse_K4":  od["od2"],
            "run_cpt_marche":    od["od3"],
        }

        return results


# ─────────────────────────────────────────────────────────────
# SCÉNARIOS DE TEST
# ─────────────────────────────────────────────────────────────
AV_DEFAULTS = {
    "Conssigne_Ambiance":              19.0,
    "Correction_Jour_Nuit":             2.0,
    "Hyst_Ballon_Bas":                  3.0,
    "Hyst_Ballon_Haut":                 5.0,
    "Hyst_RetourFroid_Solaire":         5.0,
    "Corection_Depart_V3V_Solaire":     3.0,
    "Conssigne_Depart_V3V_Max":        50.0,
    "Conssigne_Ballons_Max":           85.0,
    "Conssigne_Ballons":               55.0,
    "Conssigne_MINI_Ballons_S_CH":     45.0,
    "Secu_Panneaux_Solaire_Max":       95.0,
    "Conssigne_Panneaux_Solaire_Mini": 35.0,
    "Secu_Paneaux_Solaire_Mini":        5.0,
    "Cons_Temp_de_Marche_Chaudiere":   35.0,
    "Cons_temp_de_marche_Degommage":   60.0,
    "Cons_temp_de_marche_Circulateur": 30.0,
    "Prog_Heure_de_début_L": 7,  "Prog_Heure_de_fin_L": 22,
}

DV_ALL_ON = {
    "BP_Marche": True, "BP_Marche_Arret_Chauffage": True,
    "BP_Marche_Cauffage_Solaire": True, "BP_Marche_ECS_Solair": True,
    "BP_Marche_ECS_Chaudiere": True,
    "Lundi": True, "Mardi": True, "Mercredi": True,
    "Jeudi": True, "Vendredi": True, "Samedi": True, "Dimanche": True,
    "Contact_Production_Chaudiere": False,
    "Contact_Alarme_Chaudiere": False,
}

SCENARIOS = {
    "hiver": {
        "desc": "Hiver — chauffage actif, solaire faible, ballon froid",
        "temperatures": {
            "exterieur": -5.0, "ambiance": 15.0,
            "capteurs": 12.0,  "retour_froid": 18.0,
            "chaudiere": 70.0, "depart": 38.0,
            "ballon_haut": 42.0, "ballon_bas": 35.0,
        },
        "dv":  {**DV_ALL_ON, "Contact_Production_Chaudiere": True},
        "av":  {**AV_DEFAULTS},
        "now": datetime.datetime(2026, 1, 15, 10, 0),
        "expected": {
            "solaire.v3v_sol_on":       False,  # capteurs trop froids
            "loi_eau.circ_plancher_K9": True,   # chauffage demandé
            "ecs.circ_ecs_ch_K6":       True,   # ballon froid → CH
            "chaudiere.autorisation_K1":True,
        },
    },
    "ete": {
        "desc": "Été — solaire fort, ballon chaud, pas de chauffage",
        "temperatures": {
            "exterieur": 28.0, "ambiance": 24.0,
            "capteurs": 85.0,  "retour_froid": 48.0,
            "chaudiere": 30.0, "depart": 25.0,
            "ballon_haut": 70.0, "ballon_bas": 65.0,
        },
        "dv":  {**DV_ALL_ON, "BP_Marche_Arret_Chauffage": False, "BP_Forcage_V3V_Solaire": True},
        "av":  {**AV_DEFAULTS},
        "now": datetime.datetime(2026, 7, 15, 14, 0),
        "expected": {
            "solaire.v3v_sol_on":       True,   # ΔT capteurs >> retour
            "loi_eau.circ_plancher_K9": False,  # pas de chauffage
            "ecs.circ_ecs_ch_K6":       False,  # ballon plein
            "ecs.ballon_plein":         True,
            "chaudiere.autorisation_K1":False,
        },
    },
    "gel": {
        "desc": "Gel — sécurité panneaux basse, tout à l'arrêt",
        "temperatures": {
            "exterieur": -12.0, "ambiance": 8.0,
            "capteurs": 2.0,   "retour_froid": 5.0,
            "chaudiere": 20.0, "depart": 15.0,
            "ballon_haut": 20.0, "ballon_bas": 15.0,
        },
        "dv":  {**DV_ALL_ON},
        "av":  {**AV_DEFAULTS},
        "now": datetime.datetime(2026, 1, 5, 3, 0),
        "expected": {
            "solaire.v3v_sol_on":   False,  # capteurs(2°C) < secu_min(5°C) → bloqué
            "ecs.circ_ecs_sol_K5":  True,   # ballon(15°C) froid → circ sol tente de pomper
        },
    },
    "panne_chaudiere": {
        "desc": "Panne chaudière — alarme active, K1 bloqué",
        "temperatures": {
            "exterieur": 5.0, "ambiance": 17.0,
            "capteurs": 45.0, "retour_froid": 30.0,
            "chaudiere": 30.0, "depart": 28.0,
            "ballon_haut": 38.0, "ballon_bas": 30.0,
        },
        "dv":  {**DV_ALL_ON,
                "Contact_Alarme_Chaudiere": True,    # alarme !
                "Contact_Production_Chaudiere": False,
                "BP_Forcage_V3V_Solaire": True},      # bypasse timer2=120s
        "av":  {**AV_DEFAULTS},
        "now": datetime.datetime(2026, 3, 10, 9, 0),
        "expected": {
            "chaudiere.autorisation_K1": False,  # bloqué par alarme
            "solaire.v3v_sol_on":        True,   # solaire continue
        },
    },
    "nuit": {
        "desc": "Nuit — hors plage confort, consigne ambiance sans correction",
        "temperatures": {
            "exterieur": 2.0, "ambiance": 18.0,
            "capteurs": 8.0,  "retour_froid": 12.0,
            "chaudiere": 65.0,"depart": 40.0,
            "ballon_haut": 50.0, "ballon_bas": 45.0,
        },
        "dv":  {**DV_ALL_ON, "Contact_Production_Chaudiere": True},
        "av":  {**AV_DEFAULTS},
        "now": datetime.datetime(2026, 1, 15, 2, 0),  # 2h du matin
        "expected": {
            "jours.periode_confort":       False,  # hors plage 7h-22h
            "loi_eau.consigne_amb_corr":   19.0,   # nuit = consigne sans correction
        },
    },
    "secu_solaire": {
        "desc": "Sécurité haute — panneaux trop chauds (> 95°C)",
        "temperatures": {
            "exterieur": 35.0, "ambiance": 26.0,
            "capteurs": 98.0,  "retour_froid": 55.0,
            "chaudiere": 30.0, "depart": 25.0,
            "ballon_haut": 80.0, "ballon_bas": 75.0,
        },
        "dv":  {**DV_ALL_ON},
        "av":  {**AV_DEFAULTS},
        "now": datetime.datetime(2026, 8, 1, 13, 0),
        "expected": {
            "solaire.v3v_sol_on":  False,  # T > secu_max (95°C)
            "ecs.ballon_plein":    True,
        },
    },
}


# ─────────────────────────────────────────────────────────────
# RUNNER
# ─────────────────────────────────────────────────────────────
def run_scenario(engine, name, scenario, verbose=False):
    PASS = "\033[92m✓\033[0m"
    FAIL = "\033[91m✗\033[0m"
    WARN = "\033[93m?\033[0m"

    print(f"\n{'─'*60}")
    print(f"  {name.upper():20s} {scenario['desc']}")
    print(f"{'─'*60}")

    # Quelques cycles pour laisser les timers se stabiliser
    for _ in range(150):
        results = engine.scan(scenario)

    if verbose:
        print("\n  Températures :")
        for k, v in scenario["temperatures"].items():
            print(f"    {k:20s} = {v:6.1f}°C")
        print("\n  Résultats :")
        for bloc, vals in results.items():
            for k, v in vals.items():
                if isinstance(v, bool):
                    print(f"    {bloc}.{k:30s} = {'ON ' if v else 'off'}")
                else:
                    print(f"    {bloc}.{k:30s} = {v}")

    # Vérification des valeurs attendues
    print("\n  Assertions :")
    ok_count = fail_count = 0
    for key, expected in scenario.get("expected", {}).items():
        bloc, var = key.split(".", 1)
        actual = results.get(bloc, {}).get(var)
        if actual is None:
            print(f"    {WARN} {key:45s} → non trouvé")
            continue
        if isinstance(expected, float):
            ok = abs(actual - expected) < 1.0
        else:
            ok = (actual == expected)
        icon = PASS if ok else FAIL
        exp_s = str(expected)
        act_s = f"{actual:.1f}" if isinstance(actual, float) else str(actual)
        print(f"    {icon} {key:45s} attendu={exp_s:5s} obtenu={act_s}")
        if ok: ok_count += 1
        else:  fail_count += 1

    print(f"\n  → {ok_count} OK  {fail_count} ECHEC(S)")
    return fail_count == 0


def main():
    parser = argparse.ArgumentParser(description="Simulateur pyblocks Chauffage Maison")
    parser.add_argument("--scenario", default="all",
                        choices=list(SCENARIOS.keys()) + ["all"])
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args()

    print("\n" + "═"*60)
    print("  SIMULATEUR PYBLOCKS — Chauffage Maison (regulech)")
    print("═"*60)

    engine = PyBlockEngine()
    if not engine.codes:
        print("\n  ERREUR : aucun pyblock trouvé.")
        print("  Placez ce script dans le même dossier que regulech_maison/")
        sys.exit(1)

    print(f"\n  {len(engine.codes)} pyblocks chargés : {', '.join(engine.codes.keys())}")
    print(f"  Ordre de scan : {' → '.join(engine.SCAN_ORDER)}")

    scenarios_to_run = (SCENARIOS if args.scenario == "all"
                        else {args.scenario: SCENARIOS[args.scenario]})

    total_ok = total_fail = 0
    for name, scen in scenarios_to_run.items():
        # Réinitialiser les states entre scénarios
        engine.states = {n: {} for n in engine.SCAN_ORDER}
        engine.registers = {f"RF{i}": 0.0 for i in range(16)}
        ok = run_scenario(engine, name, scen, args.verbose)
        if ok: total_ok += 1
        else:  total_fail += 1

    print(f"\n{'═'*60}")
    print(f"  BILAN : {total_ok}/{total_ok+total_fail} scénarios passés")
    if total_fail == 0:
        print("  \033[92mTous les tests sont OK — prêt pour le RPi !\033[0m")
    else:
        print(f"  \033[91m{total_fail} scénario(s) en échec — vérifier la logique.\033[0m")
    print("═"*60 + "\n")
    sys.exit(0 if total_fail == 0 else 1)


if __name__ == "__main__":
    main()
