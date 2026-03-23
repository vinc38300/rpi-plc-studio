#!/usr/bin/env python3
"""
report_generator.py — Génération de rapports HTML/PDF
Licence MIT

Génère un rapport complet en HTML (imprimable → PDF via le navigateur)
ou en CSV multi-canaux pour export tableur.

Accessible via :
  GET /api/report/html?hours=24   → rapport HTML
  GET /api/report/csv?hours=24    → CSV multi-canaux
  GET /api/report/json?hours=24   → données brutes JSON
"""

import json, logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger("rpi-plc.report")


def generate_html_report(db, engine, calibration, hours: int = 24) -> str:
    """Génère un rapport HTML complet autonome (imprimable)."""

    snapshot   = engine.snapshot()
    analog     = snapshot.get("analog", {})
    gpio       = snapshot.get("gpio", {})
    now_str    = datetime.now().strftime("%d/%m/%Y à %H:%M:%S")
    period_str = f"Dernières {hours} heures" if hours < 48 else f"Derniers {hours//24} jours"

    # Collecter les stats pour chaque canal
    chan_stats = []
    channels   = sorted(analog.keys(), key=lambda x: int(x[3:]) if x[3:].isdigit() else 0)
    for ch in channels:
        info     = analog[ch]
        cal      = calibration.get(ch) if calibration else {"name": ch, "alarm_high": 90, "alarm_low": 3}
        rows     = db.get_history(ch, hours)
        vals     = [r["t"] for r in rows if r["t"] is not None]
        t_cur    = info.get("celsius")
        alarm_hi = cal.get("alarm_high", 90.0)
        alarm_lo = cal.get("alarm_low", 3.0)

        # Construire le sparkline SVG (mini graphe 120×30)
        sparkline = _make_sparkline(vals, alarm_hi)

        chan_stats.append({
            "id":        ch,
            "name":      cal.get("name") or info.get("name") or ch,
            "current":   round(t_cur, 1) if t_cur is not None and t_cur == t_cur else None,
            "min":       round(min(vals), 1) if vals else None,
            "max":       round(max(vals), 1) if vals else None,
            "avg":       round(sum(vals) / len(vals), 1) if vals else None,
            "count":     len(vals),
            "alarm_hi":  alarm_hi,
            "alarm_lo":  alarm_lo,
            "in_alarm":  t_cur is not None and t_cur == t_cur and (t_cur > alarm_hi or t_cur < alarm_lo),
            "sparkline": sparkline,
            "probe":     info.get("probe", "PT100"),
            "sim":       info.get("sim", False),
        })

    # État des relais
    relais_rows = ""
    for pin, cfg in sorted(gpio.items(), key=lambda x: int(x[0])):
        if cfg.get("mode") == "output":
            state  = "🟢 ACTIF" if cfg.get("value") else "⚫ inactif"
            color  = "#1a4a1a" if cfg.get("value") else "transparent"
            relais_rows += f'<tr style="background:{color}"><td>{cfg.get("name","GPIO"+str(pin))}</td><td>GPIO {pin}</td><td>{state}</td></tr>\n'

    # Tableau des sondes
    sonde_rows = ""
    alarms_count = 0
    for s in chan_stats:
        cur   = f"{s['current']}°C" if s["current"] is not None else "N/C"
        mn    = f"{s['min']}°C"    if s["min"] is not None else "—"
        mx    = f"{s['max']}°C"    if s["max"] is not None else "—"
        avg   = f"{s['avg']}°C"    if s["avg"] is not None else "—"
        alarm_style = 'background:#2a1010;border-left:3px solid #f85149;' if s["in_alarm"] else ''
        if s["in_alarm"]: alarms_count += 1
        sonde_rows += f'''<tr style="{alarm_style}">
  <td><strong>{s["name"]}</strong><br><small style="color:#8b949e">{s["id"]} · {s["probe"]}{"· SIM" if s["sim"] else ""}</small></td>
  <td style="font-size:18px;font-weight:700;color:{"#f85149" if s["in_alarm"] else "#00d4ff"}">{cur}</td>
  <td>{mn}</td><td>{mx}</td><td>{avg}</td>
  <td>{s["count"]}</td>
  <td>{s["sparkline"]}</td>
</tr>'''

    plc_state = "▶ RUN" if snapshot.get("running") else "■ STOP"
    plc_color = "#3fb950" if snapshot.get("running") else "#f85149"

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport RPi-PLC — {now_str}</title>
<style>
@media print {{ .no-print {{ display:none; }} }}
body {{ font-family:'Segoe UI',system-ui,sans-serif; background:#0d1117; color:#e6edf3;
       margin:0; padding:24px; font-size:13px; }}
