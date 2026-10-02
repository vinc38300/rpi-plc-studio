#!/usr/bin/env python3
"""
Banc de parité core/plc_engine.py (studio, référence)  <->  rpi_server/server.py (RPi).

Pour chaque type de bloc reconnu par au moins un des deux moteurs :
  - génère N variantes aléatoires (clés lues par le code, valeurs tirées au hasard),
  - exécute la même variante sur les deux moteurs pendant CYCLES cycles avec les mêmes
    entrées simulées (RF1..RF3, M0..M2),
  - compare registres, bits M, GPIO, variables AV/DV et exceptions levées.

Usage :  python3 tests/parity_fuzz.py [--root <dossier projet>] [--n 24] [--types sr,ctd]
Sortie : résumé par type + détail des premiers écarts. Code retour 0 si aucun écart hors
"matériel/horloge", 1 sinon.
"""
import argparse, ast, copy, json, logging, os, random, sys, io, contextlib

ap = argparse.ArgumentParser()
ap.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap.add_argument("--n", type=int, default=24)
ap.add_argument("--cycles", type=int, default=6)
ap.add_argument("--seed", type=int, default=1234)
ap.add_argument("--types", default="")
ap.add_argument("--ignore-named", action="store_true",
                help="ne pas comparer les variables AV/DV nommées (stockage différent studio/RPi)")
ap.add_argument("--editor-keys", default="",
                help="JSON {type: [clés]} des clés réellement générées par l'éditeur : ne teste que celles-là")
ap.add_argument("--raw", action="store_true", help="valeurs de clés non réalistes (fuzz brut)")
ap.add_argument("--detail", type=int, default=2, help="écarts détaillés par type")
ap.add_argument("--studio", default="core/plc_engine.py")
ap.add_argument("--rpi", default="rpi_server/server.py")
args = ap.parse_args()

ROOT = os.path.abspath(args.root)
logging.disable(logging.CRITICAL)

# Types dont le résultat dépend du matériel / de l'horloge : comparés mais classés à part.
ENV_TYPES = {"sensor", "ds_in", "localtime", "input", "output", "contactor", "pt_in", "ana_in",
             "prog_h", "solaire", "solar"}


# ── 1. Extraction des clés lues par branche (AST) ─────────────────────────────────────
def branch_keys(path):
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    res = {}
    for fn in ast.walk(tree):
        if isinstance(fn, ast.FunctionDef) and fn.name == "exec_block":
            for node in ast.walk(fn):
                if not isinstance(node, ast.If):
                    continue
                types = _types_of(node.test)
                if not types:
                    continue
                keys = set()
                for st in node.body:
                    for sub in ast.walk(st):
                        k = _key_of(sub)
                        if k:
                            keys.add(k)
                for t in types:
                    res.setdefault(t, set()).update(keys)
    return res


