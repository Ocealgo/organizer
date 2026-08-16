# End-to-end QA

Playwright against the Firebase emulator suite. Nothing here can reach a real
project: `.env.test` carries a `demo-` project id, and the Firebase SDKs refuse
to leave the machine for one of those.

```bash
npm run e2e            # everything, desktop + mobile
npm run e2e:desktop    # one viewport
npm run e2e:mobile
npm run e2e:ui         # the Playwright inspector
npm run e2e:report     # last HTML report
```

`npm run e2e` starts the emulators and a Vite dev server itself — there is
nothing to set up by hand.

## How it is put together

| Piece | What it does |
|---|---|
| `playwright.config.ts` | Two projects, `desktop` (1280×800) and `mobile` (Pixel 7). The app is phone-first and most of its users are on one, so anything that only passes at 1280px has not been tested. |
| `fixtures/seed.ts` | Wipes the emulator and rebuilds the same world for every spec: six accounts across every role, two products, three outlets. The only place that writes past security rules. |
| `fixtures/app.ts` | `loginAs`, `asAlso` (a second person in their own browser context), `stubCamera`, `clickStable`. |

Device plugins all have web fallbacks the harness can drive: geolocation is a
fixed fix in Kochi, the camera falls back to a file input that `stubCamera`
answers, notifications are a no-op, battery reports nothing.

`asAlso` exists because Firebase Auth persists per browser context, not per tab.
Two pages in one context share a session, so signing in a second user silently
signs the first one out. Any spec covering a hand-off — rep submits, admin
reviews — needs genuinely separate contexts.

## Known: the suite is not yet reliable end to end

**30 of 34 pass on any given run, every spec passes in isolation, and the four
that fail rotate between runs.** They are not app defects — they are test
isolation.

The symptom is a spec starting with data from the one before it: an expense on
the books in a week a spec expects to be empty, or a duty session already open.
The emulator is cleared through the dedicated `DELETE .../documents` endpoint in
`beforeEach`, which is atomic, so the leak is a write landing *after* that clear
— most likely from the previous spec's browser context on its way down.

Two things already tried and not sufficient on their own: swapping a
document-by-document sweep for the atomic clear endpoint, and giving the
emptiness-asserting specs their own rep so they do not share an actor with a
spec that files an expense.

The next thing to try is making teardown deterministic rather than the reset
more forceful — close every context the spec opened *before* the clear runs,
and have `resetWorld` poll until the collections it cares about are observably
empty rather than assuming the DELETE has settled.

Until that is closed, treat a single red run as inconclusive and re-run the
failing spec on its own before believing it.

## What this has already caught

Both were real, both were shipped, and neither was visible from reading the code:

1. **Outlet visits were completely broken for every rep.** The resume listener
   queried `outlet_visits` by `(sessionId, status)`, but the read rule is
   `resource.data.uid == request.auth.uid`. Firestore secures a *list* by the
   shape of the query, not per document, so the whole listener was denied. A rep
   punched in, the visit was written, and the app dropped them straight back on
   the outlet picker with no error. Fixed by carrying `uid` in the query;
   `tests/rules/firestore.test.mjs` now pins both the denied and allowed shapes.

2. **A pending account was bounced to a blank login form with no explanation.**
   `LoginPage` re-read the user document and signed the account back out with an
   inline message, while `AuthContext` was concurrently resolving and swapping in
   the status screen. The signOut remounted `LoginPage` and took the message with
   it. Two places owned one decision and the quieter one won at random. The
   status screen in `App.tsx` now owns it alone.
