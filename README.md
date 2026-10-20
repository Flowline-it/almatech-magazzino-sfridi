# Magazzino sfridi Almatech

Web app per gestire il magazzino degli sfridi (lastre, tondi e tubi in plastica e metallo) di **Almatech srl**.
Sostituisce i 25 file Excel “INVENTARIO SEMILAVORATI PLASTICI-METALLICI” con un unico archivio.

Realizzata da **Flowline**.

> **Stato attuale: modalità dimostrazione.** L'app funziona senza server: parte dall'inventario reale al 13/10/2026 e le prove restano nel browser di chi la usa. Il collegamento al database (Supabase) è già pronto nel codice e si attiva solo dopo l'ok di Almatech.

## Provare la demo

**Sul proprio computer, senza installare nulla**
1. Su GitHub: **Code** → **Download ZIP**, poi estrai la cartella.
2. Apri `index.html` con Chrome, Edge o Safari.
3. Si entra già come **Responsabile**. Con i pulsanti in alto si passa alla vista **Operatore**.

Serve la connessione a internet (caratteri e libreria Excel arrivano da CDN).

**Con un indirizzo da mandare al cliente**
- **Netlify** (gratuito): *Add new project* → *Deploy manually* → trascina la cartella. Oppure collega il repository GitHub: build command vuoto, publish directory `.`.
- **GitHub Pages**: su un repository privato richiede un piano GitHub a pagamento.

Chi apre il link vede ognuno la propria copia dei dati: le prove di uno non arrivano agli altri.

**Accessi demo** (password `demo`): `responsabile@demo.it`, `operatore@demo.it`.
Nella scheda *Utenti* c'è anche `nuovo.utente@demo.it`, in attesa di attivazione, per mostrare come si abilita una persona.
**Ripristina dati demo** riporta tutto all'inventario del 13/10/2026.

### Percorso consigliato per mostrarla

1. I numeri in alto: 278 lotti, 580 pezzi, circa 4.217 kg ricavati dai 25 file Excel.
2. **Trova lo sfrido giusto**: lastra, spessore 20, larghezza 150, lunghezza 300 → il primo risultato è il più adatto.
3. **Preleva → Taglio con avanzo** su un tondo: l'avanzo rientra da solo con un nuovo codice.
4. **Materiali e prezzi**: cambia un €/kg e guarda cambiare il valore di magazzino; poi *Scarica listino* / *Importa listino*.
5. Passa a **Operatore**: stesse operazioni di magazzino, ma niente prezzi né utenti.
6. **Scarica Excel**: il file per l'inventario di fine anno.
7. **Da verificare**: le righe ambigue del vecchio inventario, da chiarire con Almatech.

## Cosa fa

- **Peso automatico** di ogni lotto (volume × peso specifico del materiale).
- **Valore di magazzino** per materiale (peso × €/kg).
- **Trova lo sfrido giusto**: dalla misura del pezzo da ricavare, propone lo sfrido con meno spreco.
- **Prelievo** a pezzi interi o **taglio con avanzo**: l'avanzo rientra da solo come nuovo lotto con il suo codice.
- **Carico** di nuovi sfridi e **correzione** dopo un conteggio fisico.
- **Listino prezzi** da Excel: scarica il listino, compila i €/kg, reimportalo (con anteprima delle modifiche).
- **Scarica Excel** di tutto il magazzino, con riepilogo e storico movimenti.
- **Due ruoli**: *operatore* (prelievi, carichi, correzioni) e *responsabile* (anche prezzi, verifiche, utenti).

Non è collegata a G7 Suite (scelta concordata, ottobre 2026).

## Com'è fatta