def _types_of(test):
    out = []
    if isinstance(test, ast.Compare) and isinstance(test.left, ast.Name) and test.left.id == "btype":
        for op, comp in zip(test.ops, test.comparators):
            if isinstance(op, ast.Eq) and isinstance(comp, ast.Constant) and isinstance(comp.value, str):
                out.append(comp.value)
            elif isinstance(op, ast.In) and isinstance(comp, (ast.Tuple, ast.List, ast.Set)):
                out += [e.value for e in comp.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    elif isinstance(test, ast.BoolOp) and isinstance(test.op, ast.Or):
        for v in test.values:
            out += _types_of(v)
    return out


def _key_of(n):
    # block.get("k"...)  /  block["k"]
    if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "get" \
            and isinstance(n.func.value, ast.Name) and n.func.value.id == "block" \
            and n.args and isinstance(n.args[0], ast.Constant) and isinstance(n.args[0].value, str):
        return n.args[0].value
    if isinstance(n, ast.Subscript) and isinstance(n.value, ast.Name) and n.value.id == "block" \
            and isinstance(n.slice, ast.Constant) and isinstance(n.slice.value, str):
        return n.slice.value
    return None


# ── 2. Chargement des deux moteurs ────────────────────────────────────────────────────
import importlib.util


def load_module(name, path, extra_paths):
    for p in extra_paths:
        if p not in sys.path:
            sys.path.insert(0, p)
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        spec.loader.exec_module(m)
    return m


studio_path = os.path.join(ROOT, args.studio)
rpi_path = os.path.join(ROOT, args.rpi)
studio_mod = load_module("studio_engine", studio_path, [ROOT])
rpi_mod = load_module("rpi_server_mod", rpi_path, [os.path.dirname(rpi_path)])


class _Ads:
    def read_all(self): return {}


class _Db:
    def insert(self, *a, **k): pass
    def insert_vars(self, *a, **k): pass


def cfg():
    return json.load(open(os.path.join(ROOT, "rpi_server", "config.json")))


def new_studio():
    e = studio_mod.PLCEngine()
    e.scan_time_ms = 100
    return e


def new_rpi():
    e = rpi_mod.PLCEngine(cfg(), _Ads(), _Db())
    e.scan_time_ms = 100
    return e


# ── 3. Génération de variantes ────────────────────────────────────────────────────────
IN_REFS = [None, "RF1", "RF2", "RF3", "RF110", "RF111", "M0", "M1"]
OUT_REFS = [None, "RF120", "RF121", "RF122", "M5"]
COND = [None, "M0", "M1", "RF1", {"type": "input", "ref": "M0"}, {"type": "input", "ref": "M1", "negate": True},
        {"type": "analog_gt", "ref": "RF2", "threshold": 1.0}]
NUM = [-5.0, -1.0, 0.0, 0.5, 1.0, 2.0, 2.5, 5.0, 10.0, 100.0, 1000.0]
OPS = ["gt", "lt", "ge", "le", "eq", "ne", "neq", ">", "<", ">=", "<=", "==", "!=", "add", "sub", "mul", "div",
       "and", "or", "xor", "min", "max"]


def gen_value(key, rnd):
    k = key.lower()
    if k in ("id", "type", "params"):
        return None
    # Réalisme (l'éditeur) : sortie booléenne = bit M ou GPIO ; entrées analogiques = registres RF
    if k == "output":
        return rnd.choice(["M5", "M6", 5, 11]) if not args.raw else rnd.choice(OUT_REFS)
    if not args.raw and (k.startswith("pv_ref") or k in ("reg_ref", "reg_sp", "reg_a", "reg_b", "reg_in", "pv", "sp_ref")):
        return rnd.choice(["RF1", "RF2", "RF3", "RF110", "RF111"])
    if not args.raw and k in ("cv_ref", "et_ref", "pt_ref"):
        return rnd.choice(["RF120", "RF121", "RF122"])
    if not args.raw and k in ("ref_a", "ref_b"):
        return rnd.choice(["RF1", "RF2", "RF3", "RF110", "RF111", "M0", "M1"])
    if "ref" in k:
        return rnd.choice(OUT_REFS if ("out" in k or k.startswith(("od", "oa"))) else IN_REFS)
    if k in ("op", "operator", "mode", "cmp", "func", "fn"):
        return rnd.choice(OPS)
    if k.startswith(("out_", "pin", "reg_", "in0", "in1", "in2", "in3", "idx", "oinc", "odec")) and k not in ("out_lo", "out_hi", "out_min", "out_max", "out_hour", "out_min", "out_sec", "out_mday", "out_wday"):
        if k.startswith(("out_", "oinc", "odec", "reg_out", "reg_runtime", "reg_starts", "reg_total")):
            return rnd.choice(OUT_REFS)
        return rnd.choice(IN_REFS)
    if k.endswith("_ref") or k in ("reg_out", "reg_in", "reg_a", "reg_b", "reg_c", "input", "output", "in1", "in2",
                                   "pv", "sp", "reg", "reg_ref"):
        if "out" in k or k in ("output",) or k.startswith(("od", "oa")):
            return rnd.choice(OUT_REFS)
        return rnd.choice(IN_REFS)
    if "cond" in k or k in ("in", "s", "r", "g", "en", "enable", "set", "reset", "cu", "cd", "ld", "trig"):
        return rnd.choice(COND)
    if k in ("preset", "preset_ms", "rate", "hysteresis", "kp", "ki", "kd"):
        return rnd.choice([0.5, 1.0, 2.0, 3.0, 5.0, 10.0])      # valeurs de réglage réalistes (> 0)
    if k == "bktype":
        return rnd.choice(["float", "bool"])
    if k in ("num", "index", "n", "n_in", "n_out", "antileg_day", "antileg_hour", "ctrl_mode",
             "pump_mode", "antigel_mode", "pin", "bit"):
        if k == "bit":
            return rnd.choice(["M3", "M4", 3])
        if k == "pin":
            return rnd.choice([5, 11, 99])
        if k in ("n_in", "n_out"):
            return rnd.choice([2, 3, 4, 6])
        return rnd.choice([0, 1, 2, 3])
    if k in ("varname", "name", "var", "key"):
        return rnd.choice(["v1", "v2"])
    return rnd.choice(NUM)


def gen_block(t, keys, rnd, i):
    b = {"id": f"b{i}", "type": t}
    for k in keys:
        if rnd.random() < 0.15:      # clé volontairement absente (entrée non câblée)
            continue
        v = gen_value(k, rnd)
        if v is not None:
            b[k] = v
    return b


def script(rnd, cycles):
    vals = [0.0, 0.3, 1.0, -1.0, 2.5, 5.0, 12.0]
    return [{"RF1": rnd.choice(vals), "RF2": rnd.choice(vals), "RF3": rnd.choice(vals),
             "RF110": rnd.choice(vals), "RF111": rnd.choice(vals),
             "M0": rnd.random() < .5, "M1": rnd.random() < .5, "M2": rnd.random() < .5} for _ in range(cycles)]


# ── 4. Exécution et instantané ────────────────────────────────────────────────────────
def norm(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return round(v, 6)
    return v


COMMON_PINS = None


def snap(e):
    regs = {k: norm(v) for k, v in e.registers.items() if v not in (0, 0.0) or k in ("RF120", "RF121", "RF122")}
    mem = {k: bool(v) for k, v in e.memory.items() if v}
    gp = {p: bool(c.get("value")) for p, c in e.gpio.items()
          if c.get("mode") == "output" and (COMMON_PINS is None or p in COMMON_PINS)}
    av = {k.lower(): norm(v) for k, v in getattr(e, "av_vars", {}).items()}
    dv = {k.lower(): bool(v) for k, v in getattr(e, "dv_vars", {}).items()}
    for k, v in getattr(e, "_backup_store", {}).items():
        if isinstance(v, bool):
            dv[k.lower()] = v
        elif isinstance(v, (int, float)):
            av[k.lower()] = norm(float(v))
    if args.ignore_named:
        av, dv = {}, {}
    return {"reg": {k: v for k, v in regs.items() if k not in ("RF1", "RF2", "RF3", "RF110", "RF111")},
            "M": {k: v for k, v in mem.items() if k not in ("M0", "M1", "M2")},
            "gpio": gp, "av": av, "dv": dv}


def run(engine, block, scr, dt=100.0):
    hist, errs = [], []
    b = copy.deepcopy(block)
    for cyc in scr:
        for k, v in cyc.items():
            if k.startswith("RF"):
                engine.registers[k] = v
            else:
                engine.memory[k] = v
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                engine.exec_block(b, dt)
            errs.append(None)
        except Exception as ex:
            errs.append(f"{type(ex).__name__}: {ex}")
        hist.append(snap(engine))
    return hist, errs


def diff(h1, e1, h2, e2):
    out = []
    for i, (a, b, ea, eb) in enumerate(zip(h1, h2, e1, e2)):
        if (ea is None) != (eb is None):
            out.append(f"cycle {i}: exception studio={ea!r} rpi={eb!r}")
            break
        if a != b:
            for grp in a:
                if a[grp] != b[grp]:
                    ks = set(a[grp]) | set(b[grp])
                    for k in sorted(ks, key=str):
                        if a[grp].get(k) != b[grp].get(k):
                            out.append(f"cycle {i}: {grp}[{k}] studio={a[grp].get(k)} rpi={b[grp].get(k)}")
            break
    return out


def main():
    global COMMON_PINS
    _s, _r = new_studio(), new_rpi()
    COMMON_PINS = {p for p, c in _s.gpio.items() if c.get("mode") == "output"} & \
                  {p for p, c in _r.gpio.items() if c.get("mode") == "output"}
    k_studio = branch_keys(studio_path)
    k_rpi = branch_keys(rpi_path)
    types = sorted(set(k_studio) | set(k_rpi))
    ed = json.load(open(args.editor_keys)) if args.editor_keys else None
    if ed is not None:
        types = [t for t in types if t in ed]
    if args.types:
        want = set(args.types.split(","))
        types = [t for t in types if t in want]
    rnd = random.Random(args.seed)
    tot_diff, results = 0, {}
    for t in types:
        keys = sorted(ed[t]) if ed is not None else sorted(k_studio.get(t, set()) | k_rpi.get(t, set()))
        n_diff, examples = 0, []
        for i in range(args.n):
            blk = gen_block(t, keys, rnd, i)
            scr = script(rnd, args.cycles)
            es, er = new_studio(), new_rpi()
            hs, xs = run(es, blk, scr)
            hr, xr = run(er, blk, scr)
            d = diff(hs, xs, hr, xr)
            if d:
                n_diff += 1
                if len(examples) < args.detail:
                    examples.append((blk, d[:3]))
        results[t] = (n_diff, examples, t in k_studio, t in k_rpi)
        if t not in ENV_TYPES:
            tot_diff += n_diff
    same = [t for t, r in results.items() if r[0] == 0]
    print(f"Types comparés : {len(results)}   identiques : {len(same)}   avec écarts : {len(results) - len(same)}")
    only_s = [t for t, r in results.items() if r[2] and not r[3]]
    only_r = [t for t, r in results.items() if r[3] and not r[2]]
    if only_s: print("Reconnus seulement par le studio :", ", ".join(only_s))
    if only_r: print("Reconnus seulement par le RPi    :", ", ".join(only_r))
    print()
    for t, (n, ex, _, _) in results.items():
        if n:
            tag = "  [matériel/horloge]" if t in ENV_TYPES else ""
            print(f"== {t} : {n}/{args.n} variantes divergent{tag}")
            for blk, d in ex:
                print("   bloc :", json.dumps({k: v for k, v in blk.items() if k not in ('id',)}, ensure_ascii=False))
                for line in d:
                    print("     ", line)
    print("\nIdentiques :", ", ".join(same))
    return 0 if tot_diff == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
