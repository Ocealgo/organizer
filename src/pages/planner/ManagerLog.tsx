import { useState, useEffect, useMemo } from 'react'
import { collection, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore'
import { onSnapshot } from '../../data/live'
import { db } from '../../firebase'
import {
  AppUser, Party, ManagerActivity, ManagerActivityKind, MANAGER_ACTIVITY_LABEL,
} from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useConfirm } from '../../hooks/useConfirm'
import { isAdminRole } from '../../auth/permissions'
import CustomSelect from '../../components/CustomSelect'
import DateInput from '../../components/DateInput'
import {
  PageHeader, Section, Field, Note, EmptyState, Eyebrow,
  ChipGroup, GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'
import { localDateStr } from '../../utils/date'

interface Props { onBack: () => void }

const longDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'long', day: 'numeric', month: 'short' })

function addDays(d: string, n: number): string {
  const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return localDateStr(x)
}

/**
 * What a manager did.
 *
 * Deliberately only the parts nothing else records. The app already knows who
 * assigned the week, approved the leave, confirmed the money and dispatched the
 * stock — every one of those stamps its actor. Asking for those again is how a
 * log turns into fiction: people stop filling in what the system plainly
 * already has, and then the whole thing is half-true, which is worse than
 * empty.
 *
 * So three things, and only three. A meeting leaves no trace anywhere. A day
 * out with a rep records the visits but never who was being coached. And a day
 * at the desk produces nothing at all.
 *
 * A manager sees today, so they do not log the same meeting twice and can fix a
 * typo. Everything else — other people, other days — is an admin's.
 */