| Parte | File | Cosa |
|---|---|---|
| Pagina web | `index.html`, `style.css`, `app.js` | Sito statico, nessuna compilazione. Librerie da CDN: SheetJS 0.18.5 (Excel), supabase-js 2.45.4 (solo modalità Supabase) |
| Impostazioni | `config.js` | `MODALITA: 'demo'` oppure `'supabase'`, più indirizzo e chiave del progetto Supabase |
| Demo | `demo.js`, `demo-data.js` | Archivio nel browser con le stesse regole del database; dati iniziali (22 materiali, 278 lotti) |
| Database | `supabase/migrations/001_schema.sql` | Tabelle, permessi per ruolo, funzioni di prelievo/carico/rettifica |
| Dati iniziali | `supabase/seed/002_dati_iniziali.sql` | Gli stessi 22 materiali e 278 lotti, per Supabase |
| Strumenti | `tools/` | Script Python usati per leggere i 25 Excel originali e generare i dati |
| Guida operatori | `docs/GUIDA-UTENTE.md` | Istruzioni d'uso per chi lavora in magazzino |

### Tabelle

- `materiali`: grado (es. POM-C), famiglia, peso specifico g/cm³, prezzo €/kg, flag “prezzo di esempio”.
- `lotti`: codice (es. `TO-POM-012`), forma, grado, descrizione, misure in mm, pezzi, ubicazione, segnalazioni dall'import.
- `movimenti`: storico di prelievi, carichi e rettifiche, con commessa, operatore e utente.
- `profili`: un profilo per ogni utente, con ruolo e stato (attivo / in attesa).
- `v_magazzino`: vista con peso e valore già calcolati, utile per report dal pannello Supabase.

### Regole (uguali in demo e su Supabase)

- Un nuovo utente resta **in attesa** finché un responsabile non lo attiva.
- I pezzi cambiano **solo** con prelievo, carico e correzione: ogni modifica lascia un movimento.
- Prezzi, verifiche e utenti li modifica solo il responsabile.

---

## Passare ai dati condivisi con Supabase (dopo l'ok di Almatech)

