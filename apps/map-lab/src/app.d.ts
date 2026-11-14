// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {}
}

interface ImportMetaEnv {
  readonly VITE_FORESHADOW_URL?: string;
  readonly VITE_FORESHADOW_KEY?: string;
}

export {};
