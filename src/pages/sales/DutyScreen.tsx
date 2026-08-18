import { useState, useEffect, useRef } from 'react'
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import {
  AppUser, DutySession, GeoPoint,
  OdometerStatus, ODOMETER_STATUS_LABEL,
} from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { PageHeader, Eyebrow, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'
import { getFixOrNull } from '../../device/location'
import { capture, upload, CapturedPhoto } from '../../device/photo'
import { batteryPercent } from '../../device/battery'
import { lastClosingOdometer } from '../../hooks/useDutySession'
import { scheduleEndOfDayReminder, cancelEndOfDayReminder } from '../../device/notify'
import { localDateStr } from '../../utils/date'

interface Props {
  appUser: AppUser
  session: DutySession | null
  onBack: () => void
}

type Mode = 'punch_in' | 'punch_out' | 'done'

const MIN_NOTE = 5

export default function DutyScreen({ appUser, session, onBack }: Props) {
  const { t } = useTheme()

  const mode: Mode = !session ? 'punch_in' : session.status === 'active' ? 'punch_out' : 'done'
  const isIn = mode === 'punch_in'

  // Location is captured in the background and never blocks anything.
  const [fix, setFix] = useState<GeoPoint | null>(null)
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
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const objectUrl = useRef<string | null>(null)

  useEffect(() => { void locate() }, [])

  useEffect(() => {
    if (!isIn) return
    lastClosingOdometer(appUser.uid, localDateStr()).then(setPrevClosing)
  }, [isIn, appUser.uid])

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])

  async function locate() {
    setLocating(true)
    setFix(await getFixOrNull({ capturedBy: appUser.uid }))
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
    if (!ready) return
    setSaving(true)
    setSaveError(null)
    try {
      const battery = await batteryPercent()

      if (isIn) {
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
          ...(fix ? { startLocation: fix } : {}),
          odometerStatus: odoStatus,
          ...(needsReading ? { startOdometerKm: km } : {}),
          ...(photoPath ? { startOdometerPhoto: photoPath } : {}),
          ...(noMeterReading ? { odometerIssueNote: note.trim() } : {}),
          ...(battery !== undefined ? { startBatteryPct: battery } : {}),
          status: 'active',
          createdAt: Date.now(),
        }
        await setDoc(sessionRef, payload)
        // Only once the day exists. Scheduling before the write would leave a
        // reminder for a day that failed to start.
        void scheduleEndOfDayReminder()
      } else if (session?.id) {
        const photoPath = needsReading && photo
          ? await upload(photo, { uid: appUser.uid, sessionId: session.id, kind: 'odometer_end' })
          : undefined

        await updateDoc(doc(db, 'duty_sessions', session.id), {
          endAt: Date.now(),
          ...(fix ? { endLocation: fix } : {}),
          ...(needsReading ? { endOdometerKm: km } : {}),
          ...(photoPath ? { endOdometerPhoto: photoPath } : {}),
          ...(meterUnreadable ? { endOdometerIssueNote: note.trim() } : {}),
          ...(battery !== undefined ? { endBatteryPct: battery } : {}),
          ...(distance !== null ? { claimedDistanceKm: distance } : {}),
          status: 'closed',
        })
        void cancelEndOfDayReminder()
      }
      onBack()
    } catch (e: any) {
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
      <div style={{ minHeight: '100vh', background: t.bg }}>
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

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
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
            <div>
              <div style={{ fontSize: 14, color: t.text3, marginBottom: 10, lineHeight: 1.6 }}>
                No location available. That is fine — you can carry on, and the day
                will simply be recorded without one.
              </div>
              <GhostButton onClick={locate}>Try again</GhostButton>
            </div>
          )}
        </div>

        {/* Meter status — only asked at the start of the day */}
        {isIn && (
          <div>
            <div style={{ marginBottom: 10 }}><Eyebrow>Your vehicle meter</Eyebrow></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(Object.keys(ODOMETER_STATUS_LABEL) as OdometerStatus[]).map(s => (
                <button key={s} className="oc-action" onClick={() => setOdoStatus(s)}
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
            <textarea rows={2} value={note} onChange={e => setNote(e.target.value)}
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
    </div>
  )
}
