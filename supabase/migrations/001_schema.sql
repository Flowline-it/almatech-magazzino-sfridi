-- =====================================================================
-- Magazzino sfridi Almatech — schema database (Supabase / PostgreSQL)
--
-- Da eseguire UNA VOLTA nel SQL Editor di Supabase, su un progetto nuovo.
-- Crea: tabelle, permessi per ruolo (operatore / responsabile),
-- funzioni per prelievi, carichi e rettifiche, aggiornamenti in tempo reale.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profili utente
--    Ogni utente creato in Authentication riceve un profilo.
--    I nuovi profili nascono DISATTIVATI: li attiva il responsabile
--    dalla scheda "Utenti" della web app.
-- ---------------------------------------------------------------------
create table public.profili (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null default '',
  nome       text not null default '',
  ruolo      text not null default 'operatore' check (ruolo in ('operatore', 'responsabile')),
  attivo     boolean not null default false,
  creato_il  timestamptz not null default now()
);

create or replace function public.gestisci_nuovo_utente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profili (id, email, nome)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger su_nuovo_utente
  after insert on auth.users
  for each row execute function public.gestisci_nuovo_utente();

create or replace function public.utente_attivo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profili where id = auth.uid() and attivo);
$$;

create or replace function public.is_responsabile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profili where id = auth.uid() and attivo and ruolo = 'responsabile');
$$;

-- ---------------------------------------------------------------------
-- 2. Materiali (gradi) con peso specifico e prezzo
-- ---------------------------------------------------------------------
create table public.materiali (
  grado           text primary key,
  famiglia        text not null,
  peso_specifico  numeric(6, 3) check (peso_specifico is null or (peso_specifico > 0 and peso_specifico < 25)),
  prezzo_kg       numeric(10, 2) check (prezzo_kg is null or prezzo_kg >= 0),
  prezzo_esempio  boolean not null default false,
  note            text not null default '',
  ordine          integer not null default 0,
  aggiornato_il   timestamptz not null default now()
);

create or replace function public.tocca_aggiornato_il()
returns trigger
language plpgsql
as $$
begin
  new.aggiornato_il := now();
  return new;
end
$$;

create trigger materiali_aggiornato_il
  before update on public.materiali
  for each row execute function public.tocca_aggiornato_il();

-- ---------------------------------------------------------------------
-- 3. Lotti di sfrido
--    Misure in mm. Lastra: spessore × larghezza × lunghezza.
--    Tondo: Ø esterno + lunghezza. Tubo: Ø esterno, Ø interno, lunghezza.
-- ---------------------------------------------------------------------
create table public.lotti (
  codice        text primary key,
  forma         text not null check (forma in ('LASTRA', 'TONDO', 'TUBO')),
  grado         text not null references public.materiali (grado) on update cascade,
  descrizione   text not null,
  spessore      numeric,
  larghezza     numeric,
  diam_est      numeric,
  diam_int      numeric,
  lunghezza     numeric not null check (lunghezza > 0),
  pezzi         integer not null default 0 check (pezzi >= 0),
  ubicazione    text not null default '',
  segnalazioni  text[] not null default '{}',
  verificato    boolean not null default false,
  origine       text not null default '',
  creato_il     timestamptz not null default now(),
  constraint misure_lastra check (forma <> 'LASTRA' or (spessore > 0 and larghezza > 0)),
  constraint misure_tondo  check (forma = 'LASTRA' or diam_est > 0),
  constraint misure_tubo   check (forma <> 'TUBO' or (diam_int > 0 and diam_int < diam_est))
);

create index lotti_grado_idx on public.lotti (grado);

-- ---------------------------------------------------------------------
-- 4. Movimenti (storico). Pezzi con segno: prelievo negativo.
-- ---------------------------------------------------------------------
create table public.movimenti (
  id           bigint generated always as identity primary key,
  creato_il    timestamptz not null default now(),
  tipo         text not null check (tipo in ('PRELIEVO', 'CARICO', 'RETTIFICA')),
  codice       text not null references public.lotti (codice) on update cascade,
  descrizione  text not null default '',
  misura       text not null default '',
  pezzi        integer not null,
  commessa     text not null default '',
  operatore    text not null default '',
  note         text not null default '',
  utente       uuid references auth.users (id) on delete set null
);

