/* =====================================================================
 * Inventario — dove vengono salvati i dati.
 *
 * Due versioni con le stesse funzioni, così il resto dell'app non sa quale usa:
 *  - demo:     archivio del browser (IndexedDB), solo su questo dispositivo.
 *              Non usiamo localStorage perché 12.000 righe non ci stanno.
 *  - supabase: database condiviso (tabelle inventari, inventario_righe,
 *              inventario_segnalazioni, vedi supabase/migrations/003_inventario.sql)
 *              e il file originale nel Storage.
 *
 * Stati di una riga: 'da' (da verificare) · 'ok' · 'diff' (diverso) · 'nt' (non trovato).
 * ===================================================================== */
(function (root) {
  'use strict';
  const uid = () => (root.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  /* ------------------------------ demo (IndexedDB) ------------------------------ */
  function demoStore() {
    const DBN = 'almatech-inventario-demo-v1';
    let dbp = null;
    const open = () => dbp || (dbp = new Promise((ok, ko) => {
      if (!root.indexedDB) return ko(new Error('Questo browser non permette di salvare i dati dell\'inventario (archivio non disponibile).'));
      const rq = indexedDB.open(DBN, 1);
      rq.onupgradeneeded = () => {
        const d = rq.result;
        d.createObjectStore('sessioni', {keyPath: 'id'});
        d.createObjectStore('righe', {keyPath: ['sid', 'n']}).createIndex('sid', 'sid');
        d.createObjectStore('file');
        d.createObjectStore('segn', {keyPath: 'id'}).createIndex('sid', 'sid');
      };
      rq.onsuccess = () => ok(rq.result); rq.onerror = () => ko(rq.error);
    }));
    const req = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const fine = t => new Promise((ok, ko) => { t.oncomplete = ok; t.onerror = () => ko(t.error); t.onabort = () => ko(t.error); });
    const tx = async (stores, mode = 'readonly') => (await open()).transaction(stores, mode);

    return {
      nome: 'demo',
      async elenco() {
        const t = await tx(['sessioni']); const l = await req(t.objectStore('sessioni').getAll());
        return l.sort((a, b) => b.creato_il.localeCompare(a.creato_il));
      },
      async crea(meta, righe, buf) {
        const id = uid();
        const t = await tx(['sessioni', 'righe', 'file'], 'readwrite');
        t.objectStore('sessioni').put({id, ...meta, stato: 'aperto', creato_il: new Date().toISOString(), n_righe: righe.length, contate: 0});
        const rs = t.objectStore('righe');
        for (const r of righe) rs.put({sid: id, ...r, st: 'da', q: null, by: '', at: ''});
        t.objectStore('file').put(buf, id);
        await fine(t); return id;
      },
      async righe(id) {
        const t = await tx(['righe']); return req(t.objectStore('righe').index('sid').getAll(id));
      },
      /* salva il conteggio di una riga; restituisce com'era prima (per avvisare) */
      async conta(id, n, patch) {
        const t = await tx(['righe', 'sessioni'], 'readwrite');
        const rs = t.objectStore('righe'), ss = t.objectStore('sessioni');
        const s = await req(ss.get(id)); if (!s || s.stato !== 'aperto') { t.abort(); throw new Error('Inventario chiuso: non si può più modificare.'); }
        const prima = await req(rs.get([id, n]));
        const dopo = {...prima, ...patch}; rs.put(dopo);
        s.contate = (s.contate || 0) + ((dopo.st !== 'da' ? 1 : 0) - (prima.st !== 'da' ? 1 : 0)); ss.put(s);
        await fine(t); return prima;
      },
      async modificate() { return []; }, // un solo dispositivo: nessuno cambia i dati da fuori
      async segnalazioni(id) { const t = await tx(['segn']); return req(t.objectStore('segn').index('sid').getAll(id)); },
      async aggiungiSegn(id, s) {
        const t = await tx(['segn', 'sessioni'], 'readwrite');
        const x = await req(t.objectStore('sessioni').get(id)); if (!x || x.stato !== 'aperto') { t.abort(); throw new Error('Inventario chiuso: non si può più modificare.'); }
        const r = {id: uid(), sid: id, ...s, at: new Date().toISOString()}; t.objectStore('segn').put(r); await fine(t); return r;
      },
      async chiudi(id, chi) {
        const t = await tx(['sessioni'], 'readwrite'); const st = t.objectStore('sessioni');
        const s = await req(st.get(id)); if (s.stato === 'chiuso') return s;
        s.stato = 'chiuso'; s.chiuso_il = new Date().toISOString(); s.chiuso_da = chi; st.put(s); await fine(t); return s;
      },
      async file(id) { const t = await tx(['file']); return req(t.objectStore('file').get(id)); },
      async elimina(id) {
        const t = await tx(['sessioni', 'righe', 'file', 'segn'], 'readwrite');
        t.objectStore('sessioni').delete(id); t.objectStore('file').delete(id);
        for (const [nome, st] of [['righe', t.objectStore('righe')], ['segn', t.objectStore('segn')]]) {
          const keys = await req(st.index('sid').getAllKeys(id)); keys.forEach(k => st.delete(k));
        }
        await fine(t);
      },
    };
  }

  /* ------------------------------ Supabase ------------------------------ */
  function supabaseStore(sb) {
    const BUCKET = 'inventari';
    const PAGINA = 1000;
    const fail = e => { if (e) throw e; };
    const daDb = r => ({n: r.n, c: r.codice, d: r.descrizione, um: r.um, g7: Number(r.esistenza), ub: r.ubicazione, ob: r.obsoleto, dep: r.deposito, gr: r.gruppo,
      st: r.stato, q: r.contato == null ? null : Number(r.contato), by: r.contato_da || '', at: r.contato_il || ''});
    const aDb = (id, r) => ({inventario_id: id, n: r.n, codice: r.c, descrizione: r.d, um: r.um, esistenza: r.g7, ubicazione: r.ub, obsoleto: r.ob, deposito: r.dep, gruppo: r.gr, stato: 'da'});
    const sessione = r => ({id: r.id, nome_file: r.nome_file, creato_da: r.creato_da_nome, creato_il: r.creato_il, stato: r.stato, n_righe: r.n_righe,
      contate: r.contate ?? 0, chiuso_il: r.chiuso_il, chiuso_da: r.chiuso_da_nome, riepilogo: r.riepilogo});

    async function tutte(id, since) {
      const out = [];
      for (let from = 0; ; from += PAGINA) {
        let q = sb.from('inventario_righe').select('*').eq('inventario_id', id);
        if (since) q = q.gt('contato_il', since);
        const {data, error} = await q.order('n').range(from, from + PAGINA - 1); fail(error);
        out.push(...data); if (data.length < PAGINA) return out.map(daDb);
      }
    }
    return {
      nome: 'supabase',
      async elenco() {
        // le righe contate si leggono dalla vista inventari_conteggio (vedi migrazione)
        const {data, error} = await sb.from('inventari_conteggio').select('*').order('creato_il', {ascending: false}); fail(error);
        return data.map(sessione);
      },
      async crea(meta, righe, buf, chi) {
        const {data, error} = await sb.from('inventari').insert({nome_file: meta.nome_file, creato_da_nome: meta.creato_da, n_righe: righe.length, riepilogo: meta.riepilogo || null}).select().single(); fail(error);
        const id = data.id;
        try {
          for (let i = 0; i < righe.length; i += 1000) {
            const {error: e2} = await sb.from('inventario_righe').insert(righe.slice(i, i + 1000).map(r => aDb(id, r))); fail(e2);
          }
          const {error: e3} = await sb.storage.from(BUCKET).upload(id + '.xlsx', buf, {contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); fail(e3);
        } catch (e) { await sb.from('inventari').delete().eq('id', id); throw e; }
        return id;
      },
      righe: id => tutte(id),
      async conta(id, n, patch) {
        const {data: prima, error} = await sb.from('inventario_righe').select('*').eq('inventario_id', id).eq('n', n).single(); fail(error);
        const {error: e2} = await sb.from('inventario_righe').update({stato: patch.st, contato: patch.q, contato_da: patch.by, contato_il: patch.at || null}).eq('inventario_id', id).eq('n', n); fail(e2);
        return daDb(prima);
      },
      async modificate(id, since) { return since ? tutte(id, since) : []; },
      async segnalazioni(id) {
        const {data, error} = await sb.from('inventario_segnalazioni').select('*').eq('inventario_id', id).order('creato_il'); fail(error);
        return data.map(r => ({id: r.id, sid: id, c: r.codice, d: r.descrizione, q: r.quantita == null ? null : Number(r.quantita), um: r.um, dep: r.deposito, nota: r.nota, by: r.segnalato_da, at: r.creato_il}));
      },
      async aggiungiSegn(id, s) {
        const {data, error} = await sb.from('inventario_segnalazioni').insert({inventario_id: id, codice: s.c, descrizione: s.d, quantita: s.q, um: s.um, deposito: s.dep, nota: s.nota, segnalato_da: s.by}).select().single(); fail(error);
        return {id: data.id, sid: id, ...s, at: data.creato_il};
      },
      async chiudi(id, chi) {
        const {data, error} = await sb.from('inventari').update({stato: 'chiuso', chiuso_il: new Date().toISOString(), chiuso_da_nome: chi}).eq('id', id).select().single(); fail(error);
        return sessione(data);
      },
      async file(id) {
        const {data, error} = await sb.storage.from(BUCKET).download(id + '.xlsx'); fail(error);
        return data.arrayBuffer();
      },
      async elimina(id) {
        await sb.storage.from(BUCKET).remove([id + '.xlsx']);
        const {error} = await sb.from('inventari').delete().eq('id', id); fail(error);
      },
    };
  }

  root.InvStore = {demo: demoStore, supabase: supabaseStore};
})(window);
