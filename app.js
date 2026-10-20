/* =====================================================================
 * Magazzino sfridi Almatech — web app (Supabase)
 *
 * Tutti i dati stanno nel database Supabase. Le operazioni che cambiano
 * i pezzi (prelievo, carico, rettifica) passano dalle funzioni del database
 * (vedi supabase/migrations/001_schema.sql), così due persone che lavorano
 * insieme non si sovrascrivono.
 * ===================================================================== */
'use strict';

const nf0 = new Intl.NumberFormat('it-IT', {maximumFractionDigits: 0});
const nf1 = new Intl.NumberFormat('it-IT', {minimumFractionDigits: 1, maximumFractionDigits: 1});
const nf2 = new Intl.NumberFormat('it-IT', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const PREF = {LASTRA: 'LA', TONDO: 'TO', TUBO: 'TU'};
const COLORS = [['AZZURRO', '#6db3e6'], ['BIANCO', '#f6f6f2'], ['NERO', '#23272b'], ['BLU', '#2a5db0'], ['GRIGIO', '#8a9399'], ['VERDE', '#3d8b4f'], ['GIALLO', '#e3c23a'], ['ROSSO', '#c23b2e'], ['NAT', '#e6dcc2'], ['MEDICAL GREY', '#9aa3a8']];
const $ = id => document.getElementById(id);

const S = {
  sb: null, user: null, prof: null, resp: false,
  lots: [], mats: [], movs: [], users: [],
  loaded: false, channel: null, poll: null,
};

/* ---------------- conversione dati database → app ---------------- */
const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
const mapLot = r => ({
  c: r.codice, f: r.forma, g: r.grado, m: r.descrizione,
  sp: num(r.spessore), la: num(r.larghezza), de: num(r.diam_est), di: num(r.diam_int), lu: num(r.lunghezza),
  pz: r.pezzi, ub: r.ubicazione || '', fl: r.segnalazioni || [], ok: !!r.verificato, o: r.origine || '',
});
const mapMat = r => ({g: r.grado, fam: r.famiglia, d: num(r.peso_specifico), p: num(r.prezzo_kg), esempio: !!r.prezzo_esempio, note: r.note || '', ord: r.ordine || 0});
const mapMov = r => ({
  ts: r.creato_il, d: new Date(r.creato_il).toLocaleString('it-IT', {day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'}),
  t: r.tipo, c: r.codice, m: r.descrizione, mis: r.misura, n: r.pezzi, com: r.commessa, op: r.operatore, note: r.note,
});

/* ---------------- calcoli ---------------- */
const matOf = g => S.mats.find(m => m.g === g) || {};
function vol(l) { if (l.f === 'LASTRA') return (l.sp || 0) * (l.la || 0) * (l.lu || 0); return Math.PI / 4 * ((l.de || 0) ** 2 - (l.di || 0) ** 2) * (l.lu || 0); }
function w1(l) { const d = matOf(l.g).d; return d == null ? null : vol(l) / 1e6 * d; }
function wTot(l) { const w = w1(l); return w == null ? null : w * (l.pz || 0); }
function price(l) { const p = matOf(l.g).p; return p == null ? null : p; }
function val(l) { const w = wTot(l), p = price(l); return (w == null || p == null) ? null : w * p; }
const fmtN = n => n == null ? '–' : (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100).replace('.', ','));
function misura(l) {
  if (l.f === 'LASTRA') return `${fmtN(l.sp)} × ${fmtN(l.la)} × ${fmtN(l.lu)}`;
  return `Ø${fmtN(l.de)}${l.di ? '/' + fmtN(l.di) : ''} · L ${fmtN(l.lu)}`;
}
function colorOf(desc) { const d = (desc || '').toUpperCase(); for (const [k, c] of COLORS) if (d.includes(k)) return c; return null; }
function shapeSvg(l) {
  if (l.f === 'LASTRA') return `<svg class="shape" viewBox="0 0 26 18" aria-hidden="true"><path d="M3 7 L17 3 L23 7 L9 11 Z" fill="currentColor" opacity=".35"/><path d="M3 7 L9 11 L9 14 L3 10 Z M9 11 L23 7 L23 10 L9 14 Z" fill="currentColor" opacity=".7"/></svg>`;
  if (l.f === 'TUBO') return `<svg class="shape" viewBox="0 0 26 18" aria-hidden="true"><circle cx="13" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="3.2" opacity=".7"/></svg>`;
  return `<svg class="shape" viewBox="0 0 26 18" aria-hidden="true"><circle cx="13" cy="9" r="7.5" fill="currentColor" opacity=".6"/></svg>`;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
/* solo anteprima: il codice vero lo assegna il database */
function nextCode(f, g) {
  const fam = (matOf(g).fam || g.split(/[\s+-]/)[0] || 'ALTRO').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  const pre = `${PREF[f]}-${fam}-`;
  let max = 0;
  S.lots.forEach(l => { if (l.c.startsWith(pre)) { const n = parseInt(l.c.slice(pre.length), 10); if (n > max) max = n; } });
  return pre + String(max + 1).padStart(3, '0');
}
function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v).replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s); return isFinite(n) ? n : null;
}
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------------- stato schermata ---------------- */
function sync(state, text) { $('syncDot').className = 'pulse ' + state; $('syncText').textContent = text; }
function show(view) {
  $('login').hidden = view !== 'login';
  $('gate').hidden = view !== 'gate';
  $('app').hidden = view !== 'app';
  $('topActions').hidden = view !== 'app';
}
function gate(title, text, actions) {
  $('gate').innerHTML = `<h2>${esc(title)}</h2><p>${esc(text)}</p>${actions || ''}`;
  show('gate');
}
function errMsg(e) {
  const m = (e && (e.message || e.error_description)) || '';
  if (/Invalid login credentials/i.test(m)) return 'Email o password non corretti.';
  if (/Email not confirmed/i.test(m)) return 'Email non ancora confermata: apri il link che hai ricevuto.';
  if (/Signups not allowed|User not found|otp_disabled/i.test(m)) return 'Questa email non è registrata. Chiedi al responsabile di invitarti.';
  if (/rate limit|too many/i.test(m)) return 'Troppi tentativi ravvicinati: aspetta qualche minuto e riprova.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Connessione assente o instabile. Controlla la rete e riprova.';
  if (/permission denied|row-level security|JWT/i.test(m)) return 'Il tuo utente non ha il permesso per questa operazione.';
  return m || 'Operazione non riuscita. Riprova.';
}

