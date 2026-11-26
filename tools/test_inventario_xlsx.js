/* Prova automatica di import/export G7.
 * Uso:  node tools/test_inventario_xlsx.js dati-locali/export_g7_26_11_2026.xlsx
 * (serve `npm i jszip` in una cartella da cui Node possa trovarlo, oppure NODE_PATH)
 * Controlla: numeri dell'import, che l'export cambi SOLO le celle D scelte,
 * e che tutti i file dell'archivio (stili, formula, ecc.) restino identici. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const JSZip = require('jszip');
const X = require(path.join(__dirname, '..', 'inventario-xlsx.js'));
(async () => {
  const buf = fs.readFileSync(process.argv[2]);
  const {righe, riepilogo, avvisi} = await X.leggiG7(buf);
  console.log('Riepilogo', riepilogo, 'avvisi:', avvisi.length);
  // scelgo 4 articoli: uno con decimali, uno vuoto in D (senza deposito), uno negativo, uno normale
  const scelte = [righe.find(r => r.um === 'KG' && r.g7 !== 0), righe.find(r => !r.dep), righe.find(r => r.g7 < 0), righe.find(r => r.g7 > 0 && r.um === 'PZ')];
  const mod = {}; scelte.forEach((r, i) => mod[r.n] = [12.5, 7, 0, r.g7 + 3][i]);
  const out = await X.scriviG7(buf, mod);
  const a = await JSZip.loadAsync(buf), b = await JSZip.loadAsync(out);
  assert.deepStrictEqual(Object.keys(a.files), Object.keys(b.files), 'stessi file nell\'archivio');
  for (const f of Object.keys(a.files)) {
    if (f === 'xl/worksheets/sheet1.xml') continue;
    assert.strictEqual(await a.file(f).async('string'), await b.file(f).async('string'), 'file diverso: ' + f);
  }
  const xa = await a.file('xl/worksheets/sheet1.xml').async('string'), xb = await b.file('xl/worksheets/sheet1.xml').async('string');
  // tolgo dall'originale le sole celle D modificate e confronto il resto parola per parola
  const cella = (x, n) => new RegExp(`<c\\s[^>]*r="D${n}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`).exec(x)[0];
  let ya = xa, yb = xb;
  for (const n of Object.keys(mod)) { ya = ya.replace(cella(xa, n), '@@'); yb = yb.replace(cella(xb, n), '@@'); console.log(n, cella(xa, n), '=>', cella(xb, n)); }
  assert.strictEqual(ya, yb, 'il resto del foglio deve essere identico');
  // rileggo il file nuovo: stessi articoli, solo i valori scelti cambiano
  const r2 = (await X.leggiG7(Buffer.from(out))).righe;
  assert.strictEqual(r2.length, righe.length);
  righe.forEach((r, i) => { const q = r2[i]; assert.strictEqual(q.c, r.c); assert.strictEqual(q.dep, r.dep); assert.strictEqual(q.g7, mod[r.n] != null ? mod[r.n] : r.g7); });
  // file sbagliato → errore chiaro
  const w = new JSZip(); w.file('x.txt', 'ciao'); await assert.rejects(X.leggiG7(await w.generateAsync({type: 'nodebuffer'})), X.ErroreFile);
  console.log('OK: import e export verificati');
})().catch(e => { console.error('ERRORE', e); process.exit(1); });