@media print {{ body {{ background:white; color:black; }} }}
.header {{ background:#161b22; border:1px solid #30363d; border-radius:10px;
           padding:24px 28px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:flex-start; }}
.logo {{ font-size:22px; font-weight:800; color:#58a6ff; }}
.logo span {{ color:#3fb950; }}
.meta {{ font-size:12px; color:#8b949e; text-align:right; line-height:1.8; }}
h2 {{ font-size:15px; color:#8b949e; text-transform:uppercase; letter-spacing:1px;
     margin:20px 0 10px; padding-bottom:6px; border-bottom:1px solid #30363d; }}
table {{ width:100%; border-collapse:collapse; margin-bottom:20px; }}
th {{ background:#21262d; color:#8b949e; font-size:11px; text-transform:uppercase;
     letter-spacing:.5px; padding:8px 12px; text-align:left; }}
td {{ padding:10px 12px; border-bottom:1px solid #1c2128; vertical-align:middle; }}
tr:hover td {{ background:#161b22; }}
.stat-row {{ display:flex; gap:16px; margin-bottom:20px; flex-wrap:wrap; }}
.stat {{ background:#161b22; border:1px solid #30363d; border-radius:8px;
         padding:14px 18px; flex:1; min-width:120px; }}
.stat .label {{ font-size:11px; color:#8b949e; text-transform:uppercase; letter-spacing:.5px; }}
.stat .val   {{ font-size:20px; font-weight:700; margin-top:4px; color:#58a6ff; }}
.badge-alarm {{ background:#2a1010; border:1px solid #f85149; color:#f85149;
               padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; }}
.badge-ok    {{ background:#0d2010; border:1px solid #3fb950; color:#3fb950;
               padding:4px 10px; border-radius:12px; font-size:11px; font-weight:700; }}
.btn-print {{ background:#1a2f45; border:1px solid #58a6ff; color:#58a6ff;
              padding:8px 20px; border-radius:8px; font-size:13px; cursor:pointer;
              margin-bottom:20px; }}
footer {{ margin-top:32px; text-align:center; font-size:11px; color:#484f58; border-top:1px solid #30363d; padding-top:16px; }}
</style>
</head>
<body>
<div class="header">
  <div>
    <div class="logo">RPi-PLC<span> Studio</span></div>
    <div style="color:#8b949e;margin-top:4px">Rapport de supervision</div>
  </div>
  <div class="meta">
    Généré le {now_str}<br>
    Période : {period_str}<br>
    Mode : {'Matériel RPi' if snapshot.get('on_rpi') else 'Simulation PC'}
  </div>
</div>

<button class="btn-print no-print" onclick="window.print()">🖨 Imprimer / Exporter PDF</button>

<div class="stat-row">
  <div class="stat">
    <div class="label">PLC</div>
    <div class="val" style="color:{plc_color}">{plc_state}</div>
  </div>
  <div class="stat">
    <div class="label">Cycles</div>
    <div class="val">{snapshot.get('cycle',0):,}</div>
  </div>
  <div class="stat">
    <div class="label">Sondes actives</div>
    <div class="val">{sum(1 for s in chan_stats if s["current"] is not None)}/12</div>
  </div>
  <div class="stat">
    <div class="label">Alarmes</div>
    <div class="val" style="color:{'#f85149' if alarms_count else '#3fb950'}">{alarms_count}</div>
  </div>
  <div class="stat">
    <div class="label">Erreurs PLC</div>
    <div class="val" style="color:{'#f85149' if snapshot.get('error_count') else '#3fb950'}">{snapshot.get('error_count',0)}</div>
  </div>
</div>

<h2>🌡 Températures — {period_str}</h2>
<table>
  <tr>
    <th>Sonde</th><th>Actuelle</th><th>Min</th><th>Max</th><th>Moyenne</th><th>Mesures</th><th>Tendance</th>
  </tr>
  {sonde_rows}
</table>

<h2>⚡ État des sorties relais</h2>
<table>
  <tr><th>Nom</th><th>GPIO</th><th>État</th></tr>
  {relais_rows}
</table>

<h2>🎯 Consignes (Registres RF)</h2>
<table>
  <tr><th>Registre</th><th>Valeur</th></tr>
  {''.join(f"<tr><td>{k}</td><td><strong>{v:.2f}</strong></td></tr>" for k,v in sorted(snapshot.get("registers",{}).items(), key=lambda x: int(x[0][2:])))}
</table>

<footer>RPi-PLC Studio · Rapport automatique · {now_str}</footer>
</body></html>"""

    return html


def _make_sparkline(vals: list, alarm: float, w=120, h=30) -> str:
    """Génère un mini SVG sparkline pour une liste de valeurs."""
    if len(vals) < 2:
        return '<span style="color:#484f58;font-size:11px">—</span>'

    mn, mx = min(vals), max(vals)
    span   = mx - mn if mx != mn else 1.0
    pts    = []
    n      = len(vals)
    for i, v in enumerate(vals):
        x = int(i / (n - 1) * (w - 4)) + 2
        y = h - 2 - int((v - mn) / span * (h - 4))
        pts.append(f"{x},{y}")

    # Couleur selon si en alarme
    color = "#f85149" if vals[-1] > alarm else "#58a6ff"

    # Ligne d'alarme
    alarm_y = h - 2 - int((alarm - mn) / span * (h - 4))
    alarm_line = ""
    if mn < alarm < mx:
        alarm_line = f'<line x1="0" y1="{alarm_y}" x2="{w}" y2="{alarm_y}" stroke="#f85149" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.5"/>'

    return (f'<svg width="{w}" height="{h}" style="vertical-align:middle">'
            f'{alarm_line}'
            f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="1.5" stroke-linejoin="round"/>'
            f'<circle cx="{pts[-1].split(",")[0]}" cy="{pts[-1].split(",")[1]}" r="2" fill="{color}"/>'
            f'</svg>')


def generate_csv_report(db, analog: dict, calibration, hours: int = 24) -> str:
    """Génère un CSV multi-canaux avec toutes les mesures."""
    import csv, io
    from datetime import datetime as dt

    buf = io.StringIO()
    w   = csv.writer(buf)

    # En-tête avec métadonnées
    w.writerow([f"# Rapport RPi-PLC — généré le {dt.now().strftime('%d/%m/%Y %H:%M:%S')}"])
    w.writerow([f"# Période : {hours} heures"])
    w.writerow([])

    # Récupérer toutes les données
    channels = sorted(analog.keys(), key=lambda x: int(x[3:]) if x[3:].isdigit() else 0)
    all_data = {}
    for ch in channels:
        rows = db.get_history(ch, hours)
        for r in rows:
            ts = r["ts"]
            if ts not in all_data:
                all_data[ts] = {}
            all_data[ts][ch] = r["t"]

    # Header ligne
    names = []
    for ch in channels:
        cal  = calibration.get(ch) if calibration else {}
        name = cal.get("name") or analog.get(ch, {}).get("name") or ch
        names.append(f"{name} ({ch}) °C")

    w.writerow(["Timestamp", "Date/Heure"] + names)

    # Données triées par temps
    for ts in sorted(all_data.keys()):
        dt_str = dt.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
        row    = [ts, dt_str]
        for ch in channels:
            v = all_data[ts].get(ch)
            row.append(f"{v:.2f}" if v is not None else "")
        w.writerow(row)

    return buf.getvalue()
