# Modulo Inventario – specifica (bozza 26/11/2026)

## Obiettivo
Chi fa l'inventario controlla a vista, da telefono o tablet, che quello che risulta in G7 Suite ci sia davvero in magazzino. Alla fine si scarica un Excel **identico come struttura** all'export di G7, con le quantità corrette, da reimportare in G7.

Flusso: **export da G7 → import nell'app → conteggio da telefono → chiusura → Excel per G7**.

## Il file di partenza (export G7 del 26/11/2026)
Un foglio unico, `Sheet`, con 12.146 righe e 11 colonne:

| Col | Intestazione | Note |
|---|---|---|
| A | Codice articolo | testo; 7 codici hanno spazi in fondo (es. `"AIR-D DN15 "`), **da conservare così** |
| B | Descrizione articolo | |
| C | UM | PZ (10.406), KG (1.174), MT (51), MQ (2), vuota (307) |
| D | Esistenza | numero, a volte decimale (KG); **68 negativi**; è **la colonna da aggiornare** |
| E | Ubicazione Deposito | quasi sempre vuota (14 righe piene) |
| F | Lotto | sempre vuota |
| G | Scadenza lotto | sempre vuota |
| H | ScortaMinima | sempre vuota |
| I | TipoArticolo | sempre vuota |
| J | S/N | sempre vuota |
| K | Obsoleto | VERO/FALSO |

Struttura delle righe:
- riga 1: intestazioni;
- **righe di sezione** con solo la colonna A piena: `Codice deposito: 01 ` e `Gruppo: PP `, che raggruppano gli articoli sotto di loro;
- righe articolo;
- ultima riga: in D la formula `=SUBTOTAL(9,D4:D12145)`.

Numeri: **11.940 righe articolo**, 11.710 codici distinti, 105 gruppi.
Depositi: 11 in tutto. **01** ne ha 11.403; poi 02 (147), 03 (44), 04 (26), 05, 06, 07, 08, 09, 17. Ci sono anche 307 righe con deposito vuoto.
**Solo 1.112 righe hanno esistenza diversa da 0.**

Lo stesso codice può stare in più depositi (es. `BTPP100G` nel deposito 01 e nel 17), quindi **la chiave di un articolo è codice + deposito** (+ ubicazione se piena). La coppia codice + deposito non ha doppioni in questo file.

## Funzioni
### 1. Import
- Si carica l'xlsx. L'app legge le righe di sezione per assegnare deposito e gruppo a ogni articolo, e scarta l'ultima riga del totale.
- Crea una **sessione d'inventario** (data, chi l'ha creata, nome del file) e conserva il file originale, che servirà per l'export.
- Fa un controllo: se le intestazioni non sono quelle attese, si ferma con un messaggio chiaro.

### 2. Conteggio (pensato per il telefono)
- Filtri: **deposito**, **gruppo**, **solo con giacenza ≠ 0** (attivo di default), stato (da verificare, OK, diverso, non trovato), negativi.
- Ricerca istantanea per codice o descrizione, che ignora maiuscole e spazi.
- Ogni riga mostra codice, descrizione, giacenza G7 con UM e tre pulsanti grandi: **OK**, **Diverso** (si apre un tastierino numerico, decimali permessi per KG/MT) e **Non trovato** (= 0).
- Si può anche aggiungere un **articolo trovato in magazzino che non risulta** in G7, ma solo come segnalazione: non va nell'export finché G7 non lo accetta (da chiedere).
- In alto: avanzamento, per esempio "320 / 1.112 verificati".
- La lista deve restare fluida con 12.000 righe: carica le righe a pezzi o mostra solo quelle visibili.
- Si annota chi ha contato e quando. Se due persone contano lo stesso articolo, vince l'ultimo conteggio e si avvisa.

### 3. Chiusura ed export
- Riepilogo delle differenze: articolo, G7, contato, differenza, UM. Si può scaricare come foglio a parte.
- Il **file per G7** si fa partendo dal file originale e cambiando **solo la colonna D** degli articoli contati con un valore diverso. Restano uguali righe di sezione, ordine, formattazione, formula SUBTOTAL e nome del foglio.
- Gli articoli non verificati mantengono la giacenza G7.
- Una volta chiusa, la sessione si può consultare ma non modificare.

### Modalità
- **Demo**: tutto nel browser, solo per mostrare il flusso a Riotti.
- **Supabase**: indispensabile nell'uso reale, perché più persone contano da dispositivi diversi. Servono tabelle `inventari` (sessioni) e `inventario_righe` (riga, G7, contato, stato, chi, quando) e i permessi per i ruoli già esistenti.

## Domande aperte per Riotti
1. Quando G7 reimporta, aggiorna solo l'**Esistenza**? Abbinando cosa: codice + deposito? Vuole il file intero o gli bastano le righe cambiate?
2. Si possono aggiungere articoli o righe nuove nel file, o vanno creati prima in G7?
3. Si contano tutti i depositi o solo lo 01? Gli articoli a giacenza 0 vanno verificati?
4. Che fare con i 68 articoli a giacenza negativa?
5. Quante persone contano insieme? Si dividono per deposito, gruppo o zona?
6. Gli sfridi del primo modulo devono entrare in questo inventario o restano separati?
7. Gli articoli a KG si pesano, o basta confermare a vista?

## Risposte di Almatech (26/11/2026)
- Articoli non presenti in G7: restano **solo segnalazioni**. ✔ già così.
- Si contano **tutti i depositi** e **anche gli articoli con giacenza 0**. ✔ filtro «solo giacenza ≠ 0» spento di default; l'avanzamento è su tutti gli articoli.
- Giacenze negative: si contano **normalmente**. ✔ nessuna regola speciale.
- **Una sola persona** conta: il collaudo con più persone insieme non è prioritario.
- Articoli a peso (KG): serve una **trasformazione in base ai pesi specifici dei materiali**, come nei file Excel del magazzino sfridi. ⏳ da chiarire con Riotti cosa si misura (vedi sotto).
- Ancora senza risposta: come G7 reimporta il file (domanda 1) e se gli sfridi entrano nell'inventario (domanda 6).
