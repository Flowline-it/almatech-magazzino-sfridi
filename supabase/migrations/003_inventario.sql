-- =====================================================================
-- Modulo Inventario — tabelle e permessi (Supabase / PostgreSQL)
--
-- NON ANCORA ATTIVATO: da eseguire nel SQL Editor solo dopo l'ok di Almatech,
-- DOPO 001_schema.sql (usa le sue funzioni utente_attivo() e is_responsabile()).
--
-- Chi può fare cosa:
--  - responsabile: importa l'export di G7, chiude, elimina, scarica il file per G7
--  - tutti gli utenti attivi: contano gli articoli e fanno segnalazioni, finché l'inventario è aperto
--  - a inventario chiuso nessuno può più cambiare conteggi e segnalazioni
-- =====================================================================

-- 1. Sessioni d'inventario (una per ogni export G7 importato)
create table public.inventari (
  id             uuid primary key default gen_random_uuid(),
  nome_file      text not null,
  creato_il      timestamptz not null default now(),
  creato_da      uuid default auth.uid() references auth.users (id) on delete set null,
  creato_da_nome text not null default '',
  stato          text not null default 'aperto' check (stato in ('aperto', 'chiuso')),
  chiuso_il      timestamptz,
  chiuso_da_nome text,
  n_righe        integer not null default 0,
  riepilogo      jsonb
);

-- 2. Righe articolo: una per ogni riga articolo del file G7.
--    n = numero di riga nel foglio Excel (serve a riscrivere la colonna Esistenza).
--    La chiave "vera" dell'articolo è codice + deposito (+ ubicazione se piena).
create table public.inventario_righe (
  inventario_id uuid not null references public.inventari (id) on delete cascade,
  n             integer not null,
  codice        text not null,            -- con gli spazi finali, come in G7
  descrizione   text not null default '',
  um            text not null default '',
  esistenza     numeric not null default 0,  -- giacenza di G7
  ubicazione    text not null default '',
  obsoleto      boolean not null default false,
  deposito      text not null default '',
  gruppo        text not null default '',
  stato         text not null default 'da' check (stato in ('da', 'ok', 'diff', 'nt')),
  contato       numeric,
  contato_da    text not null default '',
  contato_il    timestamptz,
  primary key (inventario_id, n)
);
create index inventario_righe_modificate on public.inventario_righe (inventario_id, contato_il);

-- 3. Articoli trovati in magazzino ma non presenti in G7 (solo segnalazioni)
create table public.inventario_segnalazioni (
  id            uuid primary key default gen_random_uuid(),
  inventario_id uuid not null references public.inventari (id) on delete cascade,
  codice        text not null default '',
  descrizione   text not null,
  quantita      numeric,
  um            text not null default '',
  deposito      text not null default '',
  nota          text not null default '',
  segnalato_da  text not null default '',
  creato_il     timestamptz not null default now()
);

-- 4. Elenco con il numero di articoli contati
create view public.inventari_conteggio with (security_invoker = true) as
select i.*, (select count(*) from public.inventario_righe r where r.inventario_id = i.id and r.stato <> 'da')::integer as contate
from public.inventari i;

-- 5. Dopo la chiusura niente più modifiche
create or replace function public.inventario_aperto(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.inventari where id = p_id and stato = 'aperto');
$$;

-- 6. Permessi
alter table public.inventari               enable row level security;
alter table public.inventario_righe        enable row level security;
alter table public.inventario_segnalazioni enable row level security;

create policy inventari_lettura on public.inventari for select to authenticated using (public.utente_attivo());
create policy inventari_inserimento on public.inventari for insert to authenticated with check (public.is_responsabile());
create policy inventari_chiusura on public.inventari for update to authenticated
  using (public.is_responsabile() and stato = 'aperto') with check (public.is_responsabile());
create policy inventari_elimina on public.inventari for delete to authenticated using (public.is_responsabile());

create policy righe_lettura on public.inventario_righe for select to authenticated using (public.utente_attivo());
create policy righe_inserimento on public.inventario_righe for insert to authenticated with check (public.is_responsabile());
create policy righe_conteggio on public.inventario_righe for update to authenticated
  using (public.utente_attivo() and public.inventario_aperto(inventario_id))
  with check (public.utente_attivo() and public.inventario_aperto(inventario_id));

create policy segn_lettura on public.inventario_segnalazioni for select to authenticated using (public.utente_attivo());
create policy segn_inserimento on public.inventario_segnalazioni for insert to authenticated
  with check (public.utente_attivo() and public.inventario_aperto(inventario_id));

-- Si possono cambiare solo i campi del conteggio e della chiusura, mai la giacenza di G7.
revoke update on public.inventario_righe from authenticated;
grant update (stato, contato, contato_da, contato_il) on public.inventario_righe to authenticated;
revoke update on public.inventari from authenticated;
grant update (stato, chiuso_il, chiuso_da_nome) on public.inventari to authenticated;

revoke all on public.inventari, public.inventario_righe, public.inventario_segnalazioni, public.inventari_conteggio from anon;
grant select, insert, delete on public.inventari to authenticated;
grant select, insert on public.inventario_righe, public.inventario_segnalazioni to authenticated;
grant select on public.inventari_conteggio to authenticated;
grant delete on public.inventario_righe to authenticated;
create policy righe_elimina on public.inventario_righe for delete to authenticated using (public.is_responsabile());

-- 7. File Excel originale di G7 (serve per riscrivere l'export): archivio privato, solo responsabile
insert into storage.buckets (id, name, public) values ('inventari', 'inventari', false) on conflict (id) do nothing;
create policy inventari_file_lettura on storage.objects for select to authenticated
  using (bucket_id = 'inventari' and public.is_responsabile());
create policy inventari_file_scrittura on storage.objects for insert to authenticated
  with check (bucket_id = 'inventari' and public.is_responsabile());
create policy inventari_file_elimina on storage.objects for delete to authenticated
  using (bucket_id = 'inventari' and public.is_responsabile());
