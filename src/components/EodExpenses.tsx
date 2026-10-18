import { useEffect, useState } from 'react'
import { AppUser, AllowanceType, DutySession } from '../types'
import { useTheme } from '../context/ThemeContext'
import {
  DayContext, ProposedLine, loadDayContext, addDayExpenses, allowanceForKm,
  weekIsOpen, round2, needsMeterReason, ABOVE_METER_MIN_REASON,
} from '../data/expenses'
import { Field, Note, PrimaryButton, GhostButton, ChipGroup, inputStyle } from './ui'

interface Props {
  appUser: AppUser
  /** Today's session, already closed. */
  session: DutySession
  date: string
  /** The expense sheet, on today, for anything this card does not cover. */
  onOpenExpenses: () => void
}

const BANDS: AllowanceType[] = ['HQ', 'EX', 'OS']
const BAND_LABEL: Record<AllowanceType, string> = { HQ: 'HQ', EX: 'EX', OS: 'OS · stayed over' }

/**
 * The day's expenses, worked out at the end of it — proposed, never filed.
 *
 * The day has already recorded most of what a claim needs: the distance on the
 * meter, which allowance that distance points at, and the rate fuel is paid
 * at. Asking the rep to type those again is asking for the one number that
 * should come from the meter to come from memory instead.
 *
 * Proposed rather than written, because an expense is a claim made in the
 * rep's name. Entries that appeared on their sheet without them agreeing to it
 * would be the app's claim, and the first one that was wrong would be the
 * app's mistake with their name on it. One tap to accept keeps it as fast as
 * filing automatically and keeps it theirs.
 *
 * It is a head start, not the whole claim. Bus fares, food and anything else
 * are recorded nowhere until somebody types them, which is what the button to
 * the sheet is for.
 */
