"""Genera demo-data.js (dati della modalità dimostrazione) dall'inventario normalizzato.

Uso (dalla cartella del repository):
    python tools/genera_demo_data.py tools/dati/inventario_iniziale.json tools/dati/materiali.json demo-data.js
"""
import json
import sys


def main(inv_path, mat_path, out_path):
    rows = json.load(open(inv_path, encoding="utf-8"))
    mats = json.load(open(mat_path, encoding="utf-8"))
    materiali = [
        {"grado": g, "famiglia": fam, "peso_specifico": d, "prezzo_kg": p, "prezzo_esempio": p is not None,
         "note": note, "ordine": i}
        for i, (g, fam, d, p, note) in enumerate(mats, 1)
    ]
    lotti = [
        {
            "codice": r["codice"], "forma": r["forma"], "grado": r["grado"], "descrizione": r["materiale"],
            "spessore": r.get("sp"), "larghezza": r.get("larg"), "diam_est": r.get("de"), "diam_int": r.get("di"),
            "lunghezza": r.get("lung"), "pezzi": r["pezzi"], "ubicazione": "", "segnalazioni": r["flags"],
            "verificato": False,
            "origine": f"{r['file']} riga {r['riga']}: {r['misura_orig']} | {r['qt_orig'] if r['qt_orig'] is not None else '(quantità vuota)'}",
            "creato_il": "2026-10-13T08:00:00.000Z",
        }
        for r in rows
    ]
    data = {"versione": "2026-10-13", "materiali": materiali, "lotti": lotti}
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("/* Dati della modalità dimostrazione: inventario sfridi Almatech al 13/10/2026.\n"
                "   Generato da tools/genera_demo_data.py — non modificare a mano. */\n")
        f.write("window.DEMO_DATA = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"{len(materiali)} materiali, {len(lotti)} lotti -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