/* ---------------- caricamento dati ---------------- */
async function fetchAll(table, order, asc = true) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const {data, error} = await S.sb.from(table).select('*').order(order, {ascending: asc}).range(from, from + page - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < page) return out;
  }
}
async function loadLots() { S.lots = (await fetchAll('lotti', 'codice')).map(mapLot); }
async function loadMats() { S.mats = (await fetchAll('materiali', 'ordine')).map(mapMat); }
async function loadMovs() {
  const {data, error} = await S.sb.from('movimenti').select('*').order('creato_il', {ascending: false}).limit(500);
  if (error) throw error; S.movs = data.map(mapMov);
}
async function loadUsers() {
  if (!S.resp) { S.users = []; return; }
  const {data, error} = await S.sb.from('profili').select('*').order('creato_il');
  if (error) throw error; S.users = data;
}
const loaders = {lotti: loadLots, materiali: loadMats, movimenti: loadMovs, profili: loadUsers};
const pending = new Map();
function refresh(...tables) {
  return Promise.all(tables.map(t => {
    if (pending.has(t)) return pending.get(t);
    const p = new Promise(r => setTimeout(r, 150)).then(loaders[t]).catch(e => { console.error(e); sync('off', 'Errore nel leggere i dati: ricarica la pagina'); })
      .finally(() => { pending.delete(t); renderAll(); });
    pending.set(t, p); return p;
  }));
}

/* ---------------- render ---------------- */
function renderKPI() {
  const act = S.lots.filter(l => l.pz > 0);
  let kg = 0, eur = 0, nd = 0; act.forEach(l => { const w = wTot(l), v = val(l); if (w == null) nd++; else kg += w; if (v != null) eur += v; });
  const pz = act.reduce((a, l) => a + l.pz, 0);
  const noPrice = S.mats.filter(m => m.p == null).length;
  const example = S.mats.some(m => m.esempio);
  $('kpis').innerHTML = `
    <div class="kpi"><span class="eyebrow">Lotti a magazzino</span><b class="num">${nf0.format(act.length)}</b><small>${S.lots.length - act.length} esauriti</small></div>
    <div class="kpi"><span class="eyebrow">Pezzi</span><b class="num">${nf0.format(pz)}</b><small>lastre, tondi e tubi</small></div>
    <div class="kpi"><span class="eyebrow">Peso</span><b class="num">${nf0.format(kg)} kg</b><small>${nd ? nd + ' lotti senza peso specifico' : 'da volume × peso specifico'}</small></div>
    <div class="kpi"><span class="eyebrow">Valore</span><b class="num">${nf0.format(eur)} €</b><small>${example ? '<span class="tag warn">contiene prezzi di esempio</span>' : (noPrice ? `${noPrice} materiali senza prezzo` : '<span class="tag ok">prezzi Almatech</span>')}</small></div>`;
  const open = S.lots.filter(l => l.fl.length && !l.ok).length;
  $('chkCount').textContent = open || '';
  const waiting = S.users.filter(u => !u.attivo).length;
  $('usrCount').textContent = waiting || '';
}

