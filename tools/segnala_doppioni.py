import json, sys
p=sys.argv[1]; rows=json.load(open(p))
key=lambda r:(r['materiale'],r['forma'],r.get('sp'),r.get('larg'),r.get('lung'),r.get('de'),r.get('di'))
g={}
for r in rows: g.setdefault(key(r),[]).append(r)
for k,v in g.items():
    if len(v)>1:
        cods=[x['codice'] for x in v]
        for x in v:
            x['flags'].append('possibile doppione di '+', '.join(c for c in cods if c!=x['codice']))
        print(k,[(x['codice'],x['file'],x['riga'],x['qt_orig'],x['pezzi']) for x in v])
for r in rows:
    if r['grado']=='AFV 300': r['flags'].append('peso specifico da chiedere al cliente')
    if r['file'] in ('LASTRE_AFV_MAG.xlsx','LASTRE_AISI-304_MAG.xlsx') and 'titolo' not in str(r['flags']):
        r['flags'].append('nel file originale il titolo del foglio era "PVDF" (copia-incolla)')
json.dump(rows,open(p,'w'),ensure_ascii=False,indent=1)
print(sum(1 for r in rows if r['flags']),'lotti con segnalazioni')
