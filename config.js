/*
 * Collegamento al database Supabase.
 *
 * Dove trovare i due valori: Supabase → il vostro progetto → Project Settings → API
 *   - SUPABASE_URL      = "Project URL"           (es. https://abcdefgh.supabase.co)
 *   - SUPABASE_ANON_KEY = chiave "anon" "public"  (una stringa lunga che inizia con eyJ...)
 *
 * La chiave "anon" è fatta per stare nel browser: i dati restano protetti dai
 * permessi del database e dal login. NON incollare mai qui la chiave "service_role".
 */
window.APP_CONFIG = {
  SUPABASE_URL: 'INSERISCI_QUI_PROJECT_URL',
  SUPABASE_ANON_KEY: 'INSERISCI_QUI_ANON_KEY'
};