create index movimenti_creato_il_idx on public.movimenti (creato_il desc);
create index movimenti_codice_idx on public.movimenti (codice);

-- ---------------------------------------------------------------------
-- 5. Funzioni di supporto
-- ---------------------------------------------------------------------
create or replace function public.fmt_mm(v numeric)
returns text
language sql
immutable
as $$
  select replace(trim(trailing '.' from trim(trailing '0' from round(v, 2)::text)), '.', ',');
$$;

create or replace function public.formato_misura(
  p_forma text, p_spessore numeric, p_larghezza numeric,
  p_diam_est numeric, p_diam_int numeric, p_lunghezza numeric)
returns text
language sql
immutable
as $$
  select case
    when p_forma = 'LASTRA' then
      public.fmt_mm(p_spessore) || ' × ' || public.fmt_mm(p_larghezza) || ' × ' || public.fmt_mm(p_lunghezza)
    else
      'Ø' || public.fmt_mm(p_diam_est)
      || coalesce('/' || public.fmt_mm(p_diam_int), '')
      || ' · L ' || public.fmt_mm(p_lunghezza)
  end;
$$;

-- Volume in mm³ (lastra, tondo pieno o tubo)
create or replace function public.volume_mm3(
  p_forma text, p_spessore numeric, p_larghezza numeric,
  p_diam_est numeric, p_diam_int numeric, p_lunghezza numeric)
returns numeric
language sql
immutable
as $$
  select case
    when p_forma = 'LASTRA' then p_spessore * p_larghezza * p_lunghezza
    else pi()::numeric / 4 * (p_diam_est ^ 2 - coalesce(p_diam_int, 0) ^ 2) * p_lunghezza
  end;
$$;

-- Codice nuovo lotto: LA/TO/TU - prime 4 lettere della famiglia - progressivo.
-- Il blocco consultivo evita codici doppi se due persone caricano insieme.
create or replace function public.nuovo_codice(p_forma text, p_grado text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pre text;
  v_n   integer;
begin
  select case p_forma when 'LASTRA' then 'LA' when 'TONDO' then 'TO' when 'TUBO' then 'TU' end
         || '-' || left(regexp_replace(upper(famiglia), '[^A-Z0-9]', '', 'g'), 4) || '-'
    into v_pre
    from materiali
   where grado = p_grado;

  if v_pre is null then
    raise exception 'Materiale "%" non trovato o forma non valida', p_grado;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_pre));

  select coalesce(max(substring(codice from length(v_pre) + 1)::integer), 0) + 1
    into v_n
    from lotti
   where left(codice, length(v_pre)) = v_pre
     and substring(codice from length(v_pre) + 1) ~ '^[0-9]+$';

  return v_pre || lpad(v_n::text, 3, '0');
end
$$;

-- ---------------------------------------------------------------------
-- 6. Operazioni di magazzino (le uniche vie per cambiare i pezzi)
-- ---------------------------------------------------------------------

