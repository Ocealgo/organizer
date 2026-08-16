import { initializeApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { getAuth, connectAuthEmulator } from 'firebase/auth'
import { getStorage, connectStorageEmulator } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
export const db = getFirestore(app)
export const auth = getAuth(app)
// Field evidence — odometer readings, shelf photos, expense bills.
export const storage = getStorage(app)

/**
 * End-to-end runs point the whole app at the local emulator suite.
 *
 * Opt-in only, and only ever from `.env.test`, which carries a `demo-` project
 * id. The Firebase SDKs refuse to reach real infrastructure for a `demo-`
 * project, so a misconfigured run fails loudly instead of writing to somebody's
 * live data. A production build never sets the flag and this block is dead code
 * the bundler drops.
 */
if (import.meta.env.VITE_USE_EMULATORS === 'true') {
  const host = import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1'
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true })
  connectFirestoreEmulator(db, host, 8080)
  connectStorageEmulator(storage, host, 9199)
  // eslint-disable-next-line no-console
  console.info(`[firebase] using emulators on ${host} — project ${firebaseConfig.projectId}`)
}
