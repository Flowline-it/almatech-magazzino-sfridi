# Guida rapida — Magazzino sfridi

## Entrare

Apri l'indirizzo del magazzino, inserisci email e password.
Se non ricordi la password: scrivi l'email e premi **“Ricevi un link di accesso via email”**. Dopo essere entrato puoi impostare una nuova password da **Account**.

Se vedi “Account in attesa di attivazione”, il responsabile deve ancora attivarti.

## Trovare uno sfrido

**Trova lo sfrido giusto**: scegli forma (lastra, tondo, tubo), materiale e le misure **minime** del pezzo da ricavare, poi **Cerca**.
Il primo risultato, evidenziato in verde, è quello con meno materiale da togliere.

In alternativa usa i filtri (Lastre, Tondi, Tubi) o la ricerca libera per codice, materiale o misura (es. `20x120`).

## Prelevare

Premi **Preleva** sulla riga del lotto:

- **Pezzi interi**: indica quanti pezzi prendi.
- **Taglio con avanzo**:
  - tondo o tubo: scrivi la lunghezza che usi (lo scarto lama è 3 mm, modificabile). L'avanzo viene calcolato e ricaricato da solo;
  - lastra: scrivi la misura della parte che avanza. Se non avanza niente di utile, lascia vuota la lunghezza.
- Indica la **commessa**. L'operatore è già compilato con il tuo nome.

L'avanzo riceve un nuovo codice (es. `TO-POM-025`), che compare nel messaggio in basso: scrivilo sul pezzo.

## Caricare uno sfrido

**+ Carica sfrido**: forma, materiale, descrizione (colore/variante), misure, pezzi, ubicazione e provenienza.
Prima di confermare vedi il peso e il codice che verrà assegnato.

## Correggere dopo un conteggio

**Preleva → Correggi conteggio**: scrivi quanti pezzi ci sono davvero e, se serve, l'ubicazione.
La differenza viene registrata come **rettifica** nello storico.

## Solo per il responsabile

- **Materiali e prezzi**: modifica €/kg e peso specifico direttamente nella tabella, oppure **Scarica listino** → compila → **Importa listino** (prima di salvare vedi cosa cambia).
- **Da verificare**: controlla le righe ambigue del vecchio inventario e premi **Segna verificato**.
- **Utenti**: attiva le persone nuove, cambia nome e ruolo, disattiva chi non deve più entrare.

## Inventario di fine anno

**Scarica Excel** produce un file con tre fogli: *Magazzino* (ogni lotto con peso e valore), *Riepilogo* (per materiale) e *Movimenti* (storico completo).

## Inventario con l'export di G7

Apri la scheda **Inventario**.

**Il responsabile prepara l'inventario**
1. In G7 esporta l'elenco articoli in Excel.
2. In **Inventario** premi **Importa export G7…** e scegli il file.
3. Controlla i numeri (articoli, depositi, gruppi, giacenze ≠ 0, negativi): devono tornare con G7. Poi **Crea inventario**.

**Chi conta (anche da telefono)**
1. Apri l'inventario con **Conta**.
2. Filtra per deposito o gruppo, oppure cerca per codice o descrizione. Vanno verificati **tutti** gli articoli, anche quelli con giacenza 0. Per vedere prima solo quelli con giacenza, accendi “Solo giacenza ≠ 0”.
3. Per ogni articolo guarda quanto c'è davvero:
   - **OK**: la quantità è quella di G7;
   - **Diverso**: scrivi la quantità contata col tastierino (i decimali si usano solo per KG, MT, MQ…);
   - **Non trovato**: non c'è, vale 0.
   - **Articoli a peso (KG)**: in G7 sono in kg, ma si contano i **metri** (barre) o i **pezzi** (lastre). Premi **Diverso → Calcola i kg da metri o pezzi…**: l'app propone forma, misure e materiale leggendoli dalla descrizione, tu scrivi i metri o i pezzi e controlli le misure. Il peso specifico è quello del magazzino sfridi; per i metalli che lì non ci sono è un valore indicativo, segnalato come “da confermare”. Con **Usa questo valore** i kg vanno nel conteggio.
   Dopo la scelta la riga si **chiude**: diventa tutta verde (OK), gialla (Diverso) o rossa (Non trovato) e i pulsanti spariscono, così non si cambia per sbaglio. Per correggere premi **Modifica** sulla riga: tornano i pulsanti. Con **Lascia com'è** si esce senza cambiare niente, con **Rimetti da verificare** si annulla il conteggio.
4. In alto vedi l'avanzamento. Un articolo trovato ma non presente in G7: **+ Articolo non in G7** (è solo una segnalazione).
5. Se due persone contano lo stesso articolo vale l'ultimo conteggio e compare un avviso.

**Il responsabile chiude**
1. **Riepilogo e chiusura** mostra le differenze; **Scarica differenze** le salva in Excel.
2. **Chiudi inventario…**: da quel momento non si può più modificare.
3. **Scarica file per G7**: ha la stessa struttura dell'export di G7 e cambia solo la colonna *Esistenza* degli articoli con differenza. Gli articoli non verificati restano come in G7. Reimportalo in G7.

Prima della chiusura il file per G7 si chiama “PROVVISORIO”: non reimportarlo in G7.