let F = {forma: '', q: '', fit: null};
function fits(l, r) {
  if (l.pz <= 0 || l.f !== r.forma) return false;
  if (r.grado && l.g !== r.grado) return false;
  if (l.f === 'LASTRA') { if (r.sp && l.sp < r.sp) return false; const a = r.la || 0, b = r.lu || 0; return (l.la >= a && l.lu >= b) || (l.la >= b && l.lu >= a); }
  if (r.de && l.de < r.de) return false;
  if (l.f === 'TUBO' && r.di && (l.di || 0) > r.di) return false;
  return !r.lu || l.lu >= r.lu;
}
function visibleLots() {
  let list = S.lots;
  if (F.fit) { const r = F.fit, gap = l => l.f === 'LASTRA' ? (l.sp - (r.sp || 0)) : (l.de - (r.de || 0)); return list.filter(l => fits(l, r)).sort((a, b) => (gap(a) - gap(b)) || (vol(a) - vol(b))); }
  if (F.forma === 'ZERO') list = list.filter(l => l.pz <= 0);
  else { list = list.filter(l => l.pz > 0); if (F.forma) list = list.filter(l => l.f === F.forma); }
  if (F.q) { const n = s => s.toUpperCase().replace(/X/g, '×').replace(/\s/g, ''); const t = n(F.q); list = list.filter(l => n(l.c + l.m + l.g + misura(l) + l.ub).includes(t)); }
  return list;
}
function renderRows() {
  const list = visibleLots(), tb = $('rows');
  if (!list.length) tb.innerHTML = `<tr><td colspan="8" class="empty">${F.fit ? 'Nessuno sfrido abbastanza grande per questa misura. Serve materia prima nuova.' : (S.lots.length ? 'Nessun lotto corrisponde alla ricerca.' : 'Il magazzino è vuoto. Usa “+ Carica sfrido” per registrare il primo pezzo.')}</td></tr>`;
  else tb.innerHTML = list.map((l, i) => {
    const w = wTot(l), v = val(l), c = colorOf(l.m), best = F.fit && i === 0;
    return `<tr class="${best ? 'best' : ''} ${l.pz <= 0 ? 'zero' : ''}">
      <td class="code">${esc(l.c)}</td>
      <td><span class="mat">${shapeSvg(l)}${c ? `<span class="dot" style="background:${c}"></span>` : ''}<span>${esc(l.m)}${best ? ' <span class="tag ok">più adatto</span>' : ''}</span></span></td>
      <td class="mono num">${misura(l)}</td>
      <td class="r num"><b>${l.pz}</b></td>
      <td class="r num">${w == null ? '<span class="tag warn">n.d.</span>' : nf1.format(w)}</td>
      <td class="r num">${v == null ? '–' : nf0.format(v)}</td>
      <td>${esc(l.ub)}</td>
      <td class="r" style="white-space:nowrap">${l.fl.length && !l.ok ? `<span class="flag" title="${esc(l.fl.join(' · '))}">!</span> ` : ''}<button class="btn small" data-pick="${esc(l.c)}" type="button">${l.pz > 0 ? 'Preleva' : 'Correggi'}</button></td>
    </tr>`;
  }).join('');
  const act = list.filter(l => l.pz > 0);
  $('shown').textContent = F.fit ? `${act.length} sfridi adatti, il primo è quello con meno spreco` : `${list.length} lotti mostrati`;
}
function renderMovs() {
  const tb = $('movRows');
  if (!S.movs.length) { tb.innerHTML = `<tr><td colspan="9" class="empty">Ancora nessun movimento. Ogni prelievo, carico o correzione compare qui con commessa e operatore.</td></tr>`; return; }
  tb.innerHTML = S.movs.map(m => {
    const cls = m.t === 'PRELIEVO' ? 'bad' : m.t === 'CARICO' ? 'ok' : 'acc';
    return `<tr><td class="num" style="white-space:nowrap">${esc(m.d)}</td><td><span class="tag ${cls}">${esc(m.t)}</span></td>
    <td class="code">${esc(m.c)}</td><td>${esc(m.m)}</td><td class="mono">${esc(m.mis)}</td>
    <td class="r num">${m.n > 0 ? '+' : '−'}${Math.abs(m.n)}</td><td>${esc(m.com)}</td><td>${esc(m.op)}</td><td>${esc(m.note)}</td></tr>`;
  }).join('');
}
function renderMats() {
  const example = S.mats.some(m => m.esempio);
  $('priceNotice').innerHTML = example
    ? `<b>Prezzi di esempio.</b> I €/kg segnati “esempio” servono solo a mostrare il calcolo: ${S.resp ? 'sostituiscili con i costi Almatech, a mano qui sotto o importando il listino.' : 'il responsabile li sostituirà con i costi Almatech.'}`
    : `Prezzi aggiornati. Ogni modifica vale subito per tutti gli utenti e ricalcola il valore di magazzino.`;
  $('matRows').innerHTML = S.mats.map((m, i) => {
    const ls = S.lots.filter(l => l.g === m.g && l.pz > 0); let kg = 0, eur = 0; ls.forEach(l => { kg += wTot(l) || 0; eur += val(l) || 0; });
    const dis = S.resp ? '' : 'disabled';
    return `<tr><td><b>${esc(m.g)}</b>${m.esempio ? ' <span class="tag warn">esempio</span>' : ''}</td><td>${esc(m.fam)}</td>
      <td class="r"><input id="md-${i}" data-mi="${i}" data-k="peso_specifico" type="number" step="0.01" min="0" value="${m.d ?? ''}" class="${m.d == null ? 'missing' : ''}" aria-label="Peso specifico ${esc(m.g)}" ${dis}></td>
      <td class="r"><input id="mp-${i}" data-mi="${i}" data-k="prezzo_kg" type="number" step="0.01" min="0" value="${m.p ?? ''}" class="${m.p == null ? 'missing' : ''}" aria-label="Prezzo ${esc(m.g)}" ${dis}></td>
      <td class="r num">${ls.length}</td><td class="r num">${nf1.format(kg)}</td><td class="r num">${nf0.format(eur)}</td>
      <td style="color:var(--muted);font-size:13px">${esc(m.note)}</td></tr>`;
  }).join('');
}
function renderChecks() {
  const list = S.lots.filter(l => l.fl.length);
  $('chkList').innerHTML = list.length ? list.map(l => `
    <div class="check ${l.ok ? 'done' : ''}">
      <div style="display:grid;gap:4px;min-width:0">
        <div><span class="code">${esc(l.c)}</span> · ${esc(l.m)} · <span class="mono">${misura(l)}</span> · <b>${l.pz} pz</b></div>
        <div class="what">${esc(l.fl.join(' · '))}</div>
        <div class="orig">Nel vecchio file: ${esc(l.o)}</div>
      </div>
      ${S.resp ? `<button class="btn small ${l.ok ? '' : 'primary'}" data-ok="${esc(l.c)}" type="button">${l.ok ? 'Verificato ✓' : 'Segna verificato'}</button>` : `<span class="tag ${l.ok ? 'ok' : 'warn'}">${l.ok ? 'verificato' : 'da verificare'}</span>`}
    </div>`).join('') : `<p class="calc">Nessuna riga da verificare.</p>`;
}
function renderUsers() {
  if (!S.resp) return;
  $('usrRows').innerHTML = S.users.map(u => {
    const me = u.id === S.user.id;
    return `<tr>
      <td>${esc(u.email)}${me ? ' <span class="tag acc">tu</span>' : ''}</td>
      <td><input type="text" id="un-${esc(u.id)}" data-uid="${esc(u.id)}" data-k="nome" value="${esc(u.nome)}" aria-label="Nome ${esc(u.email)}"></td>
      <td><select id="ur-${esc(u.id)}" data-uid="${esc(u.id)}" data-k="ruolo" ${me ? 'disabled' : ''} aria-label="Ruolo ${esc(u.email)}">
        <option value="operatore" ${u.ruolo === 'operatore' ? 'selected' : ''}>Operatore</option>
        <option value="responsabile" ${u.ruolo === 'responsabile' ? 'selected' : ''}>Responsabile</option></select></td>
      <td>${me ? '<span class="tag ok">attivo</span>' : `<button class="btn small ${u.attivo ? '' : 'primary'}" data-act="${esc(u.id)}" type="button">${u.attivo ? 'Disattiva' : 'Attiva'}</button> ${u.attivo ? '' : '<span class="tag warn">in attesa</span>'}`}</td></tr>`;
  }).join('');
}
function fillGradeSelect() {
  const sel = $('fGrado'), cur = sel.value;
  sel.innerHTML = '<option value="">Tutti</option>' + S.mats.map(m => `<option>${esc(m.g)}</option>`).join('');
  sel.value = cur;
}
let rq = 0;
function renderAll() {
  if (!S.loaded || rq) return;
  rq = requestAnimationFrame(() => {
    rq = 0;
    const busy = el => el.contains(document.activeElement);
    renderKPI(); renderRows(); renderMovs(); renderChecks(); fillGradeSelect();
    if (!busy($('matRows'))) renderMats();
    if (!busy($('usrRows'))) renderUsers();
  });
}

/* ---------------- finestre ---------------- */
const ov = $('ov'), modal = $('modal');
let modalAC = null;
function openModal(html) { if (modalAC) modalAC.abort(); modalAC = new AbortController(); modal.innerHTML = html; ov.hidden = false; const f = modal.querySelector('input:not([disabled]),select,button'); f && f.focus(); }
function closeModal() { if (modalAC) { modalAC.abort(); modalAC = null; } ov.hidden = true; modal.innerHTML = ''; }
ov.addEventListener('click', e => { if (e.target === ov) closeModal(); });
modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden) closeModal(); });
function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 4500); }
async function rpc(fn, args) { const {data, error} = await S.sb.rpc(fn, args); if (error) throw error; return data; }