-- Prelievo di pezzi interi, oppure di 1 pezzo con avanzo che rientra.
-- p_avanzo: null, oppure {"larghezza": .., "lunghezza": ..} per le lastre,
--           {"lunghezza": ..} per tondi e tubi.
create or replace function public.preleva(
  p_codice    text,
  p_pezzi     integer,
  p_commessa  text default '',
  p_operatore text default '',
  p_note      text default '',
  p_avanzo    jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  l        lotti;
  v_mis    text;
  v_nuovo  text;
  v_la     numeric;
  v_lu     numeric;
begin
  if not utente_attivo() then
    raise exception 'Il tuo utente non è attivo: chiedi al responsabile di attivarlo.' using errcode = '42501';
  end if;
  if p_pezzi is null or p_pezzi < 1 then
    raise exception 'Inserisci almeno 1 pezzo.';
  end if;

  select * into l from lotti where codice = p_codice for update;
  if not found then
    raise exception 'Il lotto % non esiste.', p_codice;
  end if;
  if l.pezzi < p_pezzi then
    raise exception 'A magazzino ci sono solo % % di %.', l.pezzi, case when l.pezzi = 1 then 'pezzo' else 'pezzi' end, p_codice;
  end if;

  v_mis := formato_misura(l.forma, l.spessore, l.larghezza, l.diam_est, l.diam_int, l.lunghezza);

  update lotti set pezzi = pezzi - p_pezzi where codice = p_codice;

  insert into movimenti (tipo, codice, descrizione, misura, pezzi, commessa, operatore, note, utente)
  values ('PRELIEVO', l.codice, l.descrizione, v_mis, -p_pezzi,
          coalesce(p_commessa, ''), coalesce(p_operatore, ''),
          coalesce(nullif(p_note, ''), case when p_avanzo is not null then 'taglio' else '' end),
          auth.uid());

  if p_avanzo is not null and p_avanzo <> 'null'::jsonb then
    if p_pezzi <> 1 then
      raise exception 'Il taglio con avanzo si registra un pezzo alla volta.';
    end if;

    v_lu := (p_avanzo ->> 'lunghezza')::numeric;
    v_la := case when l.forma = 'LASTRA' then (p_avanzo ->> 'larghezza')::numeric else l.larghezza end;

    if v_lu is null or v_lu <= 0 or (l.forma = 'LASTRA' and (v_la is null or v_la <= 0)) then
      raise exception 'Misura dell''avanzo non valida.';
    end if;
    if l.forma = 'LASTRA' and v_la * v_lu >= l.larghezza * l.lunghezza then
      raise exception 'L''avanzo deve essere più piccolo della lastra di partenza.';
    end if;
    if l.forma <> 'LASTRA' and v_lu >= l.lunghezza then
      raise exception 'L''avanzo deve essere più corto della barra di partenza.';
    end if;

    v_nuovo := nuovo_codice(l.forma, l.grado);

    insert into lotti (codice, forma, grado, descrizione, spessore, larghezza, diam_est, diam_int,
                       lunghezza, pezzi, ubicazione, origine)
    values (v_nuovo, l.forma, l.grado, l.descrizione, l.spessore, v_la, l.diam_est, l.diam_int,
            v_lu, 1, l.ubicazione, 'avanzo di ' || l.codice || ' (' || v_mis || ')');

    insert into movimenti (tipo, codice, descrizione, misura, pezzi, commessa, operatore, note, utente)
    values ('CARICO', v_nuovo, l.descrizione,
            formato_misura(l.forma, l.spessore, v_la, l.diam_est, l.diam_int, v_lu), 1,
            coalesce(p_commessa, ''), coalesce(p_operatore, ''), 'avanzo di ' || l.codice, auth.uid());
  end if;

  return jsonb_build_object('codice', l.codice, 'pezzi_rimasti', l.pezzi - p_pezzi, 'avanzo', v_nuovo);
end
$$;

-- Carico di un nuovo sfrido. p_lotto: {forma, grado, descrizione, spessore,
-- larghezza, diam_est, diam_int, lunghezza, pezzi, ubicazione}
create or replace function public.carica(
  p_lotto     jsonb,
  p_commessa  text default '',
  p_operatore text default '',
  p_note      text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forma  text    := upper(p_lotto ->> 'forma');
  v_grado  text    := p_lotto ->> 'grado';
  v_pezzi  integer := (p_lotto ->> 'pezzi')::integer;
  v_codice text;
  r        lotti;
begin
  if not utente_attivo() then
    raise exception 'Il tuo utente non è attivo: chiedi al responsabile di attivarlo.' using errcode = '42501';
  end if;
  if v_pezzi is null or v_pezzi < 1 then
    raise exception 'Inserisci almeno 1 pezzo.';
  end if;

  if v_forma is null or v_forma not in ('LASTRA', 'TONDO', 'TUBO') then
    raise exception 'Forma non valida: scegli lastra, tondo o tubo.';
  end if;
  if coalesce((p_lotto ->> 'lunghezza')::numeric, 0) <= 0
     or (v_forma = 'LASTRA' and (coalesce((p_lotto ->> 'spessore')::numeric, 0) <= 0
                                 or coalesce((p_lotto ->> 'larghezza')::numeric, 0) <= 0))
     or (v_forma <> 'LASTRA' and coalesce((p_lotto ->> 'diam_est')::numeric, 0) <= 0)
     or (v_forma = 'TUBO' and (coalesce((p_lotto ->> 'diam_int')::numeric, 0) <= 0
                               or (p_lotto ->> 'diam_int')::numeric >= (p_lotto ->> 'diam_est')::numeric)) then
    raise exception 'Misure non valide: completa tutte le misure (nel tubo il Ø interno deve essere minore dell''esterno).';
  end if;

  v_codice := nuovo_codice(v_forma, v_grado);

  insert into lotti (codice, forma, grado, descrizione, spessore, larghezza, diam_est, diam_int,
                     lunghezza, pezzi, ubicazione, origine)
  values (
    v_codice, v_forma, v_grado,
    upper(coalesce(nullif(trim(p_lotto ->> 'descrizione'), ''), v_grado)),
    case when v_forma = 'LASTRA' then (p_lotto ->> 'spessore')::numeric end,
    case when v_forma = 'LASTRA' then (p_lotto ->> 'larghezza')::numeric end,
    case when v_forma <> 'LASTRA' then (p_lotto ->> 'diam_est')::numeric end,
    case when v_forma = 'TUBO' then (p_lotto ->> 'diam_int')::numeric end,
    (p_lotto ->> 'lunghezza')::numeric,
    v_pezzi,
    coalesce(trim(p_lotto ->> 'ubicazione'), ''),
    'caricato a mano'
  )
  returning * into r;

  insert into movimenti (tipo, codice, descrizione, misura, pezzi, commessa, operatore, note, utente)
  values ('CARICO', r.codice, r.descrizione,
          formato_misura(r.forma, r.spessore, r.larghezza, r.diam_est, r.diam_int, r.lunghezza),
          v_pezzi, coalesce(p_commessa, ''), coalesce(p_operatore, ''), coalesce(p_note, ''), auth.uid());

  return v_codice;
end
$$;

-- Correzione dopo un conteggio fisico: imposta i pezzi contati
-- e registra la differenza come RETTIFICA.
create or replace function public.rettifica(
  p_codice         text,
  p_pezzi_contati  integer,
  p_ubicazione     text default null,
  p_commessa       text default '',
  p_operatore      text default '',
  p_note           text default '')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l       lotti;
  v_diff  integer;
begin
  if not utente_attivo() then
    raise exception 'Il tuo utente non è attivo: chiedi al responsabile di attivarlo.' using errcode = '42501';
  end if;
  if p_pezzi_contati is null or p_pezzi_contati < 0 then
    raise exception 'Inserisci un numero di pezzi valido (0 o più).';
  end if;

  select * into l from lotti where codice = p_codice for update;
  if not found then
    raise exception 'Il lotto % non esiste.', p_codice;
  end if;

  v_diff := p_pezzi_contati - l.pezzi;

  update lotti
     set pezzi = p_pezzi_contati,
         ubicazione = coalesce(trim(p_ubicazione), ubicazione)
   where codice = p_codice;

  if v_diff <> 0 then
    insert into movimenti (tipo, codice, descrizione, misura, pezzi, commessa, operatore, note, utente)
    values ('RETTIFICA', l.codice, l.descrizione,
            formato_misura(l.forma, l.spessore, l.larghezza, l.diam_est, l.diam_int, l.lunghezza),
            v_diff, coalesce(p_commessa, ''), coalesce(p_operatore, ''),
            coalesce(nullif(p_note, ''), 'conteggio: ' || p_pezzi_contati || ' pz'), auth.uid());
  end if;

  return v_diff;
end
$$;

-- ---------------------------------------------------------------------
-- 7. Vista per analisi e report (peso e valore calcolati)
-- ---------------------------------------------------------------------
create or replace view public.v_magazzino
with (security_invoker = true)
as
select
  l.codice, l.forma, l.grado, m.famiglia, l.descrizione,
  formato_misura(l.forma, l.spessore, l.larghezza, l.diam_est, l.diam_int, l.lunghezza) as misura,
  l.pezzi, l.ubicazione,
  round(public.volume_mm3(l.forma, l.spessore, l.larghezza, l.diam_est, l.diam_int, l.lunghezza)
        / 1e6 * m.peso_specifico * l.pezzi, 3) as peso_kg,
  m.prezzo_kg,
  round(public.volume_mm3(l.forma, l.spessore, l.larghezza, l.diam_est, l.diam_int, l.lunghezza)
        / 1e6 * m.peso_specifico * l.pezzi * m.prezzo_kg, 2) as valore_eur
from public.lotti l
join public.materiali m on m.grado = l.grado;

-- ---------------------------------------------------------------------
-- 8. Permessi (Row Level Security)
--    Tutti gli utenti attivi leggono. I pezzi cambiano solo con le
--    funzioni sopra. Prezzi, verifiche e utenti: solo responsabile.
-- ---------------------------------------------------------------------
alter table public.profili   enable row level security;
alter table public.materiali enable row level security;
alter table public.lotti     enable row level security;
alter table public.movimenti enable row level security;

create policy profili_lettura on public.profili
  for select to authenticated
  using (id = auth.uid() or public.utente_attivo());

create policy profili_modifica on public.profili
  for update to authenticated
  using (public.is_responsabile())
  with check (public.is_responsabile());

create policy materiali_lettura on public.materiali
  for select to authenticated
  using (public.utente_attivo());

create policy materiali_inserimento on public.materiali
  for insert to authenticated
  with check (public.is_responsabile());

create policy materiali_modifica on public.materiali
  for update to authenticated
  using (public.is_responsabile())
  with check (public.is_responsabile());

create policy lotti_lettura on public.lotti
  for select to authenticated
  using (public.utente_attivo());

create policy lotti_modifica on public.lotti
  for update to authenticated
  using (public.is_responsabile())
  with check (public.is_responsabile());

create policy movimenti_lettura on public.movimenti
  for select to authenticated
  using (public.utente_attivo());

-- Il responsabile può correggere descrizione, ubicazione e verifica,
-- ma i pezzi cambiano solo da prelievo, carico e rettifica.
revoke update on public.lotti from authenticated;
grant update (descrizione, ubicazione, verificato, segnalazioni) on public.lotti to authenticated;

revoke update on public.profili from authenticated;
grant update (nome, ruolo, attivo) on public.profili to authenticated;

-- Nessun accesso per chi non ha fatto login.
revoke all on public.profili, public.materiali, public.lotti, public.movimenti, public.v_magazzino from anon;

-- Funzioni: eseguibili solo da utenti autenticati.
revoke execute on function public.preleva(text, integer, text, text, text, jsonb) from public, anon;
revoke execute on function public.carica(jsonb, text, text, text) from public, anon;
revoke execute on function public.rettifica(text, integer, text, text, text, text) from public, anon;
revoke execute on function public.nuovo_codice(text, text) from public, anon, authenticated;
grant execute on function public.preleva(text, integer, text, text, text, jsonb) to authenticated;
grant execute on function public.carica(jsonb, text, text, text) to authenticated;
grant execute on function public.rettifica(text, integer, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 9. Aggiornamenti in tempo reale per la web app
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.lotti, public.materiali, public.movimenti, public.profili;
