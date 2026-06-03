/// <reference types="vite/client" />

// Web-build env vars (baked in at build time by Vite). Declared so
// `import.meta.env.VITE_SUPABASE_*` typechecks under `tsc --noEmit`.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
