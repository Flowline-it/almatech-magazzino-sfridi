/* =====================================================================
 * Inventario — schermate (import, conteggio da telefono, chiusura/export).
 * Lavora con inventario-xlsx.js (file G7) e inventario-store.js (dati).
 * Usa da app.js: S, esc, toast, openModal, closeModal, errMsg, $.
 * ===================================================================== */
(function () {
  'use strict';
  const H = 204;                 // altezza fissa di una riga in lista (px): serve alla lista "a finestra"
  const BUFFER = 6;              // righe disegnate in più sopra e sotto lo schermo
  const POLL_MS = 20000;
  const STATI = {da: 'Da verificare', ok: 'OK', diff: 'Diverso', nt: 'Non trovato'};
  const VUOTO = '__vuoto__';     // valore del filtro per "deposito/gruppo vuoto"
  const INTERI = new Set(['PZ', 'NR', 'N']);   // per queste unità di misura niente decimali
  const fq = n => new Intl.NumberFormat('it-IT', {maximumFractionDigits: 3}).format(n);
  const fi = n => new Intl.NumberFormat('it-IT').format(n);
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, '');
  const quando = iso => iso ? new Date(iso).toLocaleString('it-IT', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'}) : '';
  const quandoLungo = iso => iso ? new Date(iso).toLocaleString('it-IT', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}) : '';
  const chi = () => (S.prof && (S.prof.nome || S.prof.email)) || (S.user && S.user.email) || 'Utente';

  const I = {
    store: null, userId: null, sess: [], cur: null, rows: [], byN: new Map(), segn: [], view: [], since: '', poll: null,
    f: {dep: '', gr: '', nz: false, st: '', neg: false, q: ''}, tot: 0, fatti: 0, raf: 0, ready: false, busy: false, edit: new Set(),
  };
  const root = () => $('p-inv');

  /* ------------------------------ avvio ------------------------------ */
  async function apri() {
    if (!I.store || I.userId !== (S.user && S.user.id)) {
      fermaPoll(); Object.assign(I, {cur: null, rows: [], byN: new Map(), view: []});
      I.userId = S.user && S.user.id;
      I.store = S.demo ? window.InvStore.demo() : window.InvStore.supabase(S.sb);
    }
    if (I.cur) { disegnaDettaglio(); return; }
    await caricaElenco();
  }
  async function caricaElenco() {
    root().innerHTML = '<p class="calc">Carico gli inventari…</p>';
    try { I.sess = await I.store.elenco(); } catch (e) { root().innerHTML = `<div class="notice"><b>Non riesco a leggere gli inventari.</b> ${esc(errMsg(e))}</div>`; return; }
    disegnaElenco();
  }

  /* ------------------------------ elenco ------------------------------ */
  function disegnaElenco() {
    const resp = S.resp;
    const card = s => `<article class="inv-sess" data-id="${esc(s.id)}">
      <div><b>${esc(s.nome_file)}</b>
        <div class="calc">Creato il ${esc(quandoLungo(s.creato_il))} da ${esc(s.creato_da || '—')}${s.stato === 'chiuso' ? ` · chiuso il ${esc(quandoLungo(s.chiuso_il))}` : ''}</div>
        <div class="calc">${fi(s.contate || 0)} articoli contati su ${fi(s.n_righe)}</div></div>
      <div class="inv-sess-act"><span class="tag ${s.stato === 'chiuso' ? 'ok' : 'warn'}">${s.stato === 'chiuso' ? 'chiuso' : 'aperto'}</span>
        <button class="btn primary small" data-apri="${esc(s.id)}" type="button">${s.stato === 'chiuso' ? 'Consulta' : 'Conta'}</button>
        ${resp ? `<button class="btn ghost small danger" data-del="${esc(s.id)}" type="button">Elimina</button>` : ''}</div></article>`;
    root().innerHTML = `
      <div class="importbox${resp ? '' : ' respOnly'}">
        <div style="display:grid;gap:4px;min-width:0"><b>Nuovo inventario da un export di G7</b>
          <span class="calc">1. In G7 esporta l'elenco articoli in Excel. 2. Caricalo qui: leggo depositi, gruppi e articoli e creo l'inventario. 3. Chi conta lo fa da telefono. 4. Alla fine scarichi un Excel con la stessa struttura di quello di G7, con le sole giacenze corrette, da reimportare in G7.</span></div>
        <div class="topactions"><label class="btn primary" for="invFile">Importa export G7…</label>
          <input id="invFile" type="file" accept=".xlsx" class="visually-hidden"></div>
      </div>
      ${I.sess.length ? `<div class="inv-sesslist">${I.sess.map(card).join('')}</div>`
        : `<div class="notice">Non c'è ancora nessun inventario. ${resp ? 'Importa un export di G7 per iniziare.' : 'Il responsabile deve prima importare l\'export di G7.'}</div>`}`;
  }

  /* ------------------------------ import ------------------------------ */
  async function importa(file) {
    if (!file) return;
    if (typeof JSZip === 'undefined') { toast('Libreria Excel non caricata: ricarica la pagina.'); return; }
    let buf, esito;
    try { buf = await file.arrayBuffer(); esito = await InvXlsx.leggiG7(buf); }
    catch (e) {
      openModal(`<h3>File non valido</h3><p style="margin:0">${esc(e instanceof InvXlsx.ErroreFile ? e.message : 'Non riesco a leggere il file. È un Excel (.xlsx) esportato da G7?')}</p><div class="actions"><button class="btn primary" data-close type="button">Chiudi</button></div>`);
      return;
    }
    const r = esito.riepilogo;
    openModal(`<h3>Controlla i numeri</h3>
      <p class="calc" style="margin:0">File: <b>${esc(file.name)}</b>. Se i numeri tornano con G7, crea l'inventario.</p>
      <div class="inv-sum">
        <div><b>${fi(r.articoli)}</b><small>articoli</small></div><div><b>${fi(r.codiciDistinti)}</b><small>codici diversi</small></div>
        <div><b>${fi(r.depositi)}</b><small>depositi${r.senzaDeposito ? ` (${fi(r.senzaDeposito)} articoli senza deposito)` : ''}</small></div>
        <div><b>${fi(r.gruppi)}</b><small>gruppi</small></div>
        <div><b>${fi(r.conGiacenza)}</b><small>con giacenza diversa da 0</small></div><div><b>${fi(r.negativi)}</b><small>con giacenza negativa</small></div></div>
      ${esito.avvisi.length ? `<div class="notice"><b>Attenzione:</b> ${esito.avvisi.length} codici compaiono due volte nello stesso deposito (es. ${esc(esito.avvisi[0])}). Si possono importare lo stesso, ma vengono contati come righe separate.</div>` : ''}
      <div class="actions"><button class="btn ghost" data-close type="button">Annulla</button><button class="btn primary" id="invCrea" type="button">Crea inventario</button></div>`);
    $('invCrea').onclick = async () => {
      const b = $('invCrea'); b.disabled = true; b.textContent = 'Creo l\'inventario…';
      try {
        const id = await I.store.crea({nome_file: file.name, creato_da: chi(), riepilogo: r}, esito.righe, buf);
        closeModal(); toast('Inventario creato'); await apriSessione(id);
      } catch (e) { b.disabled = false; b.textContent = 'Crea inventario'; toast(errMsg(e)); }
    };
  }

  /* ------------------------------ dettaglio ------------------------------ */
  async function apriSessione(id) {
    root().innerHTML = '<p class="calc">Carico l\'inventario…</p>';
    try {
      const [rows, segn] = await Promise.all([I.store.righe(id), I.store.segnalazioni(id)]);
      I.sess = await I.store.elenco();
      I.cur = I.sess.find(s => s.id === id); if (!I.cur) throw new Error('Inventario non trovato.');
      I.rows = rows.sort((a, b) => a.n - b.n); I.segn = segn;
    } catch (e) { toast(errMsg(e)); await caricaElenco(); return; }
    I.edit.clear(); I.byN = new Map(I.rows.map(r => [r.n, r])); I.rows.forEach(r => { r.k = norm(r.c + r.d); });
    I.since = I.rows.reduce((m, r) => r.at > m ? r.at : m, '');
    I.f = {dep: '', gr: '', nz: false, st: '', neg: false, q: ''};
    disegnaDettaglio(); avviaPoll();
  }
  function opzioni(valori, vuotoTesto, sel) {
    const v = [...valori].sort((a, b) => a.localeCompare(b, 'it', {numeric: true}));
    return `<option value="">${vuotoTesto}</option>` + v.map(x => `<option value="${x === '' ? VUOTO : esc(x)}"${(x === '' ? VUOTO : x) === sel ? ' selected' : ''}>${x === '' ? '(vuoto)' : esc(x)}</option>`).join('');
  }
  function disegnaDettaglio() {
    const c = I.cur, chiuso = c.stato === 'chiuso';
    const deps = new Set(I.rows.map(r => r.dep));
    root().innerHTML = `
      <div class="inv-head">
        <button class="btn small" id="invBack" type="button">← Inventari</button>
        <div class="inv-title"><b>${esc(c.nome_file)}</b><small>${chiuso ? 'Chiuso il ' + esc(quandoLungo(c.chiuso_il)) + ' da ' + esc(c.chiuso_da || '') : 'Creato il ' + esc(quandoLungo(c.creato_il)) + ' da ' + esc(c.creato_da || '')}</small></div>
        <div class="topactions"><button class="btn small" id="invSegn" type="button"${chiuso ? ' disabled' : ''}>+ Articolo non in G7</button>
          <button class="btn primary small" id="invRiep" type="button">${chiuso ? 'Riepilogo ed export' : 'Riepilogo e chiusura'}</button></div>
      </div>
      ${chiuso ? '<div class="notice"><b>Inventario chiuso.</b> Si può consultare e scaricare, ma non modificare.</div>' : ''}
      <div class="inv-prog"><div class="inv-bar"><i id="invBar"></i></div><span id="invProgTxt"></span></div>
      <div class="inv-filters">
        <input class="search" id="invQ" type="search" placeholder="Cerca codice o descrizione…" aria-label="Cerca" value="${esc(I.f.q)}" autocomplete="off">
        <select id="invDep" aria-label="Deposito">${opzioni(deps, 'Tutti i depositi', I.f.dep)}</select>
        <select id="invGr" aria-label="Gruppo"></select>
        <select id="invSt" aria-label="Stato">${['', 'da', 'ok', 'diff', 'nt'].map(k => `<option value="${k}"${I.f.st === k ? ' selected' : ''}>${k ? STATI[k] : 'Tutti gli stati'}</option>`).join('')}</select>
        <div class="chips"><button class="chip" id="invNz" aria-pressed="${I.f.nz}" type="button">Solo giacenza ≠ 0</button>
          <button class="chip" id="invNeg" aria-pressed="${I.f.neg}" type="button">Negativi</button></div>
      </div>
      <div class="inv-list" id="invList" role="list"></div>
      <div class="foot"><span id="invCount"></span></div>`;
    riempiGruppi(); filtra();
  }
  const uguale = (filtro, v) => !filtro || (filtro === VUOTO ? v === '' : v === filtro);
  function riempiGruppi() {
    const gr = new Set(I.rows.filter(r => uguale(I.f.dep, r.dep)).map(r => r.gr));
    if (!gr.has(I.f.gr)) I.f.gr = '';
    $('invGr').innerHTML = opzioni(gr, 'Tutti i gruppi', I.f.gr);
  }
  function filtra() {
    const f = I.f, q = norm(f.q);
    I.view = I.rows.filter(r => uguale(f.dep, r.dep) && uguale(f.gr, r.gr) && (!f.nz || r.g7 !== 0) && (!f.neg || r.g7 < 0)
      && (!f.st || r.st === f.st) && (!q || r.k.includes(q)));
    const l = $('invList'); l.style.height = I.view.length * H + 'px';
    aggiornaProgresso(); disegna();
    $('invCount').textContent = I.view.length ? `${fi(I.view.length)} articoli in elenco` : 'Nessun articolo con questi filtri.';
    if (!I.view.length) l.style.height = '60px', l.innerHTML = '<p class="calc" style="padding:16px">Nessun articolo con questi filtri.</p>';
  }
  function aggiornaProgresso() {
    // Almatech: si verificano TUTTI gli articoli, anche con giacenza 0
    let fatti = 0, totG = 0, fattiG = 0;
    for (const r of I.rows) { if (r.st !== 'da') fatti++; if (r.g7 !== 0) { totG++; if (r.st !== 'da') fattiG++; } }
    const tot = I.rows.length; I.tot = tot; I.fatti = fatti;
    const p = tot ? Math.round(fatti / tot * 100) : 0;
    $('invBar').style.width = p + '%';
    $('invProgTxt').innerHTML = `<b>${fi(fatti)} / ${fi(tot)}</b> articoli verificati · con giacenza: ${fi(fattiG)} / ${fi(totG)}`;
  }

  /* lista "a finestra": disegna solo le righe che si vedono (12.000 righe tutte insieme bloccherebbero il telefono) */
  function disegna() {
    I.raf = 0;
    const l = $('invList'); if (!l || !I.view.length) return;
    const top = l.getBoundingClientRect().top;
    const da = Math.max(0, Math.floor(-top / H) - BUFFER), a = Math.min(I.view.length, Math.ceil((innerHeight - top) / H) + BUFFER);
    let h = ''; for (let i = da; i < a; i++) h += riga(I.view[i], i);
    l.innerHTML = h;
  }
  const programma = () => { if (!I.raf) I.raf = requestAnimationFrame(disegna); };
  function riga(r, i) {
    const chiuso = I.cur.stato === 'chiuso', d = chiuso ? ' disabled' : '';
    const meta = [r.dep ? 'Dep. ' + r.dep : 'Senza deposito', r.gr ? 'Gruppo ' + r.gr : '', r.ub ? 'Ubic. ' + r.ub : '', r.ob ? 'Obsoleto' : ''].filter(Boolean).join(' · ');
    const fatto = r.st !== 'da', modifica = I.edit.has(r.n) && !chiuso;
    let cont = '', link = '', azioni;
    if (fatto) cont = `<div class="inv-cnt">Contato da ${esc(r.by)} · ${esc(quando(r.at))}</div>`;
    if (fatto && !modifica) {
      // riga "chiusa": un solo grande riquadro col risultato, niente pulsanti da toccare per sbaglio
      const dif = r.q - r.g7;
      const testo = r.st === 'ok' ? `✓ OK <span>${fq(r.q)} ${esc(r.um)}</span>`
        : r.st === 'nt' ? `✗ NON TROVATO <span>0 ${esc(r.um)}</span>`
        : `≠ DIVERSO <span>${fq(r.q)} ${esc(r.um)} (${dif > 0 ? '+' : ''}${fq(dif)})</span>`;
      azioni = `<div class="inv-done ${r.st}"><div class="inv-done-t">${testo}</div>${chiuso ? '' : '<button class="inv-edit" data-act="edit" type="button">Modifica</button>'}</div>`;
    } else {
      if (modifica) link = '<span><button class="linkbtn" data-act="keep" type="button">Lascia com\'è</button> · <button class="linkbtn" data-act="undo" type="button">Rimetti da verificare</button></span>';
      azioni = `<div class="inv-btns">
        <button class="inv-b ok" data-act="ok" aria-pressed="${r.st === 'ok'}"${d} type="button">OK</button>
        <button class="inv-b diff" data-act="diff" aria-pressed="${r.st === 'diff'}"${d} type="button">Diverso</button>
        <button class="inv-b nt" data-act="nt" aria-pressed="${r.st === 'nt'}"${d} type="button">Non trovato</button></div>`;
    }
    return `<article class="inv-row st-${r.st}${modifica ? ' editing' : ''}" style="top:${i * H}px;height:${H - 8}px" data-n="${r.n}" role="listitem">
      <div class="inv-r1"><b class="inv-code" title="${esc(r.c)}">${esc(r.c.trim())}</b><span class="tag ${r.st === 'ok' ? 'ok' : r.st === 'da' ? 'acc' : r.st === 'diff' ? 'warn' : 'bad'}">${modifica ? 'In modifica' : STATI[r.st]}</span></div>
      <div class="inv-desc">${esc(r.d)}</div>
      <div class="inv-g7">G7: <b class="${r.g7 < 0 ? 'neg' : ''}">${fq(r.g7)} ${esc(r.um)}</b></div>${cont}
      <div class="inv-meta"><span>${esc(meta)}</span>${link}</div>
      ${azioni}
    </article>`;
  }

  /* ------------------------------ conteggio ------------------------------ */
  async function conta(n, st, q) {
    if (I.cur.stato === 'chiuso') return;
    const r = I.byN.get(n); if (!r) return;
    I.edit.delete(n);
    const patch = {st, q, by: st === 'da' ? '' : chi(), at: new Date().toISOString()};
    const prima = {st: r.st, q: r.q, by: r.by, at: r.at};
    Object.assign(r, patch); if (patch.at > I.since) I.since = patch.at;
    aggiornaProgresso(); if (I.f.st) filtraMantenendoPosizione(); else disegna();
    try {
      const p = await I.store.conta(I.cur.id, n, patch);
      if (p && p.st !== 'da' && p.by && p.by !== patch.by && p.at !== prima.at) toast(`Attenzione: ${p.by} aveva già contato questo articolo (${fq(p.q)} ${r.um}, ${quando(p.at)}). Vale il tuo conteggio.`);
    } catch (e) { Object.assign(r, prima); aggiornaProgresso(); disegna(); toast(errMsg(e)); }
  }
  function filtraMantenendoPosizione() { const y = scrollY; filtra(); scrollTo(0, y); }

  function tastierino(r) {
    const interi = INTERI.has(r.um.toUpperCase());
    let v = r.st === 'diff' ? String(r.q).replace('.', ',') : '';
    openModal(`<h3>Quanti ne hai contati?</h3>
      <p class="calc" style="margin:0"><b>${esc(r.c.trim())}</b> · ${esc(r.d)}<br>In G7: <b>${fq(r.g7)} ${esc(r.um)}</b>${interi ? '' : ' · puoi usare i decimali'}</p>
      <div class="inv-disp" id="kDisp" aria-live="polite"></div>
      <div class="inv-pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}
        <button type="button" data-k="," ${interi ? 'disabled' : ''}>,</button><button type="button" data-k="0">0</button><button type="button" data-k="del" aria-label="Cancella">⌫</button></div>
      <div class="actions"><button class="btn ghost" data-close type="button">Annulla</button><button class="btn primary" id="kOk" type="button">Salva</button></div>`);
    const disp = $('kDisp'), ok = $('kOk');
    const agg = () => { disp.textContent = v === '' ? '—' : v + ' ' + r.um; ok.disabled = v === '' || v === ','; };
    const tasto = k => {
      if (k === 'del') v = v.slice(0, -1);
      else if (k === ',') { if (!interi && !v.includes(',')) v = (v === '' ? '0' : v) + ','; }
      else if (v.replace(',', '').length < 9 && !(v.includes(',') && v.split(',')[1].length >= 3)) v = (v === '0' ? '' : v) + k;
      agg();
    };
    modal.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => tasto(b.dataset.k)));
    const salva = () => {
      if (ok.disabled) return;
      const q = parseFloat(v.replace(',', '.')); closeModal();
      if (q === r.g7) conta(r.n, 'ok', r.g7); else if (q === 0) conta(r.n, 'nt', 0); else conta(r.n, 'diff', q);
    };
    ok.addEventListener('click', salva);
    const ac = new AbortController();
    document.addEventListener('keydown', e => {
      if (ov.hidden) { ac.abort(); return; }
      if (/^\d$/.test(e.key) || e.key === ',' || e.key === '.') { tasto(e.key === '.' ? ',' : e.key); e.preventDefault(); }
      else if (e.key === 'Backspace') { tasto('del'); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); salva(); }
    }, {signal: ac.signal});
    agg();
  }

  function segnalaModal() {
    openModal(`<h3>Articolo trovato ma non in G7</h3>
      <p class="calc" style="margin:0">È solo una segnalazione: non finisce nel file per G7, perché G7 deve prima accettare l'articolo. Compare nel riepilogo.</p>
      <form id="sgForm" style="display:grid;gap:10px">
        <div class="field"><label for="sgC">Codice (se c'è)</label><input id="sgC" autocomplete="off"></div>
        <div class="field"><label for="sgD">Descrizione *</label><input id="sgD" required autocomplete="off"></div>
        <div class="fields"><div class="field"><label for="sgQ">Quantità</label><input id="sgQ" inputmode="decimal" autocomplete="off"></div>
          <div class="field"><label for="sgU">UM</label><input id="sgU" size="4" autocomplete="off"></div>
          <div class="field"><label for="sgDep">Deposito</label><input id="sgDep" size="6" autocomplete="off"></div></div>
        <div class="field"><label for="sgN">Nota</label><input id="sgN" autocomplete="off"></div>
        <div class="actions"><button class="btn ghost" data-close type="button">Annulla</button><button class="btn primary" type="submit">Salva segnalazione</button></div></form>`);
    $('sgForm').onsubmit = async e => {
      e.preventDefault();
      const s = {c: $('sgC').value.trim(), d: $('sgD').value.trim(), q: parseNum($('sgQ').value), um: $('sgU').value.trim().toUpperCase(), dep: $('sgDep').value.trim(), nota: $('sgN').value.trim(), by: chi()};
      if (!s.d) return;
      try { I.segn.push(await I.store.aggiungiSegn(I.cur.id, s)); closeModal(); toast('Segnalazione salvata'); } catch (er) { toast(errMsg(er)); }
    };
  }

  /* ------------------------------ riepilogo, chiusura, export ------------------------------ */
  const cambia = r => (r.st === 'diff' || r.st === 'nt') && r.q !== r.g7;
  function conteggi() {
    const c = {ok: 0, diff: 0, nt: 0, da: 0, cambiano: []};
    for (const r of I.rows) { c[r.st]++; if (cambia(r)) c.cambiano.push(r); }
    return c;
  }
  function riepilogoModal() {
    const c = conteggi(), chiuso = I.cur.stato === 'chiuso', resp = S.resp, dif = c.cambiano;
    const righe = dif.slice(0, 200).map(r => `<tr><td>${esc(r.dep || '—')}</td><td>${esc(r.c.trim())}</td><td>${esc(r.d)}</td><td class="r">${fq(r.g7)}</td><td class="r">${fq(r.q)}</td><td class="r"><b>${r.q - r.g7 > 0 ? '+' : ''}${fq(r.q - r.g7)}</b></td><td>${esc(r.um)}</td></tr>`).join('');
    openModal(`<h3>${chiuso ? 'Riepilogo inventario' : 'Riepilogo e chiusura'}</h3>
      <div class="inv-sum">
        <div><b>${fi(c.ok)}</b><small>OK</small></div><div><b>${fi(dif.length)}</b><small>con giacenza da correggere</small></div>
        <div><b>${fi(c.nt - dif.filter(r => r.st === 'nt').length)}</b><small>non trovati già a 0 in G7</small></div><div><b>${fi(c.da)}</b><small>non verificati (restano come in G7)</small></div>
        <div><b>${fi(I.segn.length)}</b><small>segnalazioni (non vanno in G7)</small></div></div>
      ${dif.length ? `<div class="diffbox"><table class="diff"><thead><tr><th>Dep.</th><th>Codice</th><th>Descrizione</th><th class="r">G7</th><th class="r">Contato</th><th class="r">Diff.</th><th>UM</th></tr></thead><tbody>${righe}</tbody></table></div>
        ${dif.length > 200 ? `<p class="calc" style="margin:0">Mostro le prime 200 su ${fi(dif.length)}: l'elenco completo è nel foglio Excel delle differenze.</p>` : ''}` : '<p class="calc" style="margin:0">Nessuna differenza rispetto a G7.</p>'}
      <div class="actions" style="flex-wrap:wrap">
        <button class="btn" id="rxDif" type="button">Scarica differenze (Excel)</button>
        ${resp ? `<button class="btn" id="rxG7" type="button">Scarica file per G7${chiuso ? '' : ' (provvisorio)'}</button>` : ''}
        ${resp && !chiuso ? '<button class="btn primary" id="rxChiudi" type="button">Chiudi inventario…</button>' : ''}
        <button class="btn ghost" data-close type="button">Chiudi finestra</button></div>
      ${resp && !chiuso ? '<p class="calc" style="margin:0">Il file per G7 parte dal file originale e cambia solo la colonna Esistenza degli articoli con una giacenza diversa. Prima della chiusura è “provvisorio”: non reimportarlo in G7 finché l\'inventario è aperto.</p>' : ''}`);
    $('rxDif').onclick = esportaDifferenze;
    if ($('rxG7')) $('rxG7').onclick = esportaG7;
    if ($('rxChiudi')) $('rxChiudi').onclick = () => chiudiModal(c);
  }
  function chiudiModal(c) {
    openModal(`<h3>Chiudere l'inventario?</h3>
      <p style="margin:0">Dopo la chiusura <b>nessuno potrà più cambiare i conteggi</b>. Si potrà solo consultare e scaricare i file.</p>
      <ul style="margin:0;padding-left:18px"><li>${fi(c.cambiano.length)} articoli avranno la giacenza corretta nel file per G7.</li>
        <li>${fi(c.da)} articoli non verificati restano come in G7.</li>${I.segn.length ? `<li>${fi(I.segn.length)} segnalazioni restano fuori dal file.</li>` : ''}</ul>
      <div class="actions"><button class="btn ghost" data-close type="button">Torna indietro</button><button class="btn primary" id="cfChiudi" type="button">Chiudi inventario</button></div>`);
    $('cfChiudi').onclick = async () => {
      $('cfChiudi').disabled = true;
      try { I.cur = Object.assign(I.cur, await I.store.chiudi(I.cur.id, chi())); fermaPoll(); closeModal(); toast('Inventario chiuso'); disegnaDettaglio(); riepilogoModal(); }
      catch (e) { $('cfChiudi').disabled = false; toast(errMsg(e)); }
    };
  }
  function scarica(blob, nome) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const stem = () => I.cur.nome_file.replace(/\.xlsx$/i, '');
  const dataOggi = () => new Date().toISOString().slice(0, 10);
  function esportaDifferenze() {
    if (!xlsxReady()) return;
    const c = conteggi();
    const wb = XLSX.utils.book_new();
    const aoa = [['Deposito', 'Gruppo', 'Codice articolo', 'Descrizione', 'UM', 'Giacenza G7', 'Contato', 'Differenza', 'Stato', 'Contato da', 'Quando']]
      .concat(c.cambiano.map(r => [r.dep, r.gr, r.c, r.d, r.um, r.g7, r.q, Math.round((r.q - r.g7) * 1e6) / 1e6, STATI[r.st], r.by, quandoLungo(r.at)]));
    XLSX.utils.book_append_sheet(wb, sheet(aoa, [10, 10, 18, 40, 6, 12, 10, 11, 14, 22, 18]), 'Differenze');
    if (I.segn.length) XLSX.utils.book_append_sheet(wb, sheet([['Codice', 'Descrizione', 'Quantità', 'UM', 'Deposito', 'Nota', 'Segnalato da', 'Quando']]
      .concat(I.segn.map(s => [s.c, s.d, s.q, s.um, s.dep, s.nota, s.by, quandoLungo(s.at)])), [18, 40, 10, 6, 10, 30, 22, 18]), 'Segnalazioni');
    XLSX.writeFile(wb, `${stem()}_differenze_${dataOggi()}.xlsx`);
  }
  async function esportaG7() {
    const b = $('rxG7'); b.disabled = true; const t = b.textContent; b.textContent = 'Preparo il file…';
    try {
      const buf = await I.store.file(I.cur.id); if (!buf) throw new Error('Non trovo il file originale di questo inventario.');
      const mod = {}; I.rows.forEach(r => { if (cambia(r)) mod[r.n] = r.q; });
      const blob = await InvXlsx.scriviG7(buf, mod);
      scarica(blob, `${stem()}_contato${I.cur.stato === 'chiuso' ? '' : '_PROVVISORIO'}_${dataOggi()}.xlsx`);
      toast(`File pronto: ${fi(Object.keys(mod).length)} giacenze corrette`);
    } catch (e) { toast(e instanceof InvXlsx.ErroreFile ? e.message : errMsg(e)); }
    b.disabled = false; b.textContent = t;
  }

  /* ------------------------------ più persone insieme (solo Supabase) ------------------------------ */
  function avviaPoll() {
    fermaPoll(); if (I.store.nome !== 'supabase' || I.cur.stato === 'chiuso') return;
    I.poll = setInterval(async () => {
      if (!I.cur || root().hidden || document.hidden || !S.user) return;
      try {
        const nuove = await I.store.modificate(I.cur.id, I.since); if (!nuove.length) return;
        for (const n of nuove) { const r = I.byN.get(n.n); if (r) { Object.assign(r, {st: n.st, q: n.q, by: n.by, at: n.at}); if (n.at > I.since) I.since = n.at; } }
        aggiornaProgresso(); disegna();
      } catch (e) { /* riproverà al prossimo giro */ }
    }, POLL_MS);
  }
  function fermaPoll() { if (I.poll) { clearInterval(I.poll); I.poll = null; } }

  /* ------------------------------ eventi ------------------------------ */
  let tq = 0;
  root().addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('#invBack')) { fermaPoll(); I.cur = null; await caricaElenco(); return; }
    if (t.closest('#invSegn')) return segnalaModal();
    if (t.closest('#invRiep')) return riepilogoModal();
    if (t.closest('#invNz')) { I.f.nz = !I.f.nz; $('invNz').setAttribute('aria-pressed', I.f.nz); return filtra(); }
    if (t.closest('#invNeg')) { I.f.neg = !I.f.neg; $('invNeg').setAttribute('aria-pressed', I.f.neg); return filtra(); }
    const ap = t.closest('[data-apri]'); if (ap) return apriSessione(ap.dataset.apri);
    const del = t.closest('[data-del]');
    if (del) {
      const s = I.sess.find(x => x.id === del.dataset.del);
      openModal(`<h3>Eliminare l'inventario?</h3><p style="margin:0">Cancello <b>${esc(s.nome_file)}</b> con tutti i conteggi. Non si può annullare.</p>
        <div class="actions"><button class="btn ghost" data-close type="button">Annulla</button><button class="btn danger" id="dlOk" type="button">Elimina</button></div>`);
      $('dlOk').onclick = async () => { try { await I.store.elimina(s.id); closeModal(); toast('Inventario eliminato'); await caricaElenco(); } catch (er) { toast(errMsg(er)); } };
      return;
    }
    const a = t.closest('[data-act]'); if (!a) return;
    const art = a.closest('[data-n]'), r = I.byN.get(+art.dataset.n); if (!r) return;
    if (a.dataset.act === 'ok') { if (r.st !== 'ok') conta(r.n, 'ok', r.g7); }
    else if (a.dataset.act === 'nt') { if (r.st !== 'nt') conta(r.n, 'nt', 0); }
    else if (a.dataset.act === 'undo') conta(r.n, 'da', null);
    else if (a.dataset.act === 'edit') { I.edit.add(r.n); disegna(); }
    else if (a.dataset.act === 'keep') { I.edit.delete(r.n); disegna(); }
    else if (a.dataset.act === 'diff') tastierino(r);
  });
  root().addEventListener('change', e => {
    if (e.target.id === 'invFile') { const f = e.target.files[0]; e.target.value = ''; importa(f); }
    else if (e.target.id === 'invDep') { I.f.dep = e.target.value; riempiGruppi(); filtra(); }
    else if (e.target.id === 'invGr') { I.f.gr = e.target.value; filtra(); }
    else if (e.target.id === 'invSt') { I.f.st = e.target.value; filtra(); }
  });
  root().addEventListener('input', e => {
    if (e.target.id === 'invQ') { clearTimeout(tq); tq = setTimeout(() => { I.f.q = e.target.value; filtra(); }, 120); }
  });
  addEventListener('scroll', () => { if (I.cur && !root().hidden) programma(); }, {passive: true});
  addEventListener('resize', () => { if (I.cur && !root().hidden) programma(); });

  window.Inventario = {apri, _stato: I};
})();
