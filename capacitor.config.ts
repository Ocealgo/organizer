import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'in.ocealgo.field',
  appName: 'Ocealgo Field',
  webDir: 'dist',

  plugins: {
    // Compliance photos must come from the live camera. The plugin is what makes
    // that enforceable — a web file input cannot stop a gallery pick.
    Camera: {
      androidxActivityVersion: '1.8.0',
      androidxCoreVersion: '1.12.0',
    },
    Geolocation: {
      // Punch-in fixes are worth waiting for; a stale cached fix defeats the point.
      timeout: 15000,
      maximumAge: 0,
      enableHighAccuracy: true,
    },
  },

  android: {
    // Firebase Auth and Firestore both need cleartext off; nothing here talks HTTP.
    allowMixedContent: false,
  },

  server: {
    androidScheme: 'https',
  },
}

export default config
