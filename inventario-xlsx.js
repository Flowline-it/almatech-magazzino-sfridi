/* =====================================================================
 * Inventario — lettura e scrittura del file Excel di G7 Suite.
 *
 * Il file di G7 deve tornare a G7 con la STESSA struttura. Per questo
 * l'export non rigenera il file: apre l'xlsx (che è un archivio zip),
 * cambia solo le celle della colonna D (Esistenza) degli articoli
 * modificati e rimette tutto il resto com'era (righe di sezione, ordine,
 * stili, larghezze, filtro, formula SUBTOTAL, nome del foglio).
 *
 * Nessun accesso alla pagina: funziona sia nel browser sia in Node (test).
 * Serve JSZip (nel browser è caricato da index.html).
 * ===================================================================== */
(function (root) {
  'use strict';

  const INTESTAZIONI = ['Codice articolo', 'Descrizione articolo', 'UM', 'Esistenza', 'Ubicazione Deposito', 'Lotto',
    'Scadenza lotto', 'ScortaMinima', 'TipoArticolo', 'S/N', 'Obsoleto'];
  const SHEET_PATH = 'xl/worksheets/sheet1.xml';
  const SST_PATH = 'xl/sharedStrings.xml';

  function getJSZip() {
    if (root.JSZip) return root.JSZip;
    if (typeof require === 'function') return require('jszip');
    throw new Error('Libreria JSZip non caricata: ricarica la pagina.');
  }

  class ErroreFile extends Error {}

  const unesc = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g) => {
    if (g === 'amp') return '&'; if (g === 'lt') return '<'; if (g === 'gt') return '>';
    if (g === 'quot') return '"'; if (g === 'apos') return "'";
    return String.fromCodePoint(g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  });

  /* testo di ogni stringa condivisa (anche con formattazione interna) */
  function leggiStringhe(xml) {
    const out = [];
    const re = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g; let m;
    while ((m = re.exec(xml))) {
      let t = ''; const r2 = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let x;
      while ((x = r2.exec(m[1] || ''))) t += x[1];
      out.push(unesc(t));
    }
    return out;
  }

  /* celle di una riga: { colonna: {t, v, f} } */
  function leggiCelle(corpo) {
    const celle = {};
    const re = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let m;
    while ((m = re.exec(corpo))) {
      const rif = /\br="([A-Z]+)\d+"/.exec(m[1]); if (!rif) continue;
      const t = /\bt="(\w+)"/.exec(m[1]);
      const v = m[2] != null ? /<v>([\s\S]*?)<\/v>/.exec(m[2]) : null;
      celle[rif[1]] = {t: t ? t[1] : null, v: v ? v[1] : null, f: m[2] != null && /<f[\s>]/.test(m[2])};
    }
    return celle;
  }

  async function aprirePacchetto(buf) {
    const JSZip = getJSZip();
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch (e) { throw new ErroreFile('Il file non è un Excel (.xlsx) valido.'); }
    const sheet = zip.file(SHEET_PATH), sst = zip.file(SST_PATH);
    if (!sheet) throw new ErroreFile('Non trovo il foglio dati nel file: è davvero un export di G7?');
    return {zip, sheet, sst};
  }

  const numero = v => { const n = Number(v); return isFinite(n) ? n : null; };

  /* ---------------------------------------------------------------
   * Legge l'export di G7.
   * Restituisce { righe, riepilogo, avvisi }. Ogni riga articolo:
   *   n  numero di riga nel foglio (serve all'export)
   *   c  codice (spazi finali conservati)   d descrizione   um
   *   g7 esistenza (numero; vuota = 0)      ub ubicazione   ob obsoleto
   *   dep deposito ("" = senza deposito)    gr gruppo
   * --------------------------------------------------------------- */
  async function leggiG7(buf) {
    const {sheet, sst} = await aprirePacchetto(buf);
    const [xmlSheet, xmlSst] = await Promise.all([sheet.async('string'), sst ? sst.async('string') : Promise.resolve('')]);
    const S = leggiStringhe(xmlSst);
    const testo = c => (!c || c.v == null) ? '' : (c.t === 's' ? (S[+c.v] || '') : (c.t === 'str' || c.t === 'inlineStr') ? unesc(c.v) : c.v);

    const righe = [], avvisi = [];
    const chiavi = new Map();
    let dep = '', gr = '', haIntestazioni = false, sezioni = 0, negativi = 0, nonZero = 0, nVuoteD = 0;
    const gruppi = new Set(), depositi = new Set();

    const reRiga = /<row\s([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g; let m;
    while ((m = reRiga.exec(xmlSheet))) {
      const nr = +(/\br="(\d+)"/.exec(m[1]) || [])[1];
      if (!nr) continue;
      const celle = leggiCelle(m[2] || '');
      if (nr === 1) {
        const h = 'ABCDEFGHIJK'.split('').map(col => testo(celle[col]).trim());
        const diversa = INTESTAZIONI.findIndex((x, i) => x.toLowerCase() !== h[i].toLowerCase());
        if (diversa >= 0) throw new ErroreFile(`Le intestazioni non sono quelle di un export G7: nella colonna ${'ABCDEFGHIJK'[diversa]} mi aspetto “${INTESTAZIONI[diversa]}” e trovo “${h[diversa] || 'vuoto'}”.`);
        haIntestazioni = true; continue;
      }
      if (!haIntestazioni) throw new ErroreFile('Il file non parte con le intestazioni di G7 nella prima riga.');
      const a = testo(celle.A);
      if (!a && !Object.values(celle).some(c => c.v != null || c.f)) continue; // riga vuota
      if (!a) continue; // riga del totale (solo formula SUBTOTAL in D)
      const altre = 'BCDEFGHIJK'.split('').some(col => celle[col] && (celle[col].f || testo(celle[col]).trim() !== ''));
      if (!altre && /^Codice deposito:/i.test(a)) { dep = a.slice(a.indexOf(':') + 1).trim(); sezioni++; depositi.add(dep); continue; }
      if (!altre && /^Gruppo:/i.test(a)) { gr = a.slice(a.indexOf(':') + 1).trim(); sezioni++; continue; }

      const d = celle.D, esistenza = d && d.t == null && d.v != null ? numero(d.v) : (d && d.t === 's' ? numero(testo(d).replace(',', '.')) : null);
      if (d && d.t === 's' && testo(d).trim() === '') nVuoteD++;
      const riga = {
        n: nr, c: a, d: testo(celle.B), um: testo(celle.C).trim(), g7: esistenza == null ? 0 : esistenza,
        ub: testo(celle.E).trim(), ob: /^(true|vero|1)$/i.test(testo(celle.K).trim()), dep, gr,
      };
      if (riga.g7 !== 0) nonZero++;
      if (riga.g7 < 0) negativi++;
      gruppi.add(gr);
      const k = [riga.c, riga.dep, riga.ub].join('\u0001');
      if (chiavi.has(k)) avvisi.push(`Codice ${riga.c.trim()} ripetuto nel deposito ${riga.dep || '(vuoto)'}${riga.ub ? ' e ubicazione ' + riga.ub : ''} (righe ${chiavi.get(k)} e ${nr}).`);
      else chiavi.set(k, nr);
      righe.push(riga);
    }
    if (!haIntestazioni) throw new ErroreFile('Il file è vuoto.');
    if (!righe.length) throw new ErroreFile('Nel file non ci sono articoli.');
    return {
      righe, avvisi,
      riepilogo: {
        articoli: righe.length, codiciDistinti: new Set(righe.map(r => r.c)).size, gruppi: gruppi.size, senzaGruppo: righe.filter(r => !r.gr).length,
        depositi: depositi.size, senzaDeposito: righe.filter(r => !r.dep).length,
        conGiacenza: nonZero, negativi, sezioni, esistenzaVuota: nVuoteD,
      },
    };
  }

  const fmtNum = n => { const r = Math.round(n * 1e6) / 1e6; return String(Object.is(r, -0) ? 0 : r); };

  /* ---------------------------------------------------------------
   * Scrive il file per G7: dato l'originale e { numeroRiga: nuovaEsistenza }
   * cambia soltanto quelle celle D. Restituisce un Blob (browser) o
   * un Uint8Array (Node). Controlla che ogni cella toccata esista.
   * --------------------------------------------------------------- */
  async function scriviG7(buf, modifiche, formato) {
    const {zip, sheet} = await aprirePacchetto(buf);
    const xml = await sheet.async('string');
    const da = new Map(Object.entries(modifiche).map(([n, v]) => [String(n), v]));
    const fatte = new Set();
    const nuovo = xml.replace(/<c\s([^>]*?)(\/>|>[\s\S]*?<\/c>)/g, (tutto, attr, resto) => {
      const rif = /\br="D(\d+)"/.exec(attr);
      if (!rif || !da.has(rif[1])) return tutto;
      if (/<f[\s>]/.test(resto)) throw new ErroreFile(`La cella D${rif[1]} contiene una formula: non la modifico.`);
      fatte.add(rif[1]);
      const stile = /\bs="(\d+)"/.exec(attr);
      return `<c r="D${rif[1]}"${stile ? ` s="${stile[1]}"` : ''}><v>${fmtNum(da.get(rif[1]))}</v></c>`;
    });
    const mancano = [...da.keys()].filter(n => !fatte.has(n));
    if (mancano.length) throw new ErroreFile(`Nel file originale non trovo la cella D${mancano[0]}: il file salvato non corrisponde.`);
    zip.file(SHEET_PATH, nuovo, {createFolders: false});
    return zip.generateAsync({type: formato || (typeof document !== 'undefined' ? 'blob' : 'uint8array'), compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  }

  const api = {INTESTAZIONI, ErroreFile, leggiG7, scriviG7};
  root.InvXlsx = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
