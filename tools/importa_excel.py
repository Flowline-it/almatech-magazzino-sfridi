import sys, glob, os, re, json, math, openpyxl
root, out = sys.argv[1], sys.argv[2]

def clean_mat(s):
    s = re.sub(r'\s+', ' ', str(s)).strip().upper()
    s = s.replace('PFTFE', 'PTFE').replace('PFTE', 'PTFE')
    s = re.sub(r'\s*\+\s*', '+', s)
    s = s.replace('PET NAT.', 'PET NAT').replace('PVC ANTISTAT', 'PVC ANTISTATICO').replace('ANTISTATICOICO','ANTISTATICO')
    s = s.replace('PET+NERO', 'PET NERO')
    return s

# (chiave grado, famiglia) da descrizione
def grade(m):
    if m.startswith('AISI'): return 'AISI 304', 'ACCIAIO'
    if m.startswith('AFV'): return 'AFV 300', 'AFV'
    if m.startswith('BACHELITE'): return 'BACHELITE', 'BACHELITE'
    if m.startswith('PEEK'): return 'PEEK', 'PEEK'
    if m.startswith('PET'):
        return ('PET+PTFE' if 'PTFE' in m else 'PET'), 'PET'
    if m.startswith('PE') and not m.startswith('PEEK'):
        return ('PE 500' if '500' in m else 'PE-HD'), 'PE'
    if m.startswith('PPE'): return 'PPE', 'PPE'
    if m.startswith('PP'): return 'PP', 'PP'
    if m.startswith('POM'):
        return ('POM-H' if re.search(r'POM H\b', m) else 'POM-C'), 'POM'
    if m.startswith('PA6') or m.startswith('PA66'):
        if 'FV' in m or 'GF' in m: return 'PA66+GF30', 'PA'
        if 'COLATO' in m: return 'PA6 COLATO', 'PA'
        if 'OIL' in m: return 'PA6+OLIO', 'PA'
        return 'PA6', 'PA'
    if m.startswith('PTFE'):
        if '+FV' in m: return 'PTFE+FV', 'PTFE'
        if '+CG' in m: return 'PTFE+CG', 'PTFE'
        return 'PTFE', 'PTFE'
    if m.startswith('PVDF'): return 'PVDF', 'PVDF'
    if m.startswith('PVC'): return 'PVC', 'PVC'
    if m.startswith('PMMA'): return 'PMMA', 'PMMA'
    return 'SCONOSCIUTO', 'ALTRO'

def num(s): return float(s.replace(',', '.'))

def parse_lengths(q):
    """ritorna lista (lunghezza_mm, pezzi), flag"""
    flags = []
    if q is None: return [], ['lunghezza mancante']
    if isinstance(q, (int, float)): return [(float(q), 1)], flags
    s = str(q).strip().upper().replace('L=', '').replace(' ', '')
    m = re.fullmatch(r'(\d+(?:[.,]\d+)?)MT', s)
    if m: return [(num(m.group(1)) * 1000, 1)], ['indicato in metri']
    toks = [t for t in s.split('+') if t]
    res = []
    for t in toks:
        m = re.fullmatch(r'(\d+(?:[.,]\d+)?)(?:\((?:PZ)?(\d+)(?:PZ)?\))?', t)
        if not m:
            flags.append(f'testo non interpretato: {t}'); continue
        L = num(m.group(1)); n = int(m.group(2)) if m.group(2) else 1
        res.append((L, n))
    if len(toks) > 1 and any('PZ' in t for t in toks):
        flags.append('pezzi indicati su una sola parte della somma: interpretazione da confermare')
    # accorpa lunghezze uguali
    agg = {}
    for L, n in res: agg[L] = agg.get(L, 0) + n
    return sorted(agg.items(), key=lambda x: -x[0]), flags

