# Almatech – Magazzino sfridi e inventario

Web app di Flowline per **Almatech Srl** (Busto Arsizio, meccanica di precisione CNC). Referente cliente: Marco Riotti.

## Chi lavora qui
Il team Flowline non ha un background tecnico. Spiega sempre in italiano semplice cosa hai cambiato e come provarlo. Prima di fare modifiche grosse proponi un piano breve. Niente gergo se non serve.

## Regole fisse
- Almatech usa il gestionale **G7 Suite** e lo tiene. **Non ci integriamo con G7**: i dati passano solo tramite file Excel esportati da G7 e reimportati in G7.
- I file da reimportare in G7 devono avere **la stessa struttura del file esportato** (stesse colonne, stesso ordine, stesse righe di intestazione), altrimenti G7 non li accetta.
- **Modalità demo** (`MODALITA: 'demo'` in `config.js`): si apre `index.html` senza server e i dati restano nel browser. È la modalità attiva.
- **Modalità Supabase**: lo schema in `supabase/` è pronto ma non va attivato né collegato a un progetto reale finché Almatech non dà l'ok.
- Non mettere mai chiavi, password o dati reali del cliente nel repository. I file Excel veri del cliente vanno in `dati-locali/`, che è escluso da git.
- Ogni funzione nuova deve funzionare in **entrambe** le modalità.
- Tieni aggiornati il `README.md` e `docs/GUIDA-UTENTE.md` quando cambia qualcosa per l'utente.

## Moduli
1. **Magazzino sfridi** (fatto): ricerca dello sfrido, prelievo intero o con avanzo, carico, rettifica, listino €/kg, export Excel.
2. **Inventario** (da fare): vedi `docs/SPEC-INVENTARIO.md`.

## Come lavoriamo
- Un branch per ogni funzione, poi una pull request verso `main`.
- Prima di dire "fatto", prova il percorso completo nel browser, anche su schermo da telefono.
- Fuori dal repository (preventivi, call, decisioni col cliente) si lavora nel progetto Claude "ALMATECH SRL".
