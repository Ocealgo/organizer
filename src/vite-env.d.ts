/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /** 'true' only in .env.test — points the app at the local emulator suite. */
  readonly VITE_USE_EMULATORS?: string;
  readonly VITE_EMULATOR_HOST?: string;
  /** Tiles and geocoding for the map — see components/MapPicker.tsx. */
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_TILE_ATTR?: string;
  readonly VITE_GEOCODE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
