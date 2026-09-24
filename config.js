// Настройки приложения.
// backend: "local" — данные только в этом браузере; "supabase" — общая база и синхронизация.
// supabaseUrl / supabaseAnonKey — публичные значения из Supabase (Settings → API Keys).
// ВАЖНО: service_role / Secret key сюда НИКОГДА не вставлять.
window.APP_CONFIG = {
  backend: "supabase",
  supabaseUrl: "https://bnlyvzmpumfjacnilykh.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJubHl2em1wdW1mamFjbmlseWtoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxOTQzOTMsImV4cCI6MjEwNTc3MDM5M30.w8oGEwV8MVCNfvWvKiURqKzqZc0cRZnrklOhZ-pD3qk",
  rewards: { "5": 200, "4": 150, "3": 0, "2": 0 }
};
