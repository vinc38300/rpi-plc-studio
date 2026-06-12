#!/usr/bin/env python3
"""
migrate_project.py
==================
Convertit un fichier .plcproj multi-pages en canvas infini (mono-page).

Usage :
    python3 migrate_project.py essai1.plcproj essai1_infinite.plcproj

Ce que fait ce script :
  1. Charge le .plcproj source
  2. Espace les pages horizontalement (2400 px entre elles)
  3. Résout toutes les paires PAGE_OUT / PAGE_IN en fils RF directs
     en utilisant les registres déjà assignés dans les params des blocs
  4. Supprime les blocs PAGE_IN / PAGE_OUT et leurs fils
  5. Ajoute un bloc CARTOUCHE visuel pour chaque ancienne page
  6. Fusionne tout en une seule page "Programme"
  7. Sauvegarde le nouveau .plcproj
"""

import json, sys, copy, pathlib, datetime, re

# ────────────────────────────────────────────────────────────
# Paramètres de disposition
# ────────────────────────────────────────────────────────────
PAGE_GAP    = 2400   # px entre les sections horizontales
COL_WIDTH   = 1800   # largeur estimée par défaut
CART_H      = 100    # hauteur de la zone cartouche sous les blocs
CART_EXTRA  = 60     # marge sous les blocs avant cartouche
CART_PAD_X  = 80     # marge gauche/droite du cartouche par rapport aux blocs
CART_PAD_T  = 40     # marge haute du cartouche


def load_project(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_project(data: dict, path: str):
    pathlib.Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"✅ Sauvegardé : {path}")


