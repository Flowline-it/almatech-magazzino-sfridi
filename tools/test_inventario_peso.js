/* Prova automatica del calcolo dei kg per gli articoli a peso.
 * Uso:  node tools/test_inventario_peso.js dati-locali/export_g7_26_11_2026.xlsx   (serve jszip, come l'altra prova) */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const X = require(path.join(__dirname, '..', 'inventario-xlsx.js')), P = require(path.join(__dirname, '..', 'inventario-peso.js'));
global.window = {}; eval(fs.readFileSync(path.join(__dirname, '..', 'demo-data.js'), 'utf8'));
const mats = window.DEMO_DATA.materiali.map(m => ({g: m.grado, d: m.peso_specifico}));
// formule
assert.strictEqual(P.calcola('tondo', {de: 110, metri: 4.6}, 7.93), 346.66);
assert.strictEqual(P.calcola('lastra', {sp: 10, la: 1220, lu: 2220, pezzi: 2}, 1.14), 61.75);
assert.strictEqual(P.calcola('tubo', {de: 50, di: 36, metri: 1}, 7.93), 7.5);
assert.strictEqual(P.calcola('tondo', {de: 0, metri: 1}, 7.93), null);
(async () => {
  const {righe} = await X.leggiG7(fs.readFileSync(process.argv[2]));
  const kg = righe.filter(r => r.um === 'KG'), conta = {}, mancaMat = new Set();
  let pronti = 0;
  for (const r of kg) {
    const a = P.analizza(r.d), m = P.materiale(r.gr, r.d, mats);
    const k = a.forma + (m ? '' : ' (senza materiale)'); conta[k] = (conta[k] || 0) + 1;
    if (!m) mancaMat.add(r.gr || '(gruppo vuoto)');
    const dimOk = a.forma === 'tondo' ? a.de : a.forma === 'lastra' ? a.sp && a.la && a.lu : a.forma === 'tubo' ? a.de && a.di : false;
    if (m && dimOk) pronti++;
  }
  console.log('articoli KG:', kg.length, conta, '\nsenza materiale riconosciuto, gruppi:', [...mancaMat], '\ncon forma, misure e materiale già compilati:', pronti);
  const bt = kg.find(r => r.c.trim() === 'BT304-110'), a = P.analizza(bt.d), m = P.materiale(bt.gr, bt.d, mats);
  console.log('BT304-110 →', a, m, '348 kg in G7 =', (348 / P.calcola('tondo', {de: a.de, metri: 1}, m.rho)).toFixed(2), 'm di barra');
  console.log('OK');
})();
