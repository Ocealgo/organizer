import { useState, useEffect, useRef } from 'react'
import { collection, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  AppUser, DutySession, GeoPoint, LocationIssue,
  OdometerStatus, ODOMETER_STATUS_LABEL,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { PageHeader, Eyebrow, GhostButton, PrimaryButton, Note, inputStyle } from '../../components/ui'
import { getFixOrReason } from '../../device/location'
import { capture, upload, CapturedPhoto } from '../../device/photo'
import { cameraIsVerifiable } from '../../device/platform'
import { batteryPercent } from '../../device/battery'
import { lastDutyDay } from '../../hooks/useDutySession'
import { scheduleEndOfDayReminder, cancelEndOfDayReminder } from '../../device/notify'
import { localDateStr } from '../../utils/date'

interface Props {
  appUser: AppUser
  session: DutySession | null
  onBack: () => void
  /** Set when leave closes the morning: the time the afternoon opens. */
  blockedUntil?: string
}

type Mode = 'punch_in' | 'punch_out' | 'done'

const MIN_NOTE = 5

const modeFor = (s: DutySession | null): Mode =>
  !s ? 'punch_in' : s.status === 'active' ? 'punch_out' : 'done'

export default function DutyScreen({ appUser, session, onBack, blockedUntil }: Props) {
  const { t } = useTheme()
  const { modal: confirmModal, showConfirm } = useConfirm()

  /**
   * What this screen was opened to do, decided once and then left alone.
   *
   * `session` arrives from a live listener, so deriving the mode on every
   * render — which is what this used to do — lets the screen change what its
   * button does while somebody is filling the form in. It is not theoretical:
   * the home screen offers "Start the day" before the listener has answered,
   * so an officer who is already punched in taps it, gets the opening form,
   * and a moment later the same form and the same button in the same place
   * quietly become the closing ones. Ending a day cannot be undone and claims
   * a distance. Nobody should do it by pressing a button they read as "start".
   *
   * So the mode is latched, and a session that disagrees with it is reported
   * rather than applied. Nothing here writes on the strength of the latch —
   * `submit` re-checks against the server before it creates anything.
   */
  const [mode] = useState<Mode>(() => modeFor(session))
  const isIn = mode === 'punch_in'

  /** Our own write coming back through the listener is not the day moving on. */
  const selfWrite = useRef(false)
  const diverged = modeFor(session) !== mode && !selfWrite.current

  // Location is captured in the background and never blocks anything.
  const [fix, setFix] = useState<GeoPoint | null>(null)
  const [locIssue, setLocIssue] = useState<LocationIssue | null>(null)
  const [locating, setLocating] = useState(true)

  // Odometer
  const [odoStatus, setOdoStatus] = useState<OdometerStatus>('recorded')
  const [odometer, setOdometer] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  /** Punch-out escape when the meter worked in the morning but not now. */
  const [meterUnreadable, setMeterUnreadable] = useState(false)

  const [prevClosing, setPrevClosing] = useState<number | null>(null)
  /** Set when the meter answer below was brought forward from the last day. */
  const [carriedOver, setCarriedOver] = useState<OdometerStatus | null>(null)
  /**
   * Whether the officer has said anything about the meter themselves yet.
   *
   * The lookup that carries the last day's answer forward is asynchronous, so
   * it can land after somebody has already tapped. Answering the question and
   * then having the answer overwritten a second later by a stale one is the
   * same class of thing as the screen changing its own mind, so it does not
   * happen: once they touch it, it is theirs.
   */
  const meterTouched = useRef(false)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const objectUrl = useRef<string | null>(null)

  useEffect(() => { void locate() }, [])

  useEffect(() => {
    if (!isIn) return
    let alive = true
    void lastDutyDay(appUser.uid, localDateStr()).then(prev => {
      if (!alive) return
      setPrevClosing(prev.closingKm)

      // Only a *missing* meter is carried forward. "I can read my meter" is
      // already the default, so a rep with a working one sees no change at
      // all — and the one person this is for stops retyping the same sentence
      // every morning.
      if (!prev.odometerStatus || prev.odometerStatus === 'recorded') return
      if (meterTouched.current) return
      setOdoStatus(prev.odometerStatus)
      if (prev.odometerIssueNote) setNote(prev.odometerIssueNote)
      setCarriedOver(prev.odometerStatus)
    })
    return () => { alive = false }
  }, [isIn, appUser.uid])

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])

  async function locate() {
    setLocating(true)
    const attempt = await getFixOrReason({ capturedBy: appUser.uid })
    setFix(attempt.fix)
    setLocIssue(attempt.issue)
    setLocating(false)
  }

  async function takePhoto() {
    setPhotoError(null)
    try {
      const shot = await capture()
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(shot.blob)
      setPhoto(shot)
      setPhotoUrl(objectUrl.current)
    } catch (e: any) {
      setPhotoError(e?.message || 'Could not take the photo.')
    }
  }

  // ── what this punch needs ─────────────────────────────────────────────────
  // On punch-out the status was decided in the morning; it is not re-asked.
  const effectiveStatus: OdometerStatus = isIn
    ? odoStatus
    : (session?.odometerStatus ?? 'recorded')

  const needsReading = effectiveStatus === 'recorded' && !(!isIn && meterUnreadable)

  const km = parseFloat(odometer)
  const kmValid = !isNaN(km) && km >= 0

  const odometerProblem = (() => {
    if (!needsReading || odometer.trim() === '') return null
    if (!kmValid) return 'Enter the reading as a number.'
    if (isIn && prevClosing !== null && km < prevClosing)
      return `Lower than your last closing reading of ${prevClosing} km.`
    if (!isIn && session?.startOdometerKm !== undefined && km <= session.startOdometerKm)
      return `Must be more than this morning's ${session.startOdometerKm} km.`
    return null
  })()

  /**
   * No reading this punch — which is a different question from whether the
   * person has to justify it.
   *
   * The field is written either way, because the rules require an explanation
   * field to exist whenever a reading does not. Whether somebody must actually
   * type into it depends on what the reading is for.
   */
  const noMeterReading = isIn ? effectiveStatus !== 'recorded' : (!isIn && meterUnreadable)

  /**
   * An officer explains a missing reading; a manager does not.
   *
   * The reading and its photo are what evidence an officer's distance claim,
   * so a gap in them is a gap in the evidence and has to be accounted for. A
   * manager is as likely to spend the day on a train or in an office as in a
   * vehicle, and making them write a paragraph about not driving turns a
   * normal day into an exception report.
   */
  const mustExplainMissingReading = appUser.role !== 'sales_manager'
  const noteNeeded = noMeterReading && mustExplainMissingReading
  const noteOk = !noteNeeded || note.trim().length >= MIN_NOTE

  const ready = !saving && noteOk &&
    (!needsReading || (kmValid && !odometerProblem && !!photo))

  const distance = !isIn && session?.startOdometerKm !== undefined && needsReading && kmValid
    ? Math.max(0, km - session.startOdometerKm)
    : null

  // ── submit ────────────────────────────────────────────────────────────────
  async function submit() {
    if (!ready || diverged) return

    // Ending the day is the one thing in the field app that cannot be undone —
    // no more visits, no more expenses against it, and the distance is claimed
    // as it stands. Starting one is asked for again if it goes wrong; this is
    // not, so it is worth one deliberate tap.
    if (!isIn) {
      const ok = await showConfirm(
        'End your day?',
        distance !== null
          ? `${distance} km will be claimed for today. Nothing more can be logged once the day is closed.`
          : 'Nothing more can be logged once the day is closed, and no distance will be claimed.',
        'End the day',
      )
      if (!ok) return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const battery = await batteryPercent()

      if (isIn) {
        // Ask the server, not the listener, whether today already exists.
        //
        // The listener is the thing that may not have answered yet, so it
        // cannot be the thing that decides this. Without the check a slow
        // first load lets an officer open a second session on top of the one
        // they are already working — invisibly, since the screen that reads
        // these takes the first document it is given and there is no second
        // one in sight.
        let already: DutySession | null = null
        try {
          const snap = await getDocs(query(
            collection(db, 'duty_sessions'),
            where('uid', '==', appUser.uid),
            where('date', '==', localDateStr()),
          ))
          const found = snap.docs[0]
          already = found ? ({ id: found.id, ...found.data() } as DutySession) : null
        } catch (e) {
          // A check that cannot be made must not stop somebody starting work.
          console.error('[DutyScreen] could not check for an existing day', e)
        }
        if (already) {
          setSaveError(already.status === 'active'
            ? 'Your day is already started. Go back — the app will offer you the closing reading instead.'
            : 'Today is already recorded as finished. Your next day starts with a fresh punch-in tomorrow.')
          return
        }

        // Mint the id first so any photo is filed under the session it belongs to.
        const sessionRef = doc(collection(db, 'duty_sessions'))
        const photoPath = needsReading && photo
          ? await upload(photo, { uid: appUser.uid, sessionId: sessionRef.id, kind: 'odometer_start' })
          : undefined

        const payload: Omit<DutySession, 'id'> = {
          uid: appUser.uid,
          name: appUser.name,
          date: localDateStr(),
          startAt: Date.now(),
          ...(fix ? { startLocation: fix } : locIssue ? { startLocationIssue: locIssue } : {}),
          odometerStatus: odoStatus,
          ...(needsReading ? { startOdometerKm: km } : {}),
          ...(photoPath
            ? { startOdometerPhoto: photoPath, startOdometerPhotoVerified: !!photo?.fromLiveCamera }
            : {}),
          ...(noMeterReading ? { odometerIssueNote: note.trim() } : {}),
          ...(battery !== undefined ? { startBatteryPct: battery } : {}),
          status: 'active',
          createdAt: Date.now(),
        }
        selfWrite.current = true
        await setDoc(sessionRef, payload)
        // Only once the day exists. Scheduling before the write would leave a
        // reminder for a day that failed to start.
        void scheduleEndOfDayReminder()
      } else if (session?.id) {
        const photoPath = needsReading && photo
          ? await upload(photo, { uid: appUser.uid, sessionId: session.id, kind: 'odometer_end' })
          : undefined

        selfWrite.current = true
        await updateDoc(doc(db, 'duty_sessions', session.id), {
          endAt: Date.now(),
          ...(fix ? { endLocation: fix } : locIssue ? { endLocationIssue: locIssue } : {}),
          ...(needsReading ? { endOdometerKm: km } : {}),
          ...(photoPath
            ? { endOdometerPhoto: photoPath, endOdometerPhotoVerified: !!photo?.fromLiveCamera }
            : {}),
          ...(meterUnreadable ? { endOdometerIssueNote: note.trim() } : {}),
          ...(battery !== undefined ? { endBatteryPct: battery } : {}),
          ...(distance !== null ? { claimedDistanceKm: distance } : {}),
          status: 'closed',
        })
        void cancelEndOfDayReminder()
      }
      onBack()
    } catch (e: any) {
      // Nothing landed, so the screen goes back to being the form it was —
      // including its right to notice that the day has moved on underneath it.
      selfWrite.current = false
      console.error('[DutyScreen] submit failed', e)
      setSaveError(
        e?.code === 'permission-denied'
          ? 'Firestore rejected this. The deployed rules may be older than this build.'
          : e?.message || 'Could not save. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }


  // ── the day moved while this screen was open ──────────────────────────────
  // Said out loud rather than absorbed. Whatever was typed here is dropped,
  // which is the point: it was typed about a different day to the one on
  // record, and the app has no business guessing which of the two was meant.
  if (diverged) {
    const now = modeFor(session)
    const [title, body] = now === 'punch_out'
      ? ['Your day is already started',
         'A punch-in for today came through while this screen was open — a moment ago, or from another device. Nothing you entered here was saved. Go back and the app will offer you the closing reading instead.']
      : now === 'done'
        ? ['Your day is already finished',
           'Today was closed while this screen was open. Nothing you entered here was saved, and nothing more can be logged today.']
        : ['This day is no longer on record',
           'The session this screen was showing has gone. Nothing you entered here was saved. Go back and start again.']

    return (
      <div style={{ minHeight: 'var(--oc-screen)', background: t.bg }}>
        <PageHeader eyebrow="Duty" title={title} onBack={onBack} />
        <div style={{ padding: '24px 20px', maxWidth: 560 }}>
          <div style={{ fontSize: 14, color: t.text3, lineHeight: 1.6, marginBottom: 22 }}>{body}</div>
          <GhostButton onClick={onBack}>Back to today</GhostButton>
        </div>
      </div>
    )
  }

  // ── day already finished ──────────────────────────────────────────────────
  if (mode === 'done' && session) {
    const rows: [string, string][] = [
      ['Started', new Date(session.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })],
      ['Finished', new Date(session.endAt!).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })],
    ]
    if (session.startOdometerKm !== undefined) rows.push(['Opening reading', `${session.startOdometerKm} km`])
    if (session.endOdometerKm !== undefined) rows.push(['Closing reading', `${session.endOdometerKm} km`])
    if (session.claimedDistanceKm !== undefined) rows.push(['Distance', `${session.claimedDistanceKm} km`])
    if (session.odometerStatus && session.odometerStatus !== 'recorded')
      rows.push(['Meter', ODOMETER_STATUS_LABEL[session.odometerStatus]])
    if (session.autoClosed) rows.push(['Closed', 'Automatically — the day was left open'])

    return (
      <div style={{ minHeight: 'var(--oc-screen)', background: t.bg }}>
        <PageHeader eyebrow="Duty" title="Your day is finished" onBack={onBack} />
        <div style={{ padding: '24px 20px', maxWidth: 560 }}>
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {rows.map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '14px 0', borderTop: `0.5px solid ${t.border}` }}>
                <span style={{ fontSize: 14, color: t.text3 }}>{label}</span>
                <span style={{ fontSize: 14, color: t.text }}>{value}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13, color: t.text3, marginTop: 20, lineHeight: 1.6 }}>
            Nothing more can be logged today. Your next day starts with a fresh punch-in.
          </div>
        </div>
      </div>
    )
  }

  /**
   * A half day off is half a day off.
   *
   * Punch-in only. A session already running has to stay closeable, or somebody
   * is stranded with an open day and no way to claim the distance. Checked here
   * as well as on the row that leads here, so the rule does not depend on that
   * row staying the only way in.
   */
  if (isIn && blockedUntil) {
    return (
      <div style={{ minHeight: '100vh', background: t.bg }}>
        <PageHeader eyebrow="Duty" title="Half day" onBack={onBack} />
        <div style={{ padding: '24px 20px', maxWidth: 560 }}>
          <div style={{ fontSize: 14, color: t.text2, lineHeight: 1.7 }}>
            Half a day is recorded against this morning, so your day starts at {blockedUntil}.
          </div>
          <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.7, marginTop: 14 }}>
            If that half day is wrong, open Leave, ask for it to be cancelled and say what
            happened. Your manager decides, and the morning comes back if they agree.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Duty"
        title={isIn ? 'Start your day' : 'End your day'}
        subtitle={isIn
          ? 'Your outlet list unlocks once this is done.'
          : 'Close the day off and your visits stop for today.'}
        onBack={onBack}
      />

      {/* A single-column form — capped so it reads as a column on a desktop. */}
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column',
                    gap: 26, maxWidth: 560 }}>

        {/* Location — recorded, never required */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Location</Eyebrow></div>
          {locating ? (
            <div style={{ fontSize: 14, color: t.text3 }}>Recording where you are…</div>
          ) : fix ? (
            <div style={{ fontSize: 14, color: t.text }}>
              Recorded, accurate to about {Math.round(fix.accuracy)} m.
              <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>
                {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              </div>
            </div>
          ) : (
            /* Told plainly, and before the fact rather than after it. A declined
               permission reaches the report as a declined permission, not as bad
               signal, so the officer hears that from the app first — along with
               the one thing they can actually do about it. Nothing is blocked
               either way. */
            <Note tone={locIssue === 'denied' ? 'warn' : 'plain'}>
              <div style={{ marginBottom: 10, lineHeight: 1.6 }}>
                {locIssue === 'denied' ? (
                  <>
                    Location is switched off for Ocealgo, so your day will be recorded
                    without one — and it will say the permission was declined rather
                    than that the signal was poor.
                    <div style={{ marginTop: 8 }}>
                      To turn it back on: your phone’s Settings → Apps → Ocealgo →
                      Permissions → Location.
                    </div>
                  </>
                ) : locIssue === 'timeout' ? (
                  'No location came back in time. Step into the open and try again, or carry on — the day will simply be recorded without one.'
                ) : locIssue === 'inaccurate' ? (
                  'The position was too vague to keep. Try again in the open, or carry on without one.'
                ) : (
                  'No location available. That is fine — you can carry on, and the day will simply be recorded without one.'
                )}
              </div>
              <GhostButton onClick={locate}>Try again</GhostButton>
            </Note>
          )}
        </div>

        {/* Meter status — only asked at the start of the day */}
        {isIn && (
          <div>
            <div style={{ marginBottom: 10 }}><Eyebrow>Your vehicle meter</Eyebrow></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(Object.keys(ODOMETER_STATUS_LABEL) as OdometerStatus[]).map(s => (
                <button key={s} className="oc-action"
                  onClick={() => { meterTouched.current = true; setOdoStatus(s) }}
                  style={{
                    background: 'none',
                    border: `0.5px solid ${odoStatus === s ? t.text2 : t.border}`,
                    borderRadius: 6, padding: '11px 14px', textAlign: 'left',
                    fontSize: 14, fontWeight: 400,
                    color: odoStatus === s ? t.text : t.text3, cursor: 'pointer',
                  }}>
                  {ODOMETER_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            {/* Said out loud. The app has answered a question on their behalf,
                and the one thing that makes that acceptable is that they can
                see it has, and that changing it is one tap. */}
            {carriedOver === odoStatus && (
              <div style={{ fontSize: 13, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
                Carried over from your last day. Change it if today is different.
              </div>
            )}
          </div>
        )}

        {/* Reading + photo, only when there is a meter to read */}
        {needsReading && (
          <>
            <div>
              <div style={{ marginBottom: 10 }}>
                <Eyebrow>{isIn ? 'Opening reading' : 'Closing reading'}</Eyebrow>
              </div>
              <input
                type="number" inputMode="decimal" value={odometer}
                onChange={e => setOdometer(e.target.value)}
                placeholder="Kilometres on the meter" style={inputStyle(t)}
              />
              {odometerProblem && (
                <div style={{ fontSize: 13, color: t.warn, marginTop: 8 }}>{odometerProblem}</div>
              )}
              {isIn && prevClosing !== null && !odometerProblem && (
                <div style={{ fontSize: 13, color: t.text3, marginTop: 8 }}>
                  You finished your last day on {prevClosing} km.
                </div>
              )}
              {distance !== null && !odometerProblem && (
                <div style={{ fontSize: 13, color: t.text3, marginTop: 8 }}>
                  That is {distance} km today.
                </div>
              )}
            </div>

            <div>
              <div style={{ marginBottom: 10 }}><Eyebrow>Photo of the meter</Eyebrow></div>
              {photoUrl ? (
                <div>
                  <img src={photoUrl} alt="Odometer"
                    style={{ width: '100%', maxWidth: 300, borderRadius: 6, display: 'block', border: `0.5px solid ${t.border}` }} />
                  <div style={{ marginTop: 10 }}><GhostButton onClick={takePhoto}>Retake</GhostButton></div>
                </div>
              ) : (
                <div>
                  <GhostButton onClick={takePhoto}>Take the photo</GhostButton>
                  <div style={{ fontSize: 13, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
                    The reading has to be legible in the photo.
                    {/* Said here rather than discovered later. The app build
                        opens a camera with no gallery behind it; the web app
                        cannot, so what it takes is a file and is recorded as
                        one. A rep should know which of the two they are
                        giving before they give it. */}
                    {!cameraIsVerifiable() && (
                      <div style={{ marginTop: 6 }}>
                        You are on the web app, which can only attach a file — so this
                        photo is stored as unverified and your manager sees it that way.
                        The Android app takes it straight from the camera.
                      </div>
                    )}
                  </div>
                </div>
              )}
              {photoError && <div style={{ fontSize: 13, color: t.warn, marginTop: 8 }}>{photoError}</div>}
            </div>

            {/* Escape hatch when the meter worked this morning but not now */}
            {!isIn && (
              <button className="oc-action" onClick={() => { setMeterUnreadable(true); setPhoto(null); setPhotoUrl(null) }}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: t.text2, cursor: 'pointer', textAlign: 'left' }}>
                I cannot read the meter now
              </button>
            )}
          </>
        )}

        {/* Why there is no reading */}
        {noteNeeded && (
          <div>
            <div style={{ marginBottom: 10 }}>
              <Eyebrow>{isIn ? 'Tell us why' : 'What happened to the meter?'}</Eyebrow>
            </div>
            <textarea rows={2} value={note}
              onChange={e => { meterTouched.current = true; setNote(e.target.value) }}
              placeholder={odoStatus === 'no_vehicle' && isIn
                ? 'How are you travelling today?'
                : 'A short note about the meter'}
              style={{ ...inputStyle(t), resize: 'none' }} />
            {!isIn && meterUnreadable && (
              <button className="oc-action" onClick={() => { setMeterUnreadable(false); setNote('') }}
                style={{ background: 'none', border: 'none', padding: 0, marginTop: 10, fontSize: 13, color: t.text2, cursor: 'pointer' }}>
                Actually, I can read it
              </button>
            )}
          </div>
        )}

        {/* Submit */}
        <div>
          <PrimaryButton onClick={submit} disabled={!ready} style={{ width: '100%' }}>
            {saving ? (isIn ? 'Starting…' : 'Finishing…') : (isIn ? 'Start the day' : 'End the day')}
          </PrimaryButton>
          {!ready && !saving && (
            <div style={{ fontSize: 13, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
              {!noteOk ? 'Add a short note about the meter.'
                : !kmValid || odometerProblem ? 'Enter the meter reading.'
                : 'Take the photo of the meter.'}
            </div>
          )}
          {saveError && <div style={{ fontSize: 13, color: t.warn, marginTop: 10 }}>{saveError}</div>}
        </div>
      </div>
      {confirmModal}
    </div>
  )
}
