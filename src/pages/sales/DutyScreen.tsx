import { useState, useEffect, useRef } from 'react'
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { AppUser, DutySession, GeoPoint } from '../../types'
import { useTheme } from '../../context/ThemeContext'
import { PageHeader, Eyebrow, GhostButton, PrimaryButton, inputStyle } from '../../components/ui'
import { getFix, LocationError } from '../../device/location'
import { capture, upload, CapturedPhoto } from '../../device/photo'
import { batteryPercent } from '../../device/battery'
import { lastClosingOdometer } from '../../hooks/useDutySession'
import { localDateStr } from '../../utils/date'

interface Props {
  appUser: AppUser
  session: DutySession | null
  onBack: () => void
}

type Mode = 'punch_in' | 'punch_out' | 'done'

export default function DutyScreen({ appUser, session, onBack }: Props) {
  const { t } = useTheme()

  const mode: Mode = !session ? 'punch_in' : session.status === 'active' ? 'punch_out' : 'done'

  // ── shared capture state ──────────────────────────────────────────────────
  const [fix, setFix] = useState<GeoPoint | null>(null)
  const [fixError, setFixError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)

  const [odometer, setOdometer] = useState('')
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)

  const [prevClosing, setPrevClosing] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const objectUrl = useRef<string | null>(null)

  // Get a fix as soon as the screen opens — it is the slowest step.
  useEffect(() => { void locate() }, [])

  useEffect(() => {
    if (mode !== 'punch_in') return
    lastClosingOdometer(appUser.uid, localDateStr()).then(setPrevClosing)
  }, [mode, appUser.uid])

  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current) }, [])

  async function locate() {
    setLocating(true)
    setFixError(null)
    try {
      setFix(await getFix({ capturedBy: appUser.uid }))
    } catch (e) {
      setFix(null)
      setFixError(e instanceof LocationError ? e.message : 'Could not get your location.')
    } finally {
      setLocating(false)
    }
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

  // ── validation ────────────────────────────────────────────────────────────
  const km = parseFloat(odometer)
  const kmValid = !isNaN(km) && km >= 0

  const odometerProblem = (() => {
    if (odometer.trim() === '') return null
    if (!kmValid) return 'Enter the reading as a number.'
    if (mode === 'punch_in' && prevClosing !== null && km < prevClosing)
      return `Lower than your last closing reading of ${prevClosing} km.`
    if (mode === 'punch_out' && session && km <= session.startOdometerKm)
      return `Must be more than this morning's ${session.startOdometerKm} km.`
    return null
  })()

  const ready = !!fix && kmValid && !odometerProblem && !!photo && !saving

  const distance = mode === 'punch_out' && session && kmValid
    ? Math.max(0, km - session.startOdometerKm)
    : null

  // ── submit ────────────────────────────────────────────────────────────────
  async function submit() {
    if (!ready || !fix || !photo) return
    setSaving(true)
    setSaveError(null)
    try {
      const battery = await batteryPercent()

      if (mode === 'punch_in') {
        // Mint the id first so the photo can be filed under the session it belongs to.
        const sessionRef = doc(collection(db, 'duty_sessions'))
        const path = await upload(photo, {
          uid: appUser.uid, sessionId: sessionRef.id, kind: 'odometer_start',
        })
        const payload: Omit<DutySession, 'id'> = {
          uid: appUser.uid,
          name: appUser.name,
          date: localDateStr(),
          startAt: Date.now(),
          startLocation: fix,
          startOdometerKm: km,
          startOdometerPhoto: path,
          ...(battery !== undefined ? { startBatteryPct: battery } : {}),
          status: 'active',
          createdAt: Date.now(),
        }
        await setDoc(sessionRef, payload)
      } else if (session?.id) {
        const path = await upload(photo, {
          uid: appUser.uid, sessionId: session.id, kind: 'odometer_end',
        })
        await updateDoc(doc(db, 'duty_sessions', session.id), {
          endAt: Date.now(),
          endLocation: fix,
          endOdometerKm: km,
          endOdometerPhoto: path,
          ...(battery !== undefined ? { endBatteryPct: battery } : {}),
          claimedDistanceKm: km - session.startOdometerKm,
          status: 'closed',
        })
      }
      onBack()
    } catch (e: any) {
      console.error('[DutyScreen] submit failed', e)
      setSaveError(
        e?.code === 'permission-denied'
          ? 'Firestore rejected this. Your account may not be approved yet.'
          : e?.message || 'Could not save. Please try again.',
      )
    } finally {
      setSaving(false)
    }
  }

  // ── day already finished ──────────────────────────────────────────────────
  if (mode === 'done' && session) {
    return (
      <div style={{ minHeight: '100vh', background: t.bg }}>
        <PageHeader eyebrow="Duty" title="Your day is finished" onBack={onBack}
          subtitle={`Punched out at ${new Date(session.endAt!).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.`} />
        <div style={{ padding: '24px 20px' }}>
          <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
            {([
              ['Started', new Date(session.startAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })],
              ['Opening reading', `${session.startOdometerKm} km`],
              ['Closing reading', `${session.endOdometerKm} km`],
              ['Distance', `${session.claimedDistanceKm} km`],
            ] as [string, string][]).map(([label, value]) => (
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

  const isIn = mode === 'punch_in'

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Duty"
        title={isIn ? 'Start your day' : 'End your day'}
        subtitle={isIn
          ? 'Your outlet list unlocks once this is done.'
          : 'Record the closing reading to finish the day.'}
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 26 }}>

        {/* 1 — Location */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Location</Eyebrow></div>
          {locating ? (
            <div style={{ fontSize: 14, color: t.text3 }}>Finding your location…</div>
          ) : fix ? (
            <div style={{ fontSize: 14, color: t.text }}>
              Locked in, accurate to about {Math.round(fix.accuracy)} m.
              <div style={{ fontSize: 12, color: t.text3, marginTop: 3 }}>
                {fix.lat.toFixed(5)}, {fix.lng.toFixed(5)}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize: 14, color: t.warn, marginBottom: 12 }}>{fixError}</div>
              <GhostButton onClick={locate}>Try again</GhostButton>
            </div>
          )}
        </div>

        {/* 2 — Odometer */}
        <div>
          <div style={{ marginBottom: 10 }}>
            <Eyebrow>{isIn ? 'Opening reading' : 'Closing reading'}</Eyebrow>
          </div>
          <input
            type="number"
            inputMode="decimal"
            value={odometer}
            onChange={e => setOdometer(e.target.value)}
            placeholder="Kilometres on the meter"
            style={inputStyle(t)}
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

        {/* 3 — Meter photo */}
        <div>
          <div style={{ marginBottom: 10 }}><Eyebrow>Photo of the meter</Eyebrow></div>
          {photoUrl ? (
            <div>
              <img
                src={photoUrl}
                alt="Odometer"
                style={{ width: '100%', maxWidth: 300, borderRadius: 6, display: 'block', border: `0.5px solid ${t.border}` }}
              />
              <div style={{ marginTop: 10 }}>
                <GhostButton onClick={takePhoto}>Retake</GhostButton>
              </div>
            </div>
          ) : (
            <div>
              <GhostButton onClick={takePhoto}>Take the photo</GhostButton>
              <div style={{ fontSize: 13, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
                The reading has to be legible in the photo.
              </div>
            </div>
          )}
          {photoError && (
            <div style={{ fontSize: 13, color: t.warn, marginTop: 8 }}>{photoError}</div>
          )}
        </div>

        {/* Submit */}
        <div>
          <PrimaryButton onClick={submit} disabled={!ready} style={{ width: '100%' }}>
            {saving
              ? (isIn ? 'Starting…' : 'Finishing…')
              : (isIn ? 'Start the day' : 'End the day')}
          </PrimaryButton>
          {!ready && !saving && (
            <div style={{ fontSize: 13, color: t.text3, marginTop: 10, lineHeight: 1.6 }}>
              {!fix ? 'Waiting for your location.'
                : !kmValid || odometerProblem ? 'Enter the meter reading.'
                : 'Take the photo of the meter.'}
            </div>
          )}
          {saveError && (
            <div style={{ fontSize: 13, color: t.warn, marginTop: 10 }}>{saveError}</div>
          )}
        </div>
      </div>
    </div>
  )
}
