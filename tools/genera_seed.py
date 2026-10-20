"""Genera supabase/seed/002_dati_iniziali.sql dall'inventario normalizzato.

Uso (dalla cartella del repository):
    python tools/genera_seed.py tools/dati/inventario_iniziale.json tools/dati/materiali.json supabase/seed/002_dati_iniziali.sql
"""
import json
import sys


def q(v):
    """Valore SQL: NULL, numero o stringa tra apici."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return repr(v) if not float(v).is_integer() else str(int(v))
    return "'" + str(v).replace("'", "''") + "'"


def arr(items):
    if not items:
        return "'{}'::text[]"
    return "array[" + ", ".join(q(x) for x in items) + "]::text[]"


def main(inv_path, mat_path, out_path):
    rows = json.load(open(inv_path, encoding="utf-8"))
    mats = json.load(open(mat_path, encoding="utf-8"))
    out = [
        "-- Dati iniziali magazzino sfridi Almatech",
        "-- Generato da tools/genera_seed.py a partire dai 25 file Excel originali (inventario del 13/10/2026).",
        "-- Da eseguire UNA VOLTA, dopo 001_schema.sql.",
        "-- I prezzi €/kg sono DI ESEMPIO (prezzo_esempio = true): vanno sostituiti con quelli reali.",
        "",
        "begin;",
        "",
        "insert into public.materiali (grado, famiglia, peso_specifico, prezzo_kg, prezzo_esempio, note, ordine) values",
    ]
    vals = []
    for i, (g, fam, d, p, note) in enumerate(mats, 1):
        vals.append(f"  ({q(g)}, {q(fam)}, {q(d)}, {q(p)}, {q(p is not None)}, {q(note)}, {i})")
    out.append(",\n".join(vals) + ";")
    out += ["", "insert into public.lotti (codice, forma, grado, descrizione, spessore, larghezza, diam_est, diam_int, lunghezza, pezzi, segnalazioni, origine) values"]
    vals = []
    for r in rows:
        origine = f"{r['file']} riga {r['riga']}: {r['misura_orig']} | {r['qt_orig'] if r['qt_orig'] is not None else '(quantità vuota)'}"
        vals.append(
            f"  ({q(r['codice'])}, {q(r['forma'])}, {q(r['grado'])}, {q(r['materiale'])}, "
            f"{q(r.get('sp'))}, {q(r.get('larg'))}, {q(r.get('de'))}, {q(r.get('di'))}, {q(r.get('lung'))}, "
            f"{q(r['pezzi'])}, {arr(r['flags'])}, {q(origine)})"
        )
    out.append(",\n".join(vals) + ";")
    out += ["", "commit;", ""]
    open(out_path, "w", encoding="utf-8").write("\n".join(out))
    print(f"{len(mats)} materiali, {len(rows)} lotti -> {out_path}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