function pickModal(code) {
  const l = S.lots.find(x => x.c === code); if (!l) return;
  const isL = l.f === 'LASTRA';
  openModal(`
    <h3>${l.pz > 0 ? 'Prelievo sfrido' : 'Correggi conteggio'}</h3>
    <div class="lotcard"><span class="code">${esc(l.c)}</span><b>${esc(l.m)} · <span class="mono">${misura(l)}</span></b><span class="calc">${l.pz} pz a magazzino · ${w1(l) == null ? 'peso n.d.' : nf2.format(w1(l)) + ' kg al pezzo'}${l.ub ? ' · ' + esc(l.ub) : ''}</span></div>
    <div class="seg" role="group" aria-label="Operazione">
      ${l.pz > 0 ? `<button type="button" data-mode="whole" aria-pressed="true">Pezzi interi</button><button type="button" data-mode="cut" aria-pressed="false">Taglio con avanzo</button>` : ''}
      <button type="button" data-mode="fix" aria-pressed="${l.pz > 0 ? 'false' : 'true'}">Correggi conteggio</button>
    </div>
    <div class="fields" id="mWhole" ${l.pz > 0 ? '' : 'hidden'}><div class="field"><label for="pN">Pezzi da prelevare</label><input id="pN" type="number" min="1" max="${l.pz}" value="1"></div></div>
    <div id="mCut" hidden style="display:grid;gap:10px">
      ${isL ? `<p class="calc" style="margin:0">Prelevi 1 lastra e rientra in magazzino la parte che avanza. Inserisci la misura dell'avanzo.</p>
      <div class="fields"><div class="field"><label for="rSp">Spessore</label><input id="rSp" type="number" value="${l.sp}" disabled></div>
      <div class="field"><label for="rLa">Larghezza avanzo</label><input id="rLa" type="number" min="0" value="${l.la}"></div>
      <div class="field"><label for="rLu">Lunghezza avanzo</label><input id="rLu" type="number" min="0" value=""></div></div>`
      : `<div class="fields"><div class="field"><label for="cUse">Lunghezza usata (mm)</label><input id="cUse" type="number" min="1" max="${l.lu}"></div>
         <div class="field"><label for="cKerf">Scarto taglio (mm)</label><input id="cKerf" type="number" min="0" value="3"></div></div>`}
      <div class="calc" id="cRes"></div>
    </div>
    <div id="mFix" ${l.pz > 0 ? 'hidden' : ''} style="display:grid;gap:8px">
      <p class="calc" style="margin:0">Dopo un conteggio fisico: scrivi quanti pezzi ci sono davvero. La differenza viene registrata come rettifica.</p>
      <div class="fields"><div class="field"><label for="fixN">Pezzi contati</label><input id="fixN" type="number" min="0" value="${l.pz}"></div>
      <div class="field wide"><label for="fixUb">Ubicazione</label><input id="fixUb" value="${esc(l.ub)}" placeholder="es. Scaffale B2"></div></div>
    </div>
    <div class="fields">
      <div class="field wide"><label for="pCom">Commessa / ordine</label><input id="pCom" placeholder="es. ORD 2026/345"></div>
      <div class="field"><label for="pOp">Operatore</label><input id="pOp" value="${esc(S.prof.nome)}" placeholder="Nome"></div>
    </div>
    <div class="err" id="pErr"></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="button" id="pOk">Conferma</button></div>`);
  let mode = l.pz > 0 ? 'whole' : 'fix';
  const upd = () => {
    const r = $('cRes'); if (!r || mode !== 'cut') return;
    if (isL) {
      const la = +$('rLa').value, lu = +$('rLu').value, w = w1({...l, la, lu});
      r.innerHTML = (la > 0 && lu > 0) ? `Rientra un avanzo <b class="mono">${fmtN(l.sp)} × ${fmtN(la)} × ${fmtN(lu)}</b>${w != null ? ` da <b>${nf2.format(w)} kg</b>` : ''}` : 'Lascia vuota la lunghezza se non avanza niente di utilizzabile.';
    } else {
      const u = +$('cUse').value, k = +$('cKerf').value || 0, rest = l.lu - u - k, wr = w1({...l, lu: rest});
      r.innerHTML = u > 0 ? (rest > 0 ? `Rientra un avanzo <b class="mono">${misura({...l, lu: rest})}</b>${wr != null ? ` da <b>${nf2.format(wr)} kg</b>` : ''}` : `<span class="err">Nessun avanzo: il pezzo viene consumato tutto.</span>`) : `Barra da ${fmtN(l.lu)} mm.`;
    }
  };
  modal.addEventListener('input', upd, {signal: modalAC.signal});
  modal.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    mode = b.dataset.mode; modal.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('mWhole').hidden = mode !== 'whole'; $('mCut').hidden = mode !== 'cut'; $('mFix').hidden = mode !== 'fix'; upd();
  });
  $('pOk').onclick = async () => {
    const com = $('pCom').value.trim(), op = $('pOp').value.trim(), err = $('pErr'), btn = $('pOk');
    let n = 1, avanzo = null, fixN = null;
    if (mode === 'whole') { n = parseInt($('pN').value, 10); if (!(n >= 1)) { err.textContent = 'Inserisci almeno 1 pezzo.'; return; } if (n > l.pz) { err.textContent = `A magazzino ${l.pz === 1 ? 'c\'è solo 1 pezzo' : `ci sono solo ${l.pz} pezzi`}.`; return; } }
    else if (mode === 'cut') {
      if (isL) { const la = +$('rLa').value, lu = +$('rLu').value; if (la > 0 && lu > 0) avanzo = {larghezza: la, lunghezza: lu}; }
      else { const u = +$('cUse').value, k = +$('cKerf').value || 0; if (!(u > 0 && u <= l.lu)) { err.textContent = `La lunghezza usata deve stare tra 1 e ${fmtN(l.lu)} mm.`; return; } if (l.lu - u - k > 0) avanzo = {lunghezza: l.lu - u - k}; }
    } else { fixN = parseInt($('fixN').value, 10); if (!(fixN >= 0)) { err.textContent = 'Inserisci un numero di pezzi valido (0 o più).'; return; } }
    btn.disabled = true; btn.textContent = 'Salvataggio…'; err.textContent = '';
    try {
      let msg;
      if (mode === 'fix') {
        const diff = await rpc('rettifica', {p_codice: l.c, p_pezzi_contati: fixN, p_ubicazione: $('fixUb').value.trim(), p_commessa: com, p_operatore: op, p_note: ''});
        msg = diff === 0 ? `${l.c}: conteggio confermato` : `${l.c}: pezzi corretti a ${fixN} (${diff > 0 ? '+' : ''}${diff})`;
      } else {
        const r = await rpc('preleva', {p_codice: l.c, p_pezzi: n, p_commessa: com, p_operatore: op, p_note: '', p_avanzo: avanzo});
        msg = `Prelevato ${n} pz da ${l.c}` + (r && r.avanzo ? ` · avanzo caricato come ${r.avanzo}` : '');
      }
      closeModal(); toast(msg); refresh('lotti', 'movimenti');
    } catch (e) { err.textContent = errMsg(e); btn.disabled = false; btn.textContent = 'Conferma'; }
  };
}