rows = []
for f in sorted(glob.glob(os.path.join(root, '**', '*.xlsx'), recursive=True)):
    fn = os.path.basename(f)
    if fn.startswith('~$'): continue
    ws = openpyxl.load_workbook(f, data_only=True).worksheets[0]
    hdr = None
    for r in ws.iter_rows(min_row=1, values_only=False):
        vals = [c.value for c in r]
        if vals and vals[0] == 'TIPO': hdr = r[0].row; continue
        if hdr is None or r[0].row <= hdr: continue
        tipo = (str(vals[0]).strip().upper() if vals[0] else '')
        mat = vals[1] if len(vals) > 1 else None
        mis = vals[2] if len(vals) > 2 else None
        qt = vals[3] if len(vals) > 3 else None
        note = vals[4] if len(vals) > 4 else None
        if not mat and not mis: continue  # riga vuota
        flags = []
        mat_c = clean_mat(mat) if mat else ''
        g, fam = grade(mat_c)
        if fam == 'ALTRO': flags.append('materiale non riconosciuto')
        base = dict(file=fn, riga=r[0].row, materiale_orig=mat, misura_orig=mis, qt_orig=qt, note_orig=note,
                    materiale=mat_c, grado=g, famiglia=fam)
        if not mis:
            print('SCARTATA (solo materiale, senza misura né quantità):', fn, r[0].row, mat_c); continue
        m_s = str(mis).upper().replace('Ø', '').replace('⌀', '').replace('ø'.upper(), '').replace(' ', '')
        m_s = m_s.replace('Ø', '')
        nums = [num(x) for x in re.split(r'X', m_s) if x]
        if tipo == 'LASTRA' or fn.startswith('LASTR'):
            if len(nums) != 3: flags.append('misura lastra non a 3 valori')
            sp, la, lu = (nums + [None]*3)[:3]
            if qt is None or str(qt).strip() == '':
                pz = 1; flags.append('quantità mancante: assunto 1 pezzo')
            else:
                pz = int(qt)
            rows.append({**base, 'forma': 'LASTRA', 'sp': sp, 'larg': la, 'lung': lu, 'de': None, 'di': None,
                         'pezzi': pz, 'flags': flags})
        else:
            de = nums[0]; di = nums[1] if len(nums) > 1 else None
            forma = 'TUBO' if di else 'TONDO'
            if tipo.startswith('TONDO') and di: flags.append('indicato come TONDO ma ha diametro interno: trattato come TUBO')
            if tipo.startswith('TUBO') and not di: flags.append('indicato come TUBO senza diametro interno')
            if di and di >= de: flags.append('diametro interno ≥ esterno')
            lens, lf = parse_lengths(qt)
            flags += lf
            if note and re.search(r'(\d+)\s*PZ', str(note).upper()):
                k = int(re.search(r'(\d+)\s*PZ', str(note).upper()).group(1))
                lens = [(L, n * k) for L, n in lens]
                flags.append(f'pezzi da colonna note ({note})')
            if not lens:
                rows.append({**base, 'forma': forma, 'de': de, 'di': di, 'lung': None, 'pezzi': 0, 'flags': flags + ['nessuna lunghezza']})
            for L, n in lens:
                rows.append({**base, 'forma': forma, 'de': de, 'di': di, 'sp': None, 'larg': None, 'lung': L,
                             'pezzi': n, 'flags': list(flags)})

# codici
cnt = {}
pref = {'LASTRA': 'LA', 'TONDO': 'TO', 'TUBO': 'TU'}
for r in rows:
    k = (pref.get(r['forma'], 'XX'), r['famiglia'])
    cnt[k] = cnt.get(k, 0) + 1
    r['codice'] = f"{k[0]}-{r['famiglia'][:4]}-{cnt[k]:03d}"
    if r['forma'] == 'LASTRA':
        r['misura'] = f"{r['sp']:g} × {r['larg']:g} × {r['lung']:g}" if r.get('lung') else str(r['misura_orig'])
        r['vol_cm3'] = r['sp']*r['larg']*r['lung']/1000 if r.get('lung') else None
    else:
        d = f"Ø{r['de']:g}" + (f"/{r['di']:g}" if r['di'] else '')
        r['misura'] = d + (f" L {r['lung']:g}" if r.get('lung') else '')
        r['vol_cm3'] = (math.pi/4*(r['de']**2-(r['di'] or 0)**2)*r['lung']/1000) if r.get('lung') else None
json.dump(rows, open(out, 'w'), ensure_ascii=False, indent=1, default=str)
print(len(rows), 'lotti;', sum(r['pezzi'] for r in rows), 'pezzi')
from collections import Counter
print(Counter(r['forma'] for r in rows)); print(Counter(r['grado'] for r in rows))
for r in rows:
    if r['flags']: print(r['codice'], r['file'], r['riga'], r['materiale'], r['misura_orig'], r['qt_orig'], '->', r['misura'], 'pz', r['pezzi'], r['flags'])
