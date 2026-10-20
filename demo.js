/* =====================================================================
 * Modalità dimostrazione: un "database" che vive nel browser.
 *
 * Imita le parti di Supabase usate da app.js (tabelle, funzioni preleva /
 * carica / rettifica, login, aggiornamenti) e applica le stesse regole del
 * database vero (supabase/migrations/001_schema.sql). I dati partono da
 * demo-data.js e restano solo nel browser di chi prova l'app.
 * ===================================================================== */
(function () {
  'use strict';
  const KEY = 'almatech-sfridi-demo-v1';
  const SESSION_KEY = 'almatech-sfridi-demo-sessione';
  const PASSWORD = 'demo';
  const UTENTI_DEMO = [
    {id: 'demo-responsabile', email: 'responsabile@demo.it', nome: 'Responsabile (demo)', ruolo: 'responsabile', attivo: true},
    {id: 'demo-operatore', email: 'operatore@demo.it', nome: 'Operatore (demo)', ruolo: 'operatore', attivo: true},
    {id: 'demo-nuovo', email: 'nuovo.utente@demo.it', nome: 'Nuovo utente (demo)', ruolo: 'operatore', attivo: false},
  ];

  const clone = v => JSON.parse(JSON.stringify(v));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* senza memoria: i dati valgono fino alla chiusura */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignora */ } },
  };

  function seed() {
    const d = window.DEMO_DATA || {materiali: [], lotti: []};
    return {
      versione: d.versione,
      materiali: clone(d.materiali),
      lotti: clone(d.lotti),
      movimenti: [],
      profili: UTENTI_DEMO.map(u => ({...u, creato_il: '2026-10-13T08:00:00.000Z'})),
      seq: 0,
    };
  }
  let DB = null;
  function load() {
    try { DB = JSON.parse(store.get(KEY)); } catch (e) { DB = null; }
    if (!DB || !DB.lotti || DB.versione !== (window.DEMO_DATA || {}).versione) DB = seed();
  }
  function save() { store.set(KEY, JSON.stringify(DB)); }
  load();

  /* ---------------- sessione e permessi ---------------- */
  let session = null;
  try { const s = JSON.parse(store.get(SESSION_KEY)); if (s && s.user) session = s; } catch (e) { /* nessuna sessione */ }
  const listeners = [];
  const me = () => session && DB.profili.find(p => p.id === session.user.id);
  const attivo = () => { const p = me(); return !!(p && p.attivo); };
  const resp = () => { const p = me(); return !!(p && p.attivo && p.ruolo === 'responsabile'); };
  const err = (message) => ({data: null, error: {message}});
  const fail = (message) => { const e = new Error(message); e.demo = true; throw e; };

  /* ---------------- formati e calcoli (come nel database) ---------------- */
  const fmt = v => String(Math.round(Number(v) * 100) / 100).replace('.', ',');
  function misura(l) {
    if (l.forma === 'LASTRA') return `${fmt(l.spessore)} × ${fmt(l.larghezza)} × ${fmt(l.lunghezza)}`;
    return `Ø${fmt(l.diam_est)}${l.diam_int ? '/' + fmt(l.diam_int) : ''} · L ${fmt(l.lunghezza)}`;
  }
  function nuovoCodice(forma, grado) {
    const m = DB.materiali.find(x => x.grado === grado);
    const pref = {LASTRA: 'LA', TONDO: 'TO', TUBO: 'TU'}[forma];
    if (!m || !pref) fail(`Materiale "${grado}" non trovato o forma non valida`);
    const pre = `${pref}-${String(m.famiglia).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)}-`;
    let n = 0;
    DB.lotti.forEach(l => { if (l.codice.startsWith(pre)) { const s = l.codice.slice(pre.length); if (/^\d+$/.test(s)) n = Math.max(n, parseInt(s, 10)); } });
    return pre + String(n + 1).padStart(3, '0');
  }
  function movimento(tipo, l, pezzi, commessa, operatore, note) {
    DB.seq += 1;
    DB.movimenti.push({
      id: DB.seq, creato_il: new Date().toISOString(), tipo, codice: l.codice, descrizione: l.descrizione,
      misura: misura(l), pezzi, commessa: commessa || '', operatore: operatore || '', note: note || '',
      utente: session ? session.user.id : null,
    });
  }
  const pezziTxt = n => n === 1 ? 'pezzo' : 'pezzi';

  /* ---------------- funzioni di magazzino ---------------- */
  const RPC = {
    preleva(a) {
      if (!attivo()) fail('Il tuo utente non è attivo: chiedi al responsabile di attivarlo.');
      const n = a.p_pezzi;
      if (!(n >= 1)) fail('Inserisci almeno 1 pezzo.');
      const l = DB.lotti.find(x => x.codice === a.p_codice);
      if (!l) fail(`Il lotto ${a.p_codice} non esiste.`);
      if (l.pezzi < n) fail(`A magazzino ci sono solo ${l.pezzi} ${pezziTxt(l.pezzi)} di ${l.codice}.`);
      const av = a.p_avanzo;
      let nuovo = null, nl = null;
      if (av) {
        if (n !== 1) fail('Il taglio con avanzo si registra un pezzo alla volta.');
        const lu = Number(av.lunghezza), la = l.forma === 'LASTRA' ? Number(av.larghezza) : l.larghezza;
        if (!(lu > 0) || (l.forma === 'LASTRA' && !(la > 0))) fail('Misura dell\'avanzo non valida.');
        if (l.forma === 'LASTRA' && la * lu >= l.larghezza * l.lunghezza) fail('L\'avanzo deve essere più piccolo della lastra di partenza.');
        if (l.forma !== 'LASTRA' && lu >= l.lunghezza) fail('L\'avanzo deve essere più corto della barra di partenza.');
        nuovo = nuovoCodice(l.forma, l.grado);
        nl = {...clone(l), codice: nuovo, larghezza: la, lunghezza: lu, pezzi: 1, segnalazioni: [], verificato: false,
          origine: `avanzo di ${l.codice} (${misura(l)})`, creato_il: new Date().toISOString()};
      }
      l.pezzi -= n;
      movimento('PRELIEVO', l, -n, a.p_commessa, a.p_operatore, a.p_note || (av ? 'taglio' : ''));
      if (nl) {
        DB.lotti.push(nl);
        movimento('CARICO', nl, 1, a.p_commessa, a.p_operatore, `avanzo di ${l.codice}`);
      }
      return {codice: l.codice, pezzi_rimasti: l.pezzi, avanzo: nuovo};
    },
    carica(a) {
      if (!attivo()) fail('Il tuo utente non è attivo: chiedi al responsabile di attivarlo.');
      const x = a.p_lotto || {}, forma = String(x.forma || '').toUpperCase(), n = parseInt(x.pezzi, 10);
      if (!(n >= 1)) fail('Inserisci almeno 1 pezzo.');
      if (!['LASTRA', 'TONDO', 'TUBO'].includes(forma)) fail('Forma non valida: scegli lastra, tondo o tubo.');
      const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
      const sp = num(x.spessore), la = num(x.larghezza), de = num(x.diam_est), di = num(x.diam_int), lu = num(x.lunghezza);
      if (!(lu > 0) || (forma === 'LASTRA' && !(sp > 0 && la > 0)) || (forma !== 'LASTRA' && !(de > 0)) || (forma === 'TUBO' && !(di > 0 && di < de))) {
        fail('Misure non valide: completa tutte le misure (nel tubo il Ø interno deve essere minore dell\'esterno).');
      }
      const codice = nuovoCodice(forma, x.grado);
      const l = {
        codice, forma, grado: x.grado, descrizione: String(x.descrizione || x.grado).trim().toUpperCase(),
        spessore: forma === 'LASTRA' ? sp : null, larghezza: forma === 'LASTRA' ? la : null,
        diam_est: forma === 'LASTRA' ? null : de, diam_int: forma === 'TUBO' ? di : null, lunghezza: lu,
        pezzi: n, ubicazione: String(x.ubicazione || '').trim(), segnalazioni: [], verificato: false,
        origine: 'caricato a mano', creato_il: new Date().toISOString(),
      };
      DB.lotti.push(l);
      movimento('CARICO', l, n, a.p_commessa, a.p_operatore, a.p_note);
      return codice;
    },
    rettifica(a) {
      if (!attivo()) fail('Il tuo utente non è attivo: chiedi al responsabile di attivarlo.');
      const n = a.p_pezzi_contati;
      if (!(n >= 0)) fail('Inserisci un numero di pezzi valido (0 o più).');
      const l = DB.lotti.find(x => x.codice === a.p_codice);
      if (!l) fail(`Il lotto ${a.p_codice} non esiste.`);
      const diff = n - l.pezzi;
      l.pezzi = n;
      if (a.p_ubicazione !== null && a.p_ubicazione !== undefined) l.ubicazione = String(a.p_ubicazione).trim();
      if (diff !== 0) movimento('RETTIFICA', l, diff, a.p_commessa, a.p_operatore, a.p_note || `conteggio: ${n} pz`);
      return diff;
    },
  };

  /* ---------------- lettura e scrittura tabelle (con le stesse regole) ---------------- */
  const SCRIVIBILI = {
    lotti: {update: ['descrizione', 'ubicazione', 'verificato', 'segnalazioni'], chi: resp},
    materiali: {update: null, insert: true, chi: resp},
    profili: {update: ['nome', 'ruolo', 'attivo'], chi: resp},
  };
  function visibili(t) {
    if (!session) return [];
    if (t === 'profili') return attivo() ? DB.profili : DB.profili.filter(p => p.id === session.user.id);
    return attivo() ? (DB[t] || []) : [];
  }
  class Query {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.o = null; this.from = 0; this.lim = null; this.one = false; this.ret = false; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    eq(c, v) { this.f.push([c, v]); return this; }
    order(c, o) { this.o = [c, o && o.ascending === false ? -1 : 1]; return this; }
    range(a, b) { this.from = a; this.lim = b - a + 1; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = true; return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    insert(r) { this.op = 'insert'; this.rows = Array.isArray(r) ? r : [r]; return this; }
    match(r) { return this.f.every(([c, v]) => r[c] === v); }
    run() {
      const t = this.t;
      if (this.op === 'select') {
        let rows = visibili(t).filter(r => this.match(r));
        if (this.o) { const [c, d] = this.o; rows = rows.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * d); }
        rows = rows.slice(this.from, this.lim == null ? undefined : this.from + this.lim);
        rows = clone(rows);
        return {data: this.one ? (rows[0] || null) : rows, error: null};
      }
      const rule = SCRIVIBILI[t];
      if (!rule) return err(`permission denied for table ${t}`);
      if (this.op === 'update') {
        if (rule.update && Object.keys(this.patch).some(k => !rule.update.includes(k))) return err(`permission denied for table ${t}`);
        if (!rule.chi()) return {data: [], error: null};
        const hit = visibili(t).filter(r => this.match(r));
        hit.forEach(r => Object.assign(r, clone(this.patch)));
        if (hit.length) save();
        return {data: this.ret ? clone(hit) : null, error: null};
      }
      if (this.op === 'insert') {
        if (!rule.insert || !rule.chi()) return err(`new row violates row-level security policy for table "${t}"`);
        for (const r of this.rows) if (DB[t].some(x => x.grado === r.grado)) return err(`Il materiale ${r.grado} esiste già.`);
        this.rows.forEach(r => DB[t].push({prezzo_esempio: false, note: '', ...clone(r)}));
        save();
        return {data: null, error: null};
      }
      return err('Operazione non supportata nella demo');
    }
    then(res, rej) { return new Promise(r => setTimeout(r, 40)).then(() => { const out = this.run(); if (this.op !== 'select' && !out.error) notify(this.t); return out; }).then(res, rej); }
  }

  /* ---------------- aggiornamenti (anche tra schede dello stesso browser) ---------------- */
  const channels = new Set();
  function notify(t) { channels.forEach(ch => ch.handlers.forEach(h => { if (h.table === t) h.fn({table: t}); })); }
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    load();
    ['lotti', 'materiali', 'movimenti', 'profili'].forEach(notify);
  });

  const auth = {
    onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', session), 0); return {data: {subscription: {unsubscribe() {}}}}; },
    async signInWithPassword({email, password}) {
      const p = DB.profili.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!p || password !== PASSWORD) return {data: null, error: {message: 'Invalid login credentials'}};
      session = {user: {id: p.id, email: p.email}};
      store.set(SESSION_KEY, JSON.stringify(session));
      setTimeout(() => listeners.forEach(cb => cb('SIGNED_IN', session)), 0);
      return {data: {session}, error: null};
    },
    async signInWithOtp() { return {error: {message: 'Nella demo il link via email non è attivo: usa la password “demo”.'}}; },
    async signOut() { session = null; store.del(SESSION_KEY); listeners.forEach(cb => cb('SIGNED_OUT', null)); return {error: null}; },
    async updateUser() { return {data: null, error: {message: 'Nella demo la password resta “demo”.'}}; },
  };

  window.DemoBackend = {
    UTENTI: UTENTI_DEMO.filter(u => u.attivo).map(u => ({email: u.email, ruolo: u.ruolo})),
    PASSWORD,
    reset() { DB = seed(); save(); ['lotti', 'materiali', 'movimenti', 'profili'].forEach(notify); },
    createClient() {
      return {
        from: t => new Query(t),
        async rpc(fn, args) {
          await new Promise(r => setTimeout(r, 60));
          if (!session) return err(`permission denied for function ${fn}`);
          if (!RPC[fn]) return err(`permission denied for function ${fn}`);
          const prima = clone(DB);
          try { const data = RPC[fn](clone(args || {})); save(); notify('lotti'); notify('movimenti'); return {data, error: null}; }
          catch (e) { DB = prima; return err(e.message); }
        },
        auth,
        channel() {
          const ch = {handlers: [], on(_, filter, fn) { ch.handlers.push({table: filter.table, fn}); return ch; },
            subscribe(cb) { channels.add(ch); setTimeout(() => cb && cb('SUBSCRIBED'), 0); return ch; }};
          return ch;
        },
        removeChannel(ch) { channels.delete(ch); },
      };
    },
  };
})();