export default function ManagerLog({ onBack }: Props) {
  const { t } = useTheme()
  const { appUser } = useAuth()
  const { modal, showConfirm } = useConfirm()

  const isAdmin = isAdminRole(appUser)
  const today = localDateStr()

  const [entries, setEntries] = useState<ManagerActivity[]>([])
  const [reps, setReps] = useState<AppUser[]>([])
  const [parties, setParties] = useState<Party[]>([])
  const [readError, setReadError] = useState<string | null>(null)
  /** uid → when they punched in today. Only these can be named in a meeting. */
  const [startedToday, setStartedToday] = useState<Map<string, number>>(new Map())

  // Admin view: a window and a person.
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [who, setWho] = useState('')

  // The form.
  const [kind, setKind] = useState<ManagerActivityKind>('meeting')
  const [title, setTitle] = useState('')
  const [withUids, setWithUids] = useState<string[]>([])
  const [partyId, setPartyId] = useState('')
  const [minutes, setMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<string | null>(null)

  useEffect(() => {
    const u1 = onSnapshot(collection(db, 'users'), s =>
      setReps(s.docs.map(d => ({ uid: d.id, ...d.data() } as AppUser))
        .filter(u => u.status === 'approved'
          && (u.role === 'offline_sales' || u.role === 'online_sales'))
        .sort((a, b) => a.name.localeCompare(b.name))))
    const u2 = onSnapshot(collection(db, 'parties'), s =>
      setParties(s.docs.map(d => ({ id: d.id, ...d.data() } as Party))))
    /**
     * Who has actually started today.
     *
     * Only they can be named in a meeting. It means somebody has to punch in
     * before they can be recorded as attending — so a rep at a nine o'clock
     * meeting has to start their day first, which is worth telling them once
     * rather than leaving managers to discover the list is empty.
     */
    const u3 = onSnapshot(
      query(collection(db, 'duty_sessions'), where('date', '==', localDateStr())),
      s => setStartedToday(new Map(s.docs.map(d => {
        const v = d.data() as { uid: string; startAt: number }
        return [v.uid, v.startAt]
      }))),
      () => setStartedToday(new Map()),
    )
    return () => { u1(); u2(); u3() }
  }, [])

  useEffect(() => {
    if (!appUser) return
    setReadError(null)
    // A manager asks only for their own, which is the shape their rule allows.
    // An admin asks by date, which the standalone admin branch answers.
    const q = isAdmin
      ? query(collection(db, 'manager_activities'),
          where('date', '>=', from), where('date', '<=', to))
      : query(collection(db, 'manager_activities'), where('uid', '==', appUser.uid))
    return onSnapshot(q,
      s => setEntries(s.docs.map(d => ({ id: d.id, ...d.data() } as ManagerActivity))),
      err => setReadError(err?.code === 'permission-denied'
        ? 'Firestore turned down the read. The deployed rules may be older than this build.'
        : 'Could not load the log.'),
    )
  }, [appUser, isAdmin, from, to])

  const mine = useMemo(
    () => entries.filter(e => e.uid === appUser?.uid && e.date === today)
      .sort((a, b) => b.createdAt - a.createdAt),
    [entries, appUser, today],
  )

  const forAdmin = useMemo(() => {
    const rows = who ? entries.filter(e => e.uid === who) : entries
    const byDay = new Map<string, ManagerActivity[]>()
    rows.forEach(e => {
      if (!byDay.has(e.date)) byDay.set(e.date, [])
      byDay.get(e.date)!.push(e)
    })
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries, who])

  const managers = useMemo(() => {
    const seen = new Map<string, string>()
    entries.forEach(e => seen.set(e.uid, e.name))
    return [...seen.entries()].map(([uid, name]) => ({ value: uid, label: name }))
  }, [entries])

  /**
   * Only people who have started their day can be named.
   *
   * It means a rep at a nine o'clock meeting has to punch in before the meeting
   * can be recorded against them — worth knowing, because the alternative
   * reading is that the list is broken. The form says so when it is empty.
   */
  const startedReps = useMemo(
    () => reps.filter(r => startedToday.has(r.uid)),
    [reps, startedToday],
  )

  const reset = () => {
    setEditingId(null); setKind('meeting'); setTitle('')
    setWithUids([]); setPartyId(''); setMinutes(''); setNotes(''); setBlocked(null)
  }

  const openEdit = (e: ManagerActivity) => {
    setEditingId(e.id!); setKind(e.kind); setTitle(e.title)
    setWithUids(e.withUids ?? []); setPartyId(e.partyId ?? '')
    setMinutes(e.minutes?.toString() ?? ''); setNotes(e.notes ?? ''); setBlocked(null)
  }

  const save = async () => {
    if (!appUser) return
    if (!title.trim()) { setBlocked('Say what it was — a few words is enough.'); return }
    if (kind === 'joint_field' && withUids.length === 0) {
      // The whole point of this kind is which rep was being coached.
      setBlocked('Choose who you were out with.')
      return
    }
    setBlocked(null); setSaving(true)
    try {
      const party = parties.find(p => p.id === partyId)
      const payload = {
        uid: appUser.uid,
        name: appUser.name,
        date: today,
        kind,
        title: title.trim(),
        // Always written, empty array included. The rule that lets a rep read a
        // meeting they were at checks membership of this field, and a rule
        // cannot check a field that is sometimes absent.
        withUids,
        withNames: withUids.map(u => reps.find(r => r.uid === u)?.name ?? ''),
        ...(party ? { partyId: party.id, partyName: party.name } : {}),
        ...(minutes.trim() ? { minutes: Number(minutes) } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }
      if (editingId) {
        await updateDoc(doc(db, 'manager_activities', editingId), {
          ...payload, updatedAt: Date.now(),
        })
      } else {
        await addDoc(collection(db, 'manager_activities'), { ...payload, createdAt: Date.now() })
      }
      reset()
    } catch (e: any) {
      setBlocked(e?.code === 'permission-denied'
        ? 'Firestore refused that. Only a sales manager can log their own day.'
        : e?.message || 'Could not save it.')
    } finally { setSaving(false) }
  }

  const remove = async (e: ManagerActivity) => {
    const ok = await showConfirm('Delete this entry?', `${e.title} — ${longDay(e.date)}.`, 'Delete')
    if (!ok) return
    await deleteDoc(doc(db, 'manager_activities', e.id!))
  }

  const line = (e: ManagerActivity) => [
    MANAGER_ACTIVITY_LABEL[e.kind],
    e.withNames?.length ? e.withNames.join(', ') : null,
    e.partyName,
    e.minutes ? `${e.minutes} min` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      {modal}
      <PageHeader
        eyebrow={isAdmin ? 'Reports' : 'My day'}
        title={isAdmin ? 'Manager activity' : 'What I did today'}
        subtitle={isAdmin
          ? 'Meetings, days out with a rep, and desk days.'
          : 'Only the parts the app cannot see for itself.'}
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
        {readError && <Note tone="warn">{readError}</Note>}

        {/* ── A MANAGER'S OWN DAY ─────────────────────────────────────────── */}
        {!isAdmin && (
          <>
            <Note>
              Approvals, dispatches, the week you assigned and the money you confirmed are
              already recorded against your name — no need to write those here. This is for
              what nothing else sees.
            </Note>

            <Section label={editingId ? 'Edit this entry' : 'Log something'}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Field label="What kind">
                  <ChipGroup
                    value={kind}
                    onChange={(k: ManagerActivityKind) => { setKind(k); setBlocked(null) }}
                    options={(['meeting', 'joint_field', 'office'] as ManagerActivityKind[])
                      .map(k => ({ id: k, label: MANAGER_ACTIVITY_LABEL[k] }))}
                  />
                </Field>

                <Field label="What was it"
                  hint={kind === 'meeting' ? 'Team review · month-end planning · distributor call'
                    : kind === 'joint_field' ? 'Beach Road with Sanjay'
                    : 'Depot — month end'}>
                  <input value={title} onChange={e => setTitle(e.target.value)}
                    placeholder={kind === 'office' ? 'Depot — month end' : 'Team review'}
                    style={inputStyle(t)} />
                </Field>

                {kind !== 'office' && (
                  <Field
                    label={kind === 'joint_field' ? 'Who you were out with' : `Who was there · ${withUids.length}`}
                    hint={(kind === 'joint_field'
                      ? 'Required — this is the part the visits do not record. '
                      : 'Optional. ')
                      + 'Only people who have started their day today can be named.'}
                  >
                    {startedReps.length === 0 ? (
                      <Note tone="warn">
                        Nobody has started their day yet, so there is nobody to name. A rep has
                        to punch in before they can be recorded as being somewhere — ask them to
                        start their day and this fills in.
                      </Note>
                    ) : (
                      <CustomSelect
                        values={withUids}
                        onToggle={(uid: string) => setWithUids(prev =>
                          prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid])}
                        value=""
                        onChange={() => {}}
                        options={startedReps.map(r => ({
                          value: r.uid,
                          label: r.name,
                          sub: `started ${new Date(startedToday.get(r.uid)!)
                            .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
                        }))}
                        placeholder="Choose reps"
                      />
                    )}
                  </Field>
                )}

                {kind === 'meeting' && (
                  <Field label="With a distributor or retailer" hint="Optional — for a meeting at a party rather than with the team.">
                    <CustomSelect
                      value={partyId}
                      onChange={setPartyId}
                      options={[
                        { value: '', label: 'Nobody in particular' },
                        ...parties
                          .slice()
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(p => ({ value: p.id!, label: p.name, sub: p.place })),
                      ]}
                      placeholder="Nobody in particular"
                    />
                  </Field>
                )}

                <Field label="How long" hint="Minutes. Optional — some things are not worth timing.">
                  <input type="number" inputMode="numeric" value={minutes}
                    onChange={e => setMinutes(e.target.value)}
                    placeholder="45" style={inputStyle(t)} />
                </Field>

                <Field label="Notes" hint="What came of it. Optional.">
                  <textarea value={notes} onChange={e => setNotes(e.target.value)}
                    rows={3} placeholder="Agreed the Onam scheme targets · Ravi to chase Anand Stores"
                    style={{ ...inputStyle(t), resize: 'vertical', lineHeight: 1.5 }} />
                </Field>

                {blocked && <Note tone="warn">{blocked}</Note>}

                <div className="oc-wrap" style={{ gap: 10 }}>
                  <PrimaryButton onClick={save} disabled={saving}>
                    {saving ? 'Saving…' : editingId ? 'Save changes' : 'Log it'}
                  </PrimaryButton>
                  {editingId && <GhostButton onClick={reset}>Cancel</GhostButton>}
                </div>
              </div>
            </Section>

            <Section label={`Today · ${mine.length} logged`}>
              {mine.length === 0 ? (
                <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>
                  Nothing logged yet today.
                </div>
              ) : (
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {mine.map(e => (
                    <div key={e.id} style={{
                      display: 'flex', alignItems: 'baseline', gap: 14,
                      borderTop: `0.5px solid ${t.border}`, padding: '13px 0',
                    }}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 14, color: t.text }}>{e.title}</span>
                        <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                          {line(e)}
                        </span>
                        {e.notes && (
                          <span style={{ display: 'block', fontSize: 12, color: t.text2, marginTop: 4, lineHeight: 1.5 }}>
                            {e.notes}
                          </span>
                        )}
                      </span>
                      <button className="oc-action" onClick={() => openEdit(e)}
                        style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button className="oc-action" onClick={() => remove(e)}
                        style={{ background: 'none', border: 'none', fontSize: 13, color: t.text3, cursor: 'pointer' }}>
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 12, color: t.text3, lineHeight: 1.6, marginTop: 12 }}>
                Earlier days are with the admin team. This shows today so you do not log the
                same meeting twice.
              </div>
            </Section>
          </>
        )}

        {/* ── AN ADMIN READING IT BACK ────────────────────────────────────── */}
        {isAdmin && (
          <>
            <div className="oc-wrap" style={{ gap: 16 }}>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="From"><DateInput type="date" value={from} onChange={setFrom} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 150 }}>
                <Field label="To"><DateInput type="date" value={to} onChange={setTo} /></Field>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <Field label="Who">
                  <CustomSelect
                    value={who}
                    onChange={setWho}
                    options={[{ value: '', label: 'Everybody' }, ...managers]}
                    placeholder="Everybody"
                  />
                </Field>
              </div>
            </div>

            {forAdmin.length === 0 ? (
              <EmptyState
                title="Nothing logged in this window"
                body="Managers log meetings, days out with a rep and desk days. Approvals and dispatches are recorded elsewhere, against their name."
              />
            ) : forAdmin.map(([date, rows]) => (
              <div key={date}>
                <div style={{ marginBottom: 10 }}><Eyebrow>{longDay(date)}</Eyebrow></div>
                <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
                  {rows
                    .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
                    .map(e => (
                      <div key={e.id} style={{
                        borderTop: `0.5px solid ${t.border}`, padding: '13px 0',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 14, color: t.text }}>
                              {e.name} — {e.title}
                            </span>
                            <span style={{ display: 'block', fontSize: 12, color: t.text3, marginTop: 2 }}>
                              {line(e)}
                              {e.updatedAt ? ' · edited' : ''}
                            </span>
                          </span>
                        </div>
                        {e.notes && (
                          <div style={{ fontSize: 12, color: t.text2, marginTop: 5, lineHeight: 1.6 }}>
                            {e.notes}
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
