/**
 * A drop-in replacement for Firestore's `onSnapshot` that can never fail
 * silently.
 *
 * Why this exists
 * ---------------
 * `onSnapshot(ref, next)` with no error callback swallows every failure. A
 * listener the security rules reject simply never fires — the screen renders
 * its empty state and looks like it is working. Two separate "permission
 * denied" investigations turned out to be exactly this: the rules were wrong,
 * but nothing anywhere said so.
 *
 * Every screen imports `onSnapshot` from here instead of from
 * `firebase/firestore`. Shadowing the import rather than wrapping each call
 * means a file either has the guard on all of its listeners or on none of
 * them — there is no way to add a listener later and quietly miss it.
 *
 * What it does
 * ------------
 *   · always logs the failure to the console, for everyone
 *   · records it in a small store that ListenerErrors renders, and that only
 *     a super admin ever sees
 *   · still calls a caller-supplied onError, if there is one
 */

import {
  onSnapshot as firestoreOnSnapshot,
  DocumentReference,
  DocumentSnapshot,
  FirestoreError,
  Query,
  QuerySnapshot,
  Unsubscribe,
} from 'firebase/firestore'

// ── The store ────────────────────────────────────────────────────────────────

export interface ListenerFailure {
  /** Collection or document path, when we can work it out. */
  source: string
  /** Firestore error code, e.g. "permission-denied". */
  code: string
  message: string
  /** How many times this same listener has failed since the page loaded. */
  count: number
  lastAt: number
}

let failures: ListenerFailure[] = []
const listeners = new Set<() => void>()

function emit() {
  // A fresh array each time, so useSyncExternalStore sees a new reference
  // exactly when something actually changed.
  failures = [...failures]
  listeners.forEach(l => l())
}

export function subscribeToListenerFailures(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function getListenerFailures(): ListenerFailure[] {
  return failures
}

export function clearListenerFailures() {
  failures = []
  listeners.forEach(l => l())
}

/**
 * Best-effort path for the thing being listened to.
 *
 * DocumentReference and CollectionReference both expose `path` publicly. A
 * Query built with `query(collection(...), where(...))` does not, so we read
 * the internal field behind a try/catch: if a future SDK renames it we lose
 * the collection name in the message, which is a worse error report but not a
 * broken one.
 */
function describe(target: DocumentReference<any> | Query<any>): string {
  const anyTarget = target as any
  if (typeof anyTarget.path === 'string') return anyTarget.path
  try {
    const segments = anyTarget._query?.path?.segments
    if (Array.isArray(segments) && segments.length) return segments.join('/')
  } catch {
    /* fall through */
  }
  return 'unknown'
}

function record(source: string, err: FirestoreError) {
  // eslint-disable-next-line no-console
  console.error(`[live] listener on "${source}" failed: ${err.code}`, err)

  const existing = failures.find(f => f.source === source && f.code === err.code)
  if (existing) {
    existing.count += 1
    existing.lastAt = Date.now()
  } else {
    failures.push({
      source,
      code: err.code ?? 'unknown',
      message: err.message ?? String(err),
      count: 1,
      lastAt: Date.now(),
    })
  }
  emit()
}

// ── The wrapper ──────────────────────────────────────────────────────────────

export function onSnapshot<T>(
  reference: DocumentReference<T>,
  onNext: (snapshot: DocumentSnapshot<T>) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe

export function onSnapshot<T>(
  query: Query<T>,
  onNext: (snapshot: QuerySnapshot<T>) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe

export function onSnapshot(
  target: any,
  onNext: any,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  const source = describe(target)
  return firestoreOnSnapshot(target, onNext, (err: FirestoreError) => {
    record(source, err)
    onError?.(err)
  })
}