Con Supabase i dati diventano un unico archivio condiviso, con login vero per ogni persona e aggiornamento in tempo reale tra più postazioni.
Servono un account [Supabase](https://supabase.com) e uno [Netlify](https://netlify.com). Tempo: circa 30 minuti.

### 1. Crea il progetto Supabase

1. Supabase → **New project**.
2. Nome: `almatech-magazzino`. Password database: generala e salvala nel gestore password.
3. Region: **Central EU (Frankfurt)**, per tenere i dati in Europa.
4. Attendi che il progetto sia pronto (1-2 minuti).

### 2. Crea tabelle e carica i dati

1. Supabase → **SQL Editor** → **New query**.
2. Copia tutto il contenuto di `supabase/migrations/001_schema.sql`, incollalo e premi **Run**. Deve finire con “Success”.
3. Nuova query: copia tutto `supabase/seed/002_dati_iniziali.sql`, incolla e **Run**.
4. Controllo: esegui `select count(*), sum(pezzi) from lotti;` → deve dare **278** e **580**.

Esegui ogni file **una sola volta**: rieseguirlo darebbe errore perché le tabelle esistono già.

### 3. Collega la pagina al database

1. Supabase → **Project Settings** → **API**.
2. Copia **Project URL** e la chiave **anon public**.
3. Su GitHub apri `config.js` → icona matita → imposta `MODALITA: 'supabase'` e sostituisci `INSERISCI_QUI_PROJECT_URL` e `INSERISCI_QUI_ANON_KEY` con i due valori → **Commit changes**.

La chiave *anon* è fatta per stare nella pagina: i dati restano protetti da login e permessi.
**Non usare mai la chiave `service_role`** in questo file.

### 4. Impostazioni di accesso in Supabase

1. **Authentication** → **Sign In / Providers**: lascia attivo **Email**; disattiva **Allow new users to sign up** (gli utenti li crea solo Flowline o il responsabile).
2. Il dettaglio “Confirm email” può restare attivo: gli utenti creati dal pannello con *Auto Confirm* non devono confermare.

### 5. Pubblica il sito su Netlify

1. Netlify → **Add new project** (o *Add new site*, a seconda della versione) → **Import an existing project** → **GitHub** → scegli `Flowline-it/almatech-magazzino-sfridi`. Se il repository non compare, autorizza Netlify ad accedere all'organizzazione Flowline-it.
2. Build command: **lascia vuoto**. Publish directory: **`.`** (un punto).
3. **Deploy**. Netlify assegna un indirizzo tipo `https://almatech-magazzino.netlify.app` (si può rinominare in *Site configuration → Change site name*).
4. Ogni modifica salvata su GitHub (branch `main`) viene ripubblicata da sola.

### 6. Comunica a Supabase l'indirizzo del sito

Supabase → **Authentication** → **URL Configuration**:
- **Site URL**: l'indirizzo Netlify (es. `https://almatech-magazzino.netlify.app`)
- **Redirect URLs**: aggiungi lo stesso indirizzo.

Serve per i link di accesso via email e per gli inviti.

### 7. Crea il primo responsabile

1. Supabase → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Email e password del responsabile (es. Marco Riotti), spunta **Auto Confirm User** → **Create user**.
3. SQL Editor, sostituendo l'email:

   ```sql
   update profili set attivo = true, ruolo = 'responsabile', nome = 'Marco Riotti'
   where email = 'marco.riotti@almatech.it';
   ```

4. Apri il sito e accedi: deve comparire il magazzino con 278 lotti.

### 8. Aggiungere altre persone

1. Supabase → **Authentication** → **Users** → **Add user**:
   - **Create new user** con password (comoda per un PC o tablet di magazzino condiviso), oppure
   - **Send invitation**: la persona riceve un'email, entra dal link e poi imposta una password da **Account**.
2. Il responsabile apre la scheda **Utenti** nella web app e preme **Attiva**. Lì può anche cambiare nome e ruolo.

---

## Da sapere

- **Prezzi di esempio.** I €/kg caricati sono indicativi (segnati “esempio”): finché non vengono sostituiti, il valore di magazzino non è reale. Il responsabile li aggiorna dalla scheda *Materiali e prezzi* o con *Importa listino*.
- **AFV 300** non ha peso specifico: 2 lotti risultano senza peso finché non viene inserito.
- **Da verificare.** 21 righe del vecchio inventario erano ambigue (quantità mancanti, possibili doppioni, lunghezze scritte in forma non chiara). Sono elencate nella scheda omonima, con il testo originale.
- **Demo e dati.** In modalità demo ogni browser ha la sua copia: svuotando i dati del browser si riparte dall'inventario iniziale. Per lavorare davvero serve Supabase.
- **Piano Supabase gratuito.** Un progetto gratuito viene messo in pausa dopo un periodo di inattività e non ha backup automatici giornalieri. Per l'uso quotidiano in produzione valutare il piano a pagamento; nel frattempo usare **Scarica Excel** come copia di sicurezza periodica. Verificare i limiti aggiornati su supabase.com/pricing.
- **Movimenti.** La scheda Movimenti mostra gli ultimi 500; lo storico completo è nel file di *Scarica Excel*.

## Modificare l'app

- Pagina: `index.html` (struttura), `style.css` (aspetto), `app.js` (logica). Non c'è nulla da compilare: si modifica il file e si salva su GitHub.
- Database: le modifiche allo schema vanno scritte in un nuovo file `supabase/migrations/002_....sql` ed eseguite nel SQL Editor, senza toccare `001_schema.sql` già applicato.
- Prova in locale: basta aprire `index.html`. Per la modalità Supabase meglio un piccolo server: dalla cartella `python3 -m http.server 8000` e apri `http://localhost:8000`.

## Rigenerare i dati iniziali (solo se servisse)

```bash
python3 tools/genera_seed.py tools/dati/inventario_iniziale.json tools/dati/materiali.json supabase/seed/002_dati_iniziali.sql
python3 tools/genera_demo_data.py tools/dati/inventario_iniziale.json tools/dati/materiali.json demo-data.js
```

`tools/importa_excel.py` e `tools/segnala_doppioni.py` sono gli script usati per leggere i 25 file Excel originali (non inclusi nel repository) e produrre `tools/dati/inventario_iniziale.json`.
