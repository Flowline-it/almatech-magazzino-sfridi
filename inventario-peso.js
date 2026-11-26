/* =====================================================================
 * Inventario — articoli a peso (UM = KG).
 *
 * In G7 questi articoli sono in kg, ma in magazzino si contano i metri (barre)
 * o i pezzi (lastre). Qui si riconosce dalla descrizione la forma e le misure,
 * si sceglie il peso specifico del materiale e si calcolano i kg, come
 * nel magazzino sfridi:   kg = volume (mm³) / 1.000.000 × peso specifico (g/cm³)
 *
 * Tutto è modificabile da chi conta: l'app propone, la persona conferma.
 * I pesi specifici dei materiali già nel magazzino sfridi si usano così
 * come sono; gli altri (metalli) sono valori indicativi da manuale e vengono
 * segnalati come tali, in attesa che Almatech li confermi.
 * ===================================================================== */
(function (root) {
  'use strict';

  const num = s => parseFloat(String(s).replace(',', '.'));
  const norm = s => String(s || '').toUpperCase().replace(/\s+/g, '');

  /* Gruppo di G7 → materiale del magazzino sfridi (stessa famiglia, il più comune) */
  const ALIAS_SFRIDI = {
    'POM': 'POM-C', 'PE': 'PE-HD', 'PTFE+CG25%': 'PTFE+CG', 'PA6+OIL': 'PA6+OLIO', 'AISI304': 'AISI 304',
    'PE+OIL': 'PE-HD', 'PA6+GF30': 'PA66+GF30',
  };
  /* Pesi specifici indicativi (g/cm³) per i materiali che nel magazzino sfridi non ci sono. DA CONFERMARE con Almatech. */
  const INDICATIVI = {
    'AISI316': 8.0, 'ALLUMINIO': 2.7, 'OTTONE': 8.5, 'BRONZO': 8.8, 'ACCIAIALCARBONIO': 7.85, 'C45': 7.85, '40CRMNMO7': 7.85,
    'AISI630(17-4-PH)': 7.78, 'NITRONIC50(XM-19)': 7.88, 'A182F51': 7.8, 'ALLOYC-276': 8.89, 'ALLOY825': 8.14, 'INCONEL625': 8.44,
    'MONEL400/500': 8.8, 'XANTAL': 2.8, 'POLICARBONATO': 1.2, 'FEP': 2.15, 'PTFE+IMMIDE': 2.0, 'POM+PE': 1.4,
  };

  /* Trova il materiale e il peso specifico. mats = [{g: 'POM-C', d: 1.41}, ...] del magazzino sfridi. */
  function materiale(gruppo, descrizione, mats) {
    const lista = (mats || []).filter(m => m.d != null);
    const trova = nome => lista.find(m => norm(m.g) === norm(nome));
    const g = norm(gruppo);
    let m = trova(gruppo) || (ALIAS_SFRIDI[gruppo] && trova(ALIAS_SFRIDI[gruppo]));
    if (m) return {nome: m.g, rho: m.d, fonte: 'sfridi'};
    if (g && INDICATIVI[g]) return {nome: gruppo, rho: INDICATIVI[g], fonte: 'indicativo'};
    const k = Object.keys(INDICATIVI).find(x => norm(descrizione).includes(x));
    if (k) return {nome: k, rho: INDICATIVI[k], fonte: 'indicativo'};
    return null;
  }

  /* Dalla descrizione: forma e misure (mm). Sono solo proposte. */
  function analizza(descrizione) {
    const d = String(descrizione || '');
    const D = d.toUpperCase();
    const out = {forma: 'altro', de: null, di: null, sp: null, la: null, lu: null};
    const dia = /(?:∅|Ø|\bDIAM(?:ETRO)?\.?)\s*(\d+(?:[.,]\d+)?)/i.exec(d);
    if (/MANICOTTO|RUOTA|PLURIBOLL|FOGLIO/.test(D)) return out;           // pezzi finiti o rotoli: si inseriscono i kg
    if (/BARRA\s+TONDA|\bTONDO\b/.test(D) || (dia && !/LASTR|LISTA|TUBO/.test(D))) { out.forma = 'tondo'; if (dia) out.de = num(dia[1]); return out; }
    if (/\bTUBO\b|BARRA\s+FORATA/.test(D)) {
      out.forma = 'tubo';
      const t = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/.exec(d); if (t) { out.de = num(t[1]); out.di = num(t[2]); }
      return out;
    }
    if (/LASTR|LISTA/.test(D)) {
      out.forma = 'lastra';
      const m3 = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/.exec(d);
      const m2 = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/.exec(d);
      const sp = /SPESSORE\s*(?:mm\.?)?\s*(\d+(?:[.,]\d+)?)/i.exec(d) || /\bSP\.?\s*(\d+(?:[.,]\d+)?)/i.exec(d) || /\bmm\.?\s*(\d+(?:[.,]\d+)?)(?![\d.,]*\s*[xX×])/i.exec(d);
      if (m3) { out.sp = num(m3[1]); out.la = num(m3[2]); out.lu = num(m3[3]); }
      else if (m2) { out.sp = num(m2[1]); out.la = num(m2[2]); }
      else if (sp) out.sp = num(sp[1]);
    }
    return out;
  }

  const arrotonda = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;

  /* kg dalle misure. tondo/tubo: metri totali; lastra: numero di pezzi. Restituisce null se manca qualcosa. */
  function calcola(forma, v, rho) {
    const ok = (...a) => a.every(x => typeof x === 'number' && isFinite(x) && x > 0);
    if (!ok(rho)) return null;
    let mm3;
    if (forma === 'tondo') { if (!ok(v.de, v.metri)) return null; mm3 = Math.PI / 4 * v.de ** 2 * v.metri * 1000; }
    else if (forma === 'tubo') { if (!ok(v.de, v.metri) || !(v.di >= 0) || v.di >= v.de) return null; mm3 = Math.PI / 4 * (v.de ** 2 - v.di ** 2) * v.metri * 1000; }
    else if (forma === 'lastra') { if (!ok(v.sp, v.la, v.lu, v.pezzi)) return null; mm3 = v.sp * v.la * v.lu * v.pezzi; }
    else return null;
    return arrotonda(mm3 / 1e6 * rho);
  }

  const api = {materiale, analizza, calcola, INDICATIVI};
  root.InvPeso = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
