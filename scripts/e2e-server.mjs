/**
 * The emulators and the app, in test mode, on a port of your choosing.
 *
 * This exists for the quoting. The command firebase has to run is a single
 * string handed to `emulators:exec`, and that string has to survive being
 * interpolated with a port and then re-parsed by a shell — which cmd.exe and sh
 * do differently. Built here, once, so both get the same thing.
 *
 * It is one command string rather than an argv array on purpose: with an array
 * and `shell: true`, Node concatenates without quoting, so `--mode test` ends
 * up looking like an option to firebase rather than part of the command it is
 * being asked to run.
 *
 * E2E_PORT moves the app off 5173. Worth being able to do: Playwright adopts
 * anything already answering on its port, and `npm run dev` answers on 5173
 * pointing at the live project, so a run started next to a dev server can end
 * up driving production. Moving the port is cheaper than remembering not to.
 */
import { spawn } from 'node:child_process'

const PORT = process.env.E2E_PORT ?? '5173'

const app = `vite --mode test --port ${PORT} --host 127.0.0.1 --strictPort`

// `npx` because firebase-tools is a devDependency: it lives in node_modules/.bin
// and is not on PATH.
const command =
  'npx firebase emulators:exec'
  + ' --only auth,firestore,storage,functions'
  + ' --project demo-ocealgo'
  + ` "${app}"`

const child = spawn(command, { stdio: 'inherit', shell: true })
child.on('exit', code => process.exit(code ?? 1))