def migrate(src_data: dict) -> dict:
    dst_data = copy.deepcopy(src_data)
    prog = dst_data.get("program", {})

    # ── Vérification format ────────────────────────────────
    if not isinstance(prog, dict) or "pages" not in prog:
        print("ℹ️  Format mono-page ou liste — rien à migrer.")
        return dst_data

    all_pages  = [p for p in prog["pages"] if not p["id"].startswith("__grp_")]
    grp_pages  = [p for p in prog["pages"] if  p["id"].startswith("__grp_")]

    if len(all_pages) <= 1:
        print("ℹ️  Déjà une seule page — rien à migrer.")
        return dst_data

    print(f"📐 Migration de {len(all_pages)} pages vers le canvas infini…")

    # ── Passe 1 : décalage horizontal + collecte signaux ──
    sig_src  = {}   # signal → {bid, port} côté bloc source réelle
    sig_rf   = {}   # signal → nom RF (depuis params.reg_out du bloc source)
    id_ctr   = [1]

    def next_id(prefix="BM"):
        id_ctr[0] += 1
        return f"{prefix}{id_ctr[0]:04d}"

    for pi, pg in enumerate(all_pages):
        offset_x = pi * PAGE_GAP

        # Centrer verticalement (les coordonnées peuvent être négatives)
        ys = [b.get("y", 0) for b in pg.get("blocks", [])]
        min_y = min(ys) if ys else 0
        offset_y = (-min_y + CART_PAD_T) if min_y < CART_PAD_T else CART_PAD_T

        for b in pg.get("blocks", []):
            b["x"] = (b.get("x") or 0) + offset_x
            b["y"] = (b.get("y") or 0) + offset_y
            # Garder trace du plus grand id
            m = re.match(r'[^\d]*(\d+)', b.get("id", ""))
            if m:
                n = int(m.group(1))
                if n >= id_ctr[0]:
                    id_ctr[0] = n + 1

        # Collecter PAGE_OUT
        for b in pg.get("blocks", []):
            if b.get("type") == "PAGE_OUT":
                sig = (b.get("params") or {}).get("signal", "")
                if not sig:
                    continue
                # Fil entrant dans PAGE_OUT → bloc source
                in_wire = next(
                    (w for w in pg.get("wires", [])
                     if (w.get("dst") or {}).get("bid") == b["id"]),
                    None
                )
                if in_wire:
                    src_bid  = in_wire["src"]["bid"]
                    src_port = in_wire["src"]["port"]
                    sig_src[sig] = {"bid": src_bid, "port": src_port}
                    # Chercher le RF déjà assigné dans params.reg_out du bloc source
                    src_blk = next(
                        (bb for bb in pg.get("blocks", []) if bb["id"] == src_bid),
                        None
                    )
                    if src_blk:
                        rf = (src_blk.get("params") or {}).get("reg_out", "")
                        if rf:
                            sig_rf[sig] = rf

    # ── Passe 2 : construire fils virtuels PAGE_IN → dst ──
    extra_wires = []
    wire_id_n   = id_ctr[0] + 20000

    for pg in all_pages:
        for b in pg.get("blocks", []):
            if b.get("type") == "PAGE_IN":
                sig = (b.get("params") or {}).get("signal", "")
                src = sig_src.get(sig)
                if not src:
                    print(f"  ⚠️  PAGE_IN signal={sig!r} sans PAGE_OUT correspondant")
                    continue
                # Fils sortant du PAGE_IN
                out_wires = [
                    w for w in pg.get("wires", [])
                    if (w.get("src") or {}).get("bid") == b["id"]
                ]
                for ow in out_wires:
                    wire_id_n += 1
                    extra_wires.append({
                        "id":  f"WM{wire_id_n}",
                        "src": {"bid": src["bid"],  "port": src["port"]},
                        "dst": {"bid": ow["dst"]["bid"], "port": ow["dst"]["port"]}
                    })
                if not out_wires:
                    print(f"  ⚠️  PAGE_IN signal={sig!r} sans fil sortant")

    print(f"  ↳ {len(extra_wires)} fils virtuels créés pour remplacer les PAGE_IN/PAGE_OUT")

    # ── Passe 3 : supprimer PAGE_IN/PAGE_OUT et leurs fils ─
    for pg in all_pages:
        pio_ids = {
            b["id"] for b in pg.get("blocks", [])
            if b.get("type") in ("PAGE_IN", "PAGE_OUT")
        }
        pg["blocks"] = [b for b in pg["blocks"] if b.get("type") not in ("PAGE_IN","PAGE_OUT")]
        pg["wires"]  = [
            w for w in pg.get("wires", [])
            if (w.get("src") or {}).get("bid") not in pio_ids
            and (w.get("dst") or {}).get("bid") not in pio_ids
        ]

    # ── Passe 4 : créer cartouches ─────────────────────────
    cartouches = []
    today = datetime.date.today().isoformat()

    for pi, pg in enumerate(all_pages):
        offset_x = pi * PAGE_GAP
        xs = [b.get("x", offset_x) for b in pg.get("blocks", [])]
        ys_bot = [(b.get("y", 0) + b.get("h", 60)) for b in pg.get("blocks", [])]

        x0 = min(xs) - CART_PAD_X         if xs else offset_x - CART_PAD_X
        x1 = max(xs) + COL_WIDTH//4       if xs else offset_x + COL_WIDTH
        y0 = CART_PAD_T // 2              # haut de la zone
        y1 = (max(ys_bot) if ys_bot else 600) + CART_EXTRA

        cart_w = max(x1 - x0, 1600)
        cart_h = y1 - y0 + CART_H

        cid = next_id("BCART")
        id_ctr[0] += 1
        cartouches.append({
            "id":   cid,
            "type": "CARTOUCHE",
            "x":    int(x0),
            "y":    int(y0),
            "w":    int(cart_w),
            "h":    int(cart_h),
            "params": {
                "title":    pg.get("name", f"Section {pi+1}"),
                "subtitle": "",
                "rev":      "1",
                "date":     today,
                "author":   "",
                "sheet":    f"{pi+1}/{len(all_pages)}"
            }
        })

    # ── Passe 5 : fusionner toutes les pages ───────────────
    merged_blocks = []
    merged_wires  = []

    # Cartouches en premier (arrière-plan)
    merged_blocks.extend(cartouches)

    for pg in all_pages:
        merged_blocks.extend(pg.get("blocks", []))
        merged_wires .extend(pg.get("wires",  []))

    merged_wires.extend(extra_wires)

    # ── Statistiques ───────────────────────────────────────
    n_blocs = len([b for b in merged_blocks if b["type"] != "CARTOUCHE"])
    n_fils  = len(merged_wires)
    print(f"  ↳ {n_blocs} blocs fonctionnels + {len(cartouches)} cartouches + {n_fils} fils")

    # ── Construire le nouveau programme ────────────────────
    new_program = {
        "pages": [
            {
                "id":     "P1",
                "name":   "Programme",
                "blocks": merged_blocks,
                "wires":  merged_wires
            },
            *grp_pages   # garder les pages de groupes internes
        ],
        "curPage": 0
    }

    dst_data["program"] = new_program
    dst_data["modified"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # Ajouter un tag pour signaler la migration
    dst_data["_migrated"] = {
        "from_pages": len(all_pages),
        "date": today,
        "tool": "migrate_project.py"
    }

    return dst_data


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage : python3 migrate_project.py <source.plcproj> [dest.plcproj]")
        sys.exit(1)

    src_path = sys.argv[1]
    dst_path = sys.argv[2] if len(sys.argv) > 2 else src_path.replace(".plcproj", "_infinite.plcproj")

    print(f"📂 Source  : {src_path}")
    print(f"📂 Cible   : {dst_path}")
    print()

    src_data  = load_project(src_path)
    dst_data  = migrate(src_data)
    save_project(dst_data, dst_path)

    # Résumé
    prog = dst_data["program"]
    if isinstance(prog, dict) and "pages" in prog:
        p0 = prog["pages"][0]
        n_cart = sum(1 for b in p0["blocks"] if b["type"] == "CARTOUCHE")
        n_blk  = sum(1 for b in p0["blocks"] if b["type"] != "CARTOUCHE")
        print(f"\n📊 Canvas infini : 1 page, {n_blk} blocs logiques, {n_cart} cartouches, {len(p0['wires'])} fils")