function loadModal() {
  const opts = S.mats.map(m => `<option value="${esc(m.g)}">${esc(m.g)}</option>`).join('');
  openModal(`
    <h3>Carica sfrido</h3>
    <p class="calc" style="margin:0">Per un pezzo che rientra dall'officina o un avanzo da registrare.</p>
    <div class="fields">
      <div class="field"><label for="nF">Forma</label><select id="nF"><option value="LASTRA">Lastra</option><option value="TONDO">Tondo</option><option value="TUBO">Tubo</option></select></div>
      <div class="field"><label for="nG">Grado</label><select id="nG">${opts}</select></div>
      <div class="field wide"><label for="nM">Descrizione (colore, variante)</label><input id="nM" placeholder="es. POM NERO"></div>
    </div>
    <div class="fields">
      <div class="field nL"><label for="nSp">Spessore</label><input id="nSp" type="number" min="0" step="0.5"></div>
      <div class="field nL"><label for="nLa">Larghezza</label><input id="nLa" type="number" min="0"></div>
      <div class="field nT" hidden><label for="nDe">Ø esterno</label><input id="nDe" type="number" min="0"></div>
      <div class="field nU" hidden><label for="nDi">Ø interno</label><input id="nDi" type="number" min="0"></div>
      <div class="field"><label for="nLu">Lunghezza</label><input id="nLu" type="number" min="0"></div>
      <div class="field"><label for="nPz">Pezzi</label><input id="nPz" type="number" min="1" value="1"></div>
    </div>
    <div class="fields">
      <div class="field"><label for="nUb">Ubicazione</label><input id="nUb" placeholder="es. Scaffale B2"></div>
      <div class="field wide"><label for="nCom">Commessa / provenienza</label><input id="nCom" placeholder="es. rientro officina"></div>
      <div class="field"><label for="nOp">Operatore</label><input id="nOp" value="${esc(S.prof.nome)}"></div>
    </div>
    <div class="calc" id="nCalc"></div><div class="err" id="nErr"></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Annulla</button><button class="btn primary" type="button" id="nOk">Carica a magazzino</button></div>`);
  const read = () => ({f: $('nF').value, g: $('nG').value, m: ($('nM').value.trim() || $('nG').value).toUpperCase(),
    sp: +$('nSp').value || null, la: +$('nLa').value || null, de: +$('nDe').value || null, di: +$('nDi').value || null, lu: +$('nLu').value || null, pz: parseInt($('nPz').value, 10) || 0});
  const upd = () => {
    const f = $('nF').value;
    modal.querySelectorAll('.nL').forEach(e => e.hidden = f !== 'LASTRA');
    modal.querySelectorAll('.nT').forEach(e => e.hidden = f === 'LASTRA');
    modal.querySelectorAll('.nU').forEach(e => e.hidden = f !== 'TUBO');
    const l = read(), w = w1(l);
    $('nCalc').innerHTML = (w && l.pz) ? `Peso: <b>${nf2.format(w * l.pz)} kg</b> · codice previsto <b class="mono">${nextCode(l.f, l.g)}</b>` : '';
  };
  modal.addEventListener('input', upd, {signal: modalAC.signal}); modal.addEventListener('change', upd, {signal: modalAC.signal}); upd();
  $('nOk').onclick = async () => {
    const l = read(), btn = $('nOk');
    const ok = l.pz > 0 && l.lu > 0 && (l.f === 'LASTRA' ? (l.sp > 0 && l.la > 0) : (l.de > 0 && (l.f !== 'TUBO' || (l.di > 0 && l.di < l.de))));
    if (!ok) { $('nErr').textContent = 'Completa tutte le misure e il numero di pezzi (nel tubo il Ø interno deve essere minore dell\'esterno).'; return; }
    btn.disabled = true; btn.textContent = 'Salvataggio…';
    try {
      const code = await rpc('carica', {
        p_lotto: {forma: l.f, grado: l.g, descrizione: l.m, spessore: l.sp, larghezza: l.la, diam_est: l.de, diam_int: l.di, lunghezza: l.lu, pezzi: l.pz, ubicazione: $('nUb').value.trim()},
        p_commessa: $('nCom').value.trim(), p_operatore: $('nOp').value.trim(), p_note: ''});
      closeModal(); toast(`Caricato ${code} · ${l.m} ${misura(l)}`); refresh('lotti', 'movimenti');
    } catch (e) { $('nErr').textContent = errMsg(e); btn.disabled = false; btn.textContent = 'Carica a magazzino'; }
  };
}

function accountModal() {
  openModal(`
    <h3>Il tuo account</h3>
    <div class="lotcard"><b>${esc(S.prof.nome || S.user.email)}</b><span class="calc">${esc(S.user.email)} · ${S.resp ? 'Responsabile' : 'Operatore'}</span></div>
    <div class="fields"><div class="field wide"><label for="aPwd">Nuova password (almeno 8 caratteri)</label><input id="aPwd" type="password" autocomplete="new-password" minlength="8"></div>
    <button class="btn" type="button" id="aSet">Salva password</button></div>
    <div class="err" id="aErr"></div><div class="ok" id="aOk"></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Chiudi</button><button class="btn danger" type="button" id="aOut">Esci</button></div>`);
  $('aSet').onclick = async () => {
    const p = $('aPwd').value; $('aErr').textContent = ''; $('aOk').textContent = '';
    if (p.length < 8) { $('aErr').textContent = 'La password deve avere almeno 8 caratteri.'; return; }
    const {error} = await S.sb.auth.updateUser({password: p});
    if (error) $('aErr').textContent = errMsg(error); else { $('aOk').textContent = 'Password salvata.'; $('aPwd').value = ''; }
  };
  $('aOut').onclick = async () => { closeModal(); await S.sb.auth.signOut(); };
}