export default function EodExpenses({ appUser, session, date, onOpenExpenses }: Props) {
  const { t } = useTheme()
  const [ctx, setCtx] = useState<DayContext | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [band, setBand] = useState<AllowanceType | null>(null)
  const [takeAllowance, setTakeAllowance] = useState(true)
  const [fuelKm, setFuelKm] = useState('')
  const [takeFuel, setTakeFuel] = useState(true)
  const [reason, setReason] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<number | null>(null)

  const meterKm = typeof session.claimedDistanceKm === 'number' ? session.claimedDistanceKm : null
  const suggested = allowanceForKm(meterKm)

  useEffect(() => {
    let live = true
    loadDayContext(appUser.uid, date)
      .then(c => {
        if (!live) return
        setCtx(c)
        // Opens on what the meter points at. With no meter reading it opens on
        // nothing rather than on the cheapest band — guessing would file HQ
        // against somebody who spent the day on a bus, which is the app quietly
        // underpaying them in their own name.
        setBand(suggested)
        if (meterKm !== null) setFuelKm(String(meterKm))
      })
      .catch(e => live && setLoadError(e?.code === 'permission-denied'
        ? 'Firestore turned down the read. The deployed rules may be older than this build.'
        : 'Could not work out today’s expenses.'))
    return () => { live = false }
  }, [appUser.uid, date, meterKm, suggested])

  if (loadError) return <Note tone="warn">{loadError}</Note>
  if (!ctx) return null

  const rate = ctx.config.ratePerKm && ctx.config.ratePerKm > 0 ? ctx.config.ratePerKm : null
  const hasAllowance = ctx.entries.some(e => e.type === 'allowance')
  const hasFuel = ctx.entries.some(e => e.type === 'variable' && e.category === 'fuel')
  const open = weekIsOpen(ctx.report)

  // What there is still to propose. Something already on the week for today is
  // not offered a second time — a day has one allowance, and a fuel claim
  // proposed twice is a fuel claim paid twice.
  const offerAllowance = !hasAllowance
  const offerFuel = !hasFuel && rate !== null && meterKm !== null

  const km = Number(fuelKm)
  const kmValid = fuelKm.trim() !== '' && Number.isFinite(km) && km > 0
  const fuelAmount = kmValid && rate ? round2(km * rate) : 0
  const allowanceAmount = band ? ctx.config[band.toLowerCase() as 'hq' | 'ex' | 'os'] : 0
  const over = kmValid && needsMeterReason(km, meterKm)

  const total = round2(
    (offerAllowance && takeAllowance && band ? allowanceAmount : 0)
    + (offerFuel && takeFuel && kmValid ? fuelAmount : 0))

  const card = (children: React.ReactNode) => (
    <div style={{ border: `0.5px solid ${t.border2}`, borderRadius: 6, padding: '14px 16px' }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: t.text, marginBottom: 4 }}>
        Today&rsquo;s expenses
      </div>
      {children}
    </div>
  )

  // ── already done ──────────────────────────────────────────────────────────
  if (added !== null) {
    return card(
      <>
        <div style={{ fontSize: 13, color: t.text2, lineHeight: 1.55 }}>
          &#8377;{added.toLocaleString('en-IN')} added to this week. Anything else you spent
          today — a bus fare, food — goes on the sheet.
        </div>
        <div style={{ marginTop: 12 }}>
          <GhostButton onClick={onOpenExpenses}>Open today on the sheet</GhostButton>
        </div>
      </>,
    )
  }

  if (!open) {
    return card(
      <>
        <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.55 }}>
          This week has already been {ctx.report?.status === 'cleared' ? 'cleared' : 'submitted'},
          so today cannot be added to it.
          {ctx.report?.status === 'submitted'
            ? ' If something is missing, ask for it to be sent back.'
            : ''}
        </div>
      </>,
    )
  }

  if (!offerAllowance && !offerFuel) {
    // Either it is all on the week already, or there is nothing the day could
    // work out on its own. Each is said, because a card that silently does
    // nothing reads as a card that is broken.
    const reasons: string[] = []
    if (hasAllowance && hasFuel) reasons.push('Today’s allowance and fuel are already on this week.')
    else if (hasAllowance) reasons.push('Today’s allowance is already on this week.')
    if (!hasFuel && meterKm === null) {
      reasons.push('There was no meter reading today, so the fuel could not be worked out.')
    } else if (!hasFuel && rate === null) {
      reasons.push('No ₹ per km rate has been set, so fuel is entered by hand on the sheet.')
    }
    return card(
      <>
        <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.55 }}>{reasons.join(' ')}</div>
        <div style={{ marginTop: 12 }}>
          <GhostButton onClick={onOpenExpenses}>Add an expense</GhostButton>
        </div>
      </>,
    )
  }

  const submit = async () => {
    const lines: ProposedLine[] = []
    if (offerAllowance && takeAllowance) {
      if (!band) { setError('Pick which allowance today was.'); return }
      lines.push({
        kind: 'allowance', allowanceType: band, amount: allowanceAmount,
        ...(meterKm !== null && suggested ? { meterKm, suggested } : {}),
      })
    }
    if (offerFuel && takeFuel) {
      if (!kmValid) { setError('Enter how many kilometres you are claiming for fuel.'); return }
      if (over && reason.trim().length < ABOVE_METER_MIN_REASON) {
        setError(`That is more than the ${meterKm} km on the meter — say why, and it goes with the claim.`)
        return
      }
      lines.push({
        kind: 'fuel', km, rate: rate!, amount: fuelAmount,
        ...(meterKm !== null ? { meterKm } : {}),
        ...(over ? { aboveMeterReason: reason.trim() } : {}),
      })
    }
    if (lines.length === 0) { setError('Nothing is ticked to add.'); return }

    setError(null)
    setSaving(true)
    try {
      setAdded(await addDayExpenses(appUser, date, session.id, lines, ctx.report))
    } catch (e: any) {
      setError(e?.code === 'permission-denied'
        ? 'Firestore refused that. This week may have been submitted in the meantime.'
        : e?.message || 'Could not add them.')
    } finally { setSaving(false) }
  }

  const tick = (on: boolean, flip: () => void, label: string) => (
    <button className="oc-action" onClick={flip} aria-pressed={on} aria-label={label}
      style={{
        width: 20, height: 20, flexShrink: 0, padding: 0, borderRadius: 4, cursor: 'pointer',
        border: `0.5px solid ${on ? t.text2 : t.border2}`,
        background: on ? t.text2 : 'transparent', color: t.bg, fontSize: 13, lineHeight: 1,
      }}>
      {on ? '✓' : ''}
    </button>
  )

  return card(
    <>
      <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.55, marginBottom: 14 }}>
        {meterKm !== null
          ? `Worked out from the ${meterKm} km on your meter. Check it, change what was different, and add it to this week.`
          : 'There was no meter reading today, so only the allowance can be offered — pick which one it was.'}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {offerAllowance && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {tick(takeAllowance, () => setTakeAllowance(v => !v), 'Include the allowance')}
            <div style={{ flex: 1, minWidth: 0, opacity: takeAllowance ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span style={{ flex: 1, fontSize: 14, color: t.text }}>Daily allowance</span>
                <span style={{ fontSize: 14, color: t.text }}>
                  {band ? `₹${allowanceAmount.toLocaleString('en-IN')}` : '—'}
                </span>
              </div>
              <ChipGroup
                value={(band ?? '') as AllowanceType}
                onChange={(b: AllowanceType) => setBand(b)}
                options={BANDS.map(b => ({ id: b, label: BAND_LABEL[b] }))}
              />
              {suggested && band && band !== suggested && (
                <div style={{ fontSize: 12, color: t.text3, marginTop: 6 }}>
                  The meter points at {suggested}. Both are kept on the claim.
                </div>
              )}
            </div>
          </div>
        )}

        {offerFuel && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            {tick(takeFuel, () => setTakeFuel(v => !v), 'Include the fuel')}
            <div style={{ flex: 1, minWidth: 0, opacity: takeFuel ? 1 : 0.5 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <span style={{ flex: 1, fontSize: 14, color: t.text }}>Fuel</span>
                <span style={{ fontSize: 14, color: t.text }}>
                  {kmValid ? `₹${fuelAmount.toLocaleString('en-IN')}` : '—'}
                </span>
              </div>
              <Field label="Kilometres"
                hint={`At ₹${rate} per km. The meter says ${meterKm} km.`}>
                <input type="number" inputMode="decimal" min={0}
                  aria-label="Fuel kilometres"
                  value={fuelKm}
                  onChange={e => setFuelKm(e.target.value)}
                  style={inputStyle(t)} />
              </Field>
              {/* Below the meter is nobody's concern. Above it is the one
                  thing the odometer cannot vouch for, so it is the one thing
                  that needs a sentence — and the sentence travels with the
                  claim to whoever clears it. */}
              {over && (
                <div style={{ marginTop: 10 }}>
                  <Field label={`Why more than the ${meterKm} km on the meter?`}
                    hint="Goes with the claim to whoever clears the week.">
                    <input
                      aria-label="Reason for claiming above the meter"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Meter reset at the garage · second vehicle in the afternoon"
                      style={inputStyle(t)} />
                  </Field>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {error && <div style={{ marginTop: 12 }}><Note tone="warn">{error}</Note></div>}

      <div className="oc-wrap" style={{ gap: 10, marginTop: 16, alignItems: 'center' }}>
        <PrimaryButton onClick={submit} disabled={saving || total === 0}>
          {saving ? 'Adding…' : total > 0
            ? `Add ₹${total.toLocaleString('en-IN')} to this week`
            : 'Add to this week'}
        </PrimaryButton>
        <GhostButton onClick={onOpenExpenses}>Another expense</GhostButton>
      </div>
    </>,
  )
}
