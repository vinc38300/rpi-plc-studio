#!/usr/bin/env python3
"""Un bloc qui plante ne doit pas empêcher les blocs suivants de s'exécuter (boucle de scan réelle).
Usage : python3 tests/test_block_isolation.py <chemin/server.py>"""
import sys, os, io, time, json, contextlib, importlib.util, logging
logging.disable(logging.CRITICAL)
path = os.path.abspath(sys.argv[1]); root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(path))
spec = importlib.util.spec_from_file_location("srv", path); m = importlib.util.module_from_spec(spec)
with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
    spec.loader.exec_module(m)
cfg = json.load(open(os.path.join(root, "rpi_server", "config.json")))
class A:  read_all = lambda self: {}
class D:
    def insert(self, *a): pass
    def insert_vars(self, *a): pass
e = m.PLCEngine(cfg, A(), D()); e.scan_time_ms = 20
e.program = [
    {"id": "boom", "type": "scale", "in_lo": "pas_un_nombre", "input": "RF1", "reg_out": "RF50"},   # lève ValueError
    {"id": "c1", "type": "coil", "condition": {"type": "input", "ref": "M0"}, "output": "M7"},
]
e.memory["M0"] = True
e._running = True
import threading
th = threading.Thread(target=e._scan_loop, daemon=True); th.start()
time.sleep(0.4); e._running = False; th.join(2)
ok = bool(e.memory.get("M7"))
print(f"{os.path.basename(os.path.dirname(path))}/{os.path.basename(path)} : bloc suivant exécuté = {ok} ; cycles = {e.cycle_count} ; error = {e.error!r}")
sys.exit(0 if ok else 1)