/* ---------------- Excel: scarica magazzino, listino, importa listino ---------------- */
function xlsxReady() { if (typeof window.XLSX === 'undefined') { toast('Libreria Excel non caricata: ricarica la pagina.'); return false; } return true; }
function sheet(rows, widths) { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = widths.map(w => ({wch: w})); return ws; }
async function exportAll() {
  if (!xlsxReady()) return;
  const btn = $('btnExport'); btn.disabled = true; btn.textContent = 'Preparo il file…';
  try {
    const allMovs = (await fetchAll('movimenti', 'creato_il', false)).map(mapMov);
    const wb = XLSX.utils.book_new();
    const r3 = n => n == null ? '' : Math.round(n * 1000) / 1000;
    const head = ['Codice', 'Forma', 'Grado', 'Descrizione', 'Spessore', 'Larghezza', 'Ø est', 'Ø int', 'Lunghezza', 'Misura', 'Pezzi', 'Peso 1 pz (kg)', 'Peso tot (kg)', '€/kg', 'Valore (€)', 'Ubicazione', 'Origine'];
    const rows = [head].concat(S.lots.map(l => [l.c, l.f, l.g, l.m, l.sp ?? '', l.la ?? '', l.de ?? '', l.di ?? '', l.lu ?? '', misura(l), l.pz, r3(w1(l)), r3(wTot(l)), price(l) ?? '', val(l) == null ? '' : Math.round(val(l) * 100) / 100, l.ub, l.o]));
    XLSX.utils.book_append_sheet(wb, sheet(rows, [12, 8, 12, 22, 9, 9, 7, 7, 9, 22, 7, 12, 12, 8, 11, 14, 40]), 'Magazzino');
    const sum = [['Grado', 'Famiglia', 'Lotti', 'Pezzi', 'Peso (kg)', '€/kg', 'Valore (€)']];
    S.mats.forEach(m => { const ls = S.lots.filter(l => l.g === m.g && l.pz > 0); let kg = 0, eur = 0; ls.forEach(l => { kg += wTot(l) || 0; eur += val(l) || 0; }); sum.push([m.g, m.fam, ls.length, ls.reduce((a, l) => a + l.pz, 0), Math.round(kg * 10) / 10, m.p ?? '', Math.round(eur)]); });
    XLSX.utils.book_append_sheet(wb, sheet(sum, [14, 12, 8, 8, 11, 8, 12]), 'Riepilogo');
    const mv = [['Data', 'Tipo', 'Codice', 'Descrizione', 'Misura', 'Pezzi', 'Commessa', 'Operatore', 'Note']].concat(allMovs.map(m => [m.d, m.t, m.c, m.m, m.mis, m.n, m.com, m.op, m.note]));
    XLSX.utils.book_append_sheet(wb, sheet(mv, [16, 11, 12, 22, 22, 7, 18, 14, 30]), 'Movimenti');
    XLSX.writeFile(wb, `Almatech_Magazzino_Sfridi_${today()}.xlsx`);
  } catch (e) { toast(errMsg(e)); }
  finally { btn.disabled = false; btn.textContent = 'Scarica Excel'; }
}
function exportTemplate() {
  if (!xlsxReady()) return;
  const wb = XLSX.utils.book_new();
  const rows = [['Grado', 'Famiglia', 'Peso specifico (g/cm³)', '€/kg', 'Note']].concat(S.mats.map(m => [m.g, m.fam, m.d ?? '', m.esempio ? '' : (m.p ?? ''), m.note]));
  XLSX.utils.book_append_sheet(wb, sheet(rows, [16, 12, 22, 10, 50]), 'Listino');
  XLSX.writeFile(wb, 'Almatech_listino_materiali.xlsx');
}
const normG = s => String(s || '').toUpperCase().replace(/[\s\-_.]/g, '');
function readRows(buf, name) {
  const wb = /\.csv$/i.test(name) ? XLSX.read(new TextDecoder().decode(buf), {type: 'string'}) : XLSX.read(buf, {type: 'array'});
  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header: 1, raw: true, defval: ''});
    for (let h = 0; h < Math.min(rows.length, 15); h++) {
      const hdr = rows[h].map(x => String(x).toLowerCase());
      const gi = hdr.findIndex(x => /grado|materiale|materia prima|descrizione|codice/.test(x));
      const pi = hdr.findIndex(x => /€|eur|prezzo|costo/.test(x));
      const di = hdr.findIndex(x => /peso spec|densit|g\/cm/.test(x));
      const fi = hdr.findIndex(x => /famiglia/.test(x));
      if (gi >= 0 && (pi >= 0 || di >= 0)) return {sheet: sn, rows: rows.slice(h + 1).filter(r => String(r[gi]).trim() !== ''), gi, pi, di, fi};
    }
  }
  return null;
}
async function importFile(file) {
  if (!xlsxReady()) return;
  let t;
  try { t = readRows(await file.arrayBuffer(), file.name); } catch (e) { t = null; }
  if (!t) { openModal(`<h3>File non riconosciuto</h3><p class="calc" style="margin:0">Nel file serve una riga di intestazione con una colonna per il materiale (“Grado” o “Materiale”) e almeno una tra “€/kg” (o “Prezzo”, “Costo”) e “Peso specifico”. Il modo più semplice è partire da “Scarica listino”.</p><div class="actions"><button class="btn primary" type="button" data-close>Ho capito</button></div>`); return; }
  const changes = [], adds = [], same = [], bad = [];
  const byNorm = new Map(S.mats.map(m => [normG(m.g), m]));
  t.rows.forEach(r => {
    const g = String(r[t.gi]).trim(), p = t.pi >= 0 ? parseNum(r[t.pi]) : null, d = t.di >= 0 ? parseNum(r[t.di]) : null;
    const m = byNorm.get(normG(g));
    if ((p != null && p < 0) || (d != null && (d <= 0 || d >= 25))) { bad.push(`${g}: valore non valido`); return; }
    if (!m) { if (p != null || d != null) adds.push({g: g.toUpperCase(), fam: t.fi >= 0 && String(r[t.fi]).trim() ? String(r[t.fi]).trim().toUpperCase() : g.toUpperCase().split(/[\s+-]/)[0], p, d}); return; }
    const np = p != null && (m.p !== p || m.esempio) ? p : null, nd = d != null && m.d !== d ? d : null;
    if (np == null && nd == null) same.push(m.g); else changes.push({m, p: np, d: nd});
  });
  const fmt = v => v == null ? '–' : nf2.format(v);
  const rowsHtml = changes.map(c => `<tr><td><b>${esc(c.m.g)}</b></td>
    <td class="r">${c.d != null ? `<span class="old">${fmt(c.m.d)}</span> → <span class="new">${fmt(c.d)}</span>` : fmt(c.m.d)}</td>
    <td class="r">${c.p != null ? `<span class="old">${fmt(c.m.p)}${c.m.esempio ? ' es.' : ''}</span> → <span class="new">${fmt(c.p)}</span>` : fmt(c.m.p)}</td></tr>`).join('');
  const addHtml = adds.map((a, i) => `<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="add-${i}" data-add="${i}"> <span><b>${esc(a.g)}</b> · ${a.d != null ? fmt(a.d) + ' g/cm³' : 'peso specifico mancante'} · ${a.p != null ? fmt(a.p) + ' €/kg' : 'prezzo mancante'}</span></label>`).join('');
  openModal(`
    <h3>Importa listino</h3>
    <p class="calc" style="margin:0">Letto il foglio “${esc(t.sheet)}” di <b>${esc(file.name)}</b>: ${t.rows.length} righe. Controlla le modifiche prima di salvarle.</p>
    ${changes.length ? `<div class="diffbox"><table class="diff"><thead><tr><th>Materiale</th><th class="r">Peso spec. g/cm³</th><th class="r">€/kg</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>` : '<p class="calc" style="margin:0">Nessun prezzo o peso specifico diverso da quelli già salvati.</p>'}
    ${adds.length ? `<div style="display:grid;gap:6px"><b>Materiali nel file che non esistono ancora</b><span class="calc">Spunta quelli da aggiungere all'anagrafica. Gli altri vengono ignorati: controlla che non siano lo stesso materiale scritto in modo diverso.</span>${addHtml}</div>` : ''}
    ${same.length ? `<p class="calc" style="margin:0">${same.length} materiali invariati.</p>` : ''}
    ${bad.length ? `<p class="err" style="margin:0">Ignorate: ${esc(bad.join('; '))}</p>` : ''}
    <div class="err" id="iErr"></div>
    <div class="actions"><button class="btn ghost" type="button" data-close>Annulla</button>${changes.length || adds.length ? `<button class="btn primary" type="button" id="iOk">Applica ${changes.length} modifiche</button>` : ''}</div>`);
  const ok = $('iOk'); if (!ok) return;
  const label = () => { const k = modal.querySelectorAll('[data-add]:checked').length; ok.textContent = `Applica ${changes.length} modifiche` + (k ? ` e aggiungi ${k}` : ''); };
  modal.addEventListener('change', label, {signal: modalAC.signal});
  ok.onclick = async () => {
    ok.disabled = true; ok.textContent = 'Salvataggio…';
    try {
      for (const c of changes) {
        const patch = {}; if (c.p != null) { patch.prezzo_kg = c.p; patch.prezzo_esempio = false; } if (c.d != null) patch.peso_specifico = c.d;
        const {data, error} = await S.sb.from('materiali').update(patch).eq('grado', c.m.g).select('grado');
        if (error) throw error; if (!data.length) throw new Error('permission denied');
      }
      const sel = [...modal.querySelectorAll('[data-add]:checked')].map(x => adds[+x.dataset.add]);
      let ord = S.mats.reduce((a, m) => Math.max(a, m.ord || 0), 0);
      if (sel.length) {
        const {error} = await S.sb.from('materiali').insert(sel.map(a => ({grado: a.g, famiglia: a.fam, peso_specifico: a.d, prezzo_kg: a.p, note: 'aggiunto da import', ordine: ++ord})));
        if (error) throw error;
      }
      closeModal(); toast(`Listino importato: ${changes.length} materiali aggiornati${sel.length ? `, ${sel.length} aggiunti` : ''}`); refresh('materiali');
    } catch (e) { $('iErr').textContent = errMsg(e); ok.disabled = false; label(); }
  };
}

/* ---------------- eventi ---------------- */
$('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  document.querySelectorAll('#tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x === b));
  ['mag', 'mov', 'mat', 'chk', 'usr'].forEach(t => $('p-' + t).hidden = t !== b.dataset.tab);
});
$('formaChips').addEventListener('click', e => {
  const b = e.target.closest('[data-f]'); if (!b) return;
  F.forma = b.dataset.f; document.querySelectorAll('#formaChips .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); renderRows();
});
$('q').addEventListener('input', e => { F.q = e.target.value.trim(); renderRows(); });
$('rows').addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) pickModal(b.dataset.pick); });
$('chkList').addEventListener('click', async e => {
  const b = e.target.closest('[data-ok]'); if (!b) return; const l = S.lots.find(x => x.c === b.dataset.ok); if (!l) return;
  b.disabled = true;
  const {data, error} = await S.sb.from('lotti').update({verificato: !l.ok}).eq('codice', l.c).select('codice');
  if (error || !data.length) { toast(errMsg(error || {message: 'permission denied'})); b.disabled = false; return; }
  refresh('lotti');
});
$('matRows').addEventListener('change', async e => {
  const i = e.target.dataset.mi; if (i == null) return; const m = S.mats[i]; if (!m) return;
  const v = e.target.value === '' ? null : parseFloat(e.target.value);
  const patch = {[e.target.dataset.k]: v}; if (e.target.dataset.k === 'prezzo_kg') patch.prezzo_esempio = false;
  const {data, error} = await S.sb.from('materiali').update(patch).eq('grado', m.g).select('grado');
  if (error || !data.length) toast(errMsg(error || {message: 'permission denied'})); else toast(`${m.g} aggiornato`);
  refresh('materiali');
});
$('usrRows').addEventListener('change', async e => {
  const uid = e.target.dataset.uid; if (!uid) return;
  const {data, error} = await S.sb.from('profili').update({[e.target.dataset.k]: e.target.value.trim()}).eq('id', uid).select('id');
  if (error || !data.length) toast(errMsg(error || {message: 'permission denied'})); else toast('Utente aggiornato');
  refresh('profili');
});
$('usrRows').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const u = S.users.find(x => x.id === b.dataset.act); if (!u) return;
  b.disabled = true;
  const {data, error} = await S.sb.from('profili').update({attivo: !u.attivo}).eq('id', u.id).select('id');
  if (error || !data.length) toast(errMsg(error || {message: 'permission denied'})); else toast(`${u.email} ${u.attivo ? 'disattivato' : 'attivato'}`);
  refresh('profili');
});
$('btnLoad').onclick = loadModal;
$('btnExport').onclick = exportAll;
$('btnTemplate').onclick = exportTemplate;
$('btnAccount').onclick = accountModal;
$('fileImport').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); });
const fF = $('fForma');
fF.onchange = () => {
  const f = fF.value;
  document.querySelectorAll('.dimL').forEach(e => e.hidden = f !== 'LASTRA');
  document.querySelectorAll('.dimT').forEach(e => e.hidden = f === 'LASTRA');
  document.querySelectorAll('.dimU').forEach(e => e.hidden = f !== 'TUBO');
};
$('finder').addEventListener('submit', e => {
  e.preventDefault(); const n = id => +$(id).value || 0;
  F.fit = {forma: fF.value, grado: $('fGrado').value, sp: n('fSp'), la: n('fLa'), de: n('fDe'), di: n('fDi'), lu: n('fLu')};
  $('fClear').hidden = false; renderRows();
});
$('fClear').onclick = () => { F.fit = null; $('fClear').hidden = true; renderRows(); };

/* ---------------- accesso ---------------- */
$('login').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('lEmail').value.trim(), password = $('lPwd').value;
  $('lErr').textContent = ''; $('lOk').textContent = '';
  if (!password) { $('lErr').textContent = 'Inserisci la password, oppure usa il link via email qui sotto.'; return; }
  $('lGo').disabled = true;
  const {error} = await S.sb.auth.signInWithPassword({email, password});
  $('lGo').disabled = false;
  if (error) $('lErr').textContent = errMsg(error);
});
$('lLink').onclick = async () => {
  const email = $('lEmail').value.trim();
  $('lErr').textContent = ''; $('lOk').textContent = '';
  if (!email) { $('lErr').textContent = 'Scrivi prima la tua email.'; $('lEmail').focus(); return; }
  const {error} = await S.sb.auth.signInWithOtp({email, options: {shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname}});
  if (error) $('lErr').textContent = errMsg(error);
  else $('lOk').textContent = 'Ti abbiamo mandato un link: aprilo da questo dispositivo per entrare. Poi da “Account” puoi impostare una password.';
};

function stopLive() {
  if (S.channel) { S.sb.removeChannel(S.channel); S.channel = null; }
  if (S.poll) { clearInterval(S.poll); S.poll = null; }
}
function startLive() {
  stopLive();
  const ch = S.sb.channel('magazzino');
  ['lotti', 'materiali', 'movimenti', 'profili'].forEach(t => ch.on('postgres_changes', {event: '*', schema: 'public', table: t}, () => refresh(t)));
  ch.subscribe(status => {
    if (status === 'SUBSCRIBED') { sync('live', 'Dati condivisi · aggiornati in tempo reale'); if (S.poll) { clearInterval(S.poll); S.poll = null; } }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      sync('busy', 'Aggiornamento automatico in pausa: i dati si ricaricano ogni 30 secondi');
      if (!S.poll) S.poll = setInterval(() => refresh('lotti', 'materiali', 'movimenti', 'profili'), 30000);
    }
  });
  S.channel = ch;
}

async function enter(session) {
  S.user = session.user;
  sync('busy', 'Caricamento del magazzino…');
  const {data: prof, error} = await S.sb.from('profili').select('*').eq('id', S.user.id).maybeSingle();
  if (error) { gate('Errore di collegamento', errMsg(error)); sync('off', 'Non collegato'); return; }
  if (!prof || !prof.attivo) {
    sync('off', 'Accesso in attesa');
    gate('Account in attesa di attivazione', `Sei entrato come ${S.user.email}. Il responsabile del magazzino deve attivare il tuo utente dalla scheda “Utenti”: poi ricarica questa pagina.`,
      `<div class="actions" style="justify-content:flex-start"><button class="btn" type="button" onclick="location.reload()">Ricarica</button><button class="btn ghost" type="button" id="gOut">Esci</button></div>`);
    $('gOut').onclick = () => S.sb.auth.signOut();
    return;
  }
  S.prof = prof; S.resp = prof.ruolo === 'responsabile';
  document.body.classList.toggle('resp', S.resp);
  $('whoName').textContent = prof.nome || S.user.email;
  $('whoRole').textContent = S.resp ? 'responsabile' : 'operatore';
  try {
    await Promise.all([loadLots(), loadMats(), loadMovs(), loadUsers()]);
  } catch (e) { gate('Errore di collegamento', errMsg(e)); sync('off', 'Non collegato'); return; }
  S.loaded = true; show('app'); renderAll(); startLive();
}
function leave() {
  stopLive();
  Object.assign(S, {user: null, prof: null, resp: false, lots: [], mats: [], movs: [], users: [], loaded: false});
  document.body.classList.remove('resp');
  closeModal();
  sync('off', 'Non collegato'); show('login');
}

(async function boot() {
  const C = window.APP_CONFIG || {};
  if (!window.supabase || !C.SUPABASE_URL || /INSERISCI/.test(C.SUPABASE_URL) || !C.SUPABASE_ANON_KEY || /INSERISCI/.test(C.SUPABASE_ANON_KEY)) {
    sync('off', 'Configurazione mancante');
    gate('Configurazione mancante', window.supabase
      ? 'Apri il file config.js e inserisci Project URL e chiave anon del progetto Supabase (vedi README, passo 3).'
      : 'Non riesco a caricare le librerie necessarie. Controlla la connessione e ricarica la pagina.');
    return;
  }
  S.sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  let current; // undefined finché non arriva il primo stato (anche "nessun accesso")
  S.sb.auth.onAuthStateChange((event, session) => {
    const uid = session && session.user ? session.user.id : null;
    if (uid === current) return;
    current = uid;
    if (uid) setTimeout(() => enter(session), 0); else leave();
  });
})();
