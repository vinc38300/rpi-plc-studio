#!/usr/bin/env python3
"""Teste la comparaison md5 du déployeur avec un « RPi » simulé (dossier local + shell local).
Cas clé : deux versions de server.py de MÊME TAILLE mais de contenu différent."""
import os, sys, shutil, subprocess, tempfile, importlib.util
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, root)
from core import deployer as D

tmp = tempfile.mkdtemp(); rd = os.path.join(tmp, "rpi-plc"); os.makedirs(rd)
logs = []

class Sftp:
    def put(self, l, r): shutil.copyfile(l, r)

class Fake(D.RPiDeployer):
    def __init__(self):
        self.remote_dir = rd; self.host = "sim"; self.log_cb = logs.append; self._sftp = Sftp()
    def is_connected(self): return True
    def run(self, cmd, timeout=30):
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return p.returncode, p.stdout, p.stderr

f = Fake()
src = os.path.join(D.SERVER_SRC, "server.py")
data = open(src, "rb").read()
fails = 0
def check(name, cond):
    global fails
    print(("OK   " if cond else "ECHEC"), name); fails += (not cond)

# 1. fichier distant identique
shutil.copyfile(src, os.path.join(rd, "server.py"))
r = f.remote_md5s([f"{rd}/server.py", f"{rd}/absent.py"])
check("md5 distant lu, fichier absent = None", r[f"{rd}/server.py"] == f.local_md5(src) and r[f"{rd}/absent.py"] is None)
check("verify_uploaded : identique -> aucun écart", f.verify_uploaded([(src, f"{rd}/server.py", "server.py")]) == [])

# 2. même taille, contenu différent (un octet modifié)
b = bytearray(data); i = b.index(b"import"); b[i] ^= 0x01    # 1 octet change, taille inchangée
open(os.path.join(rd, "server.py"), "wb").write(bytes(b))
check("même taille distante/locale", os.path.getsize(src) == os.path.getsize(os.path.join(rd, "server.py")))
check("verify_uploaded détecte le contenu différent", f.verify_uploaded([(src, f"{rd}/server.py", "server.py")]) == ["server.py"])

# 3. fichier distant absent
os.remove(os.path.join(rd, "server.py"))
check("verify_uploaded signale un fichier absent", f.verify_uploaded([(src, f"{rd}/server.py", "server.py")]) == ["server.py"])

# 4. chemin avec apostrophe / espace
weird = os.path.join(tmp, "dossier d'essai"); os.makedirs(weird); shutil.copyfile(src, os.path.join(weird, "server.py"))
check("chemin avec espace et apostrophe", f.remote_md5s([f"{weird}/server.py"])[f"{weird}/server.py"] == f.local_md5(src))

# 5. smart_check : détection d'un server.py de même taille mais différent
def fake_smart(rd_):
    f.remote_dir = rd_; return f.smart_check()
os.makedirs(os.path.join(rd, "templates"), exist_ok=True); os.makedirs(os.path.join(rd, "static"), exist_ok=True)
for rel in D.SERVER_FILES:
    l = os.path.join(D.SERVER_SRC, rel)
    if os.path.isfile(l):
        os.makedirs(os.path.dirname(os.path.join(rd, rel)), exist_ok=True); shutil.copyfile(l, os.path.join(rd, rel))
open(os.path.join(rd, "server.py"), "wb").write(bytes(b))     # même taille, contenu différent
logs.clear()
try:
    res = f.smart_check()
    check("smart_check classe server.py comme obsolète (même taille)", "server.py" in res.get("stale_files", []))
    check("smart_check ne signale que server.py", res.get("stale_files") == ["server.py"] and not res.get("missing_files"))
except Exception as e:
    print("smart_check non exécutable dans ce banc :", type(e).__name__, e)
    check("smart_check exécutable", False)
shutil.rmtree(tmp)
print("\nRésultat :", "tous les tests passent" if not fails else f"{fails} échec(s)")
sys.exit(1 if fails else 0)
