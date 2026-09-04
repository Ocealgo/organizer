import { useState, useRef, useEffect, useMemo } from 'react'
import * as XLSX from 'xlsx'
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, SalesRoute, OutletType, PartyCategory, routePlaces } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import {
  PageHeader, Section, StatGrid, StatCard, Note, ChipGroup,
  GhostButton, PrimaryButton, EmptyState,
} from '../../components/ui'

interface Props { onBack: () => void }

/**
 * Import the beat sheet the office circulates.
 *
 * The file is two things at once — a list of shops and a definition of which
 * beat each belongs to — so this does both in one pass rather than making
 * somebody add fifty outlets by hand and then tick them into a beat.
 *
 * Nothing is written until the whole file has been read, matched against what
 * is already here, and shown. A spreadsheet that arrives over WhatsApp has
 * usually been edited by three people, and the moment to notice that is before
 * it becomes two hundred documents.
 */

/** One row of the sheet, after cleaning. */
interface Row {
  beat: string
  place: string
  code: string
  name: string
  address: string
  outletType: OutletType
  category: PartyCategory
  /** The party this row turned out to be, once matched. */
  matchedId?: string
  matchedBy?: 'code' | 'name'
}

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function cell(row: Record<string, unknown>, ...names: string[]): string {
  const wanted = names.map(normHeader)
  for (const [k, v] of Object.entries(row)) {
    if (wanted.includes(normHeader(k))) return String(v ?? '').trim()
  }
  return ''
}

/**
 * The name without the marks the sheet decorates it with.
 *
 * `#`, `*`, `**` and a leading `~` are the sheet-keeper's working notes and
 * mean nothing here. They are stripped from the stored name and, more
 * importantly, from the text used for matching — a shop that gains a `#` next
 * month is the same shop, and must not import as a second one.
 */
function cleanName(raw: string): string {
  return raw.replace(/^[~*#\s]+/, '').replace(/[~*#\s]+$/, '').replace(/\s+/g, ' ').trim()
}

/** Case, spacing and punctuation all vary by whoever typed the row. */
function matchKey(name: string): string {
  return cleanName(name).toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * The area a beat covers, from its name.
 *
 * "Fort Kochi / Mattancherry - Beat 1" is an area and a number, and `place` is
 * required on every party. Splitting on the last " - " gets the area without
 * asking anybody to retype it fifty times.
 */
function placeOf(beat: string): string {
  const at = beat.lastIndexOf(' - ')
  return (at > 0 ? beat.slice(0, at) : beat).trim()
}

/**
 * Keep the address unless it is plainly a placeholder.
 *
 * The sheet is full of `C`, `1` and `Near.........`, which are worse than
 * nothing. But `2/745` is a real door number and `Kochi` may be all anybody
 * knows, so this refuses only what cannot possibly be an address rather than
 * guessing at what makes a good one.
 */
function cleanAddress(raw: string): string {
  const a = raw.trim()
  if (a.length <= 2) return ''
  if (/^[.\s]+$/.test(a)) return ''
  if (/^near[.\s]*$/i.test(a)) return ''
  return a
}

function typeOf(raw: string): { outletType: OutletType; category: PartyCategory } {
  const s = raw.toLowerCase()
  // Pharmacy and Medical Shop are one thing here — the app has a single type
  // covering both, and the distinction is not one the business steers by.
  if (s.includes('pharmac') || s.includes('medical')) {
    return { outletType: 'pharmacy', category: 'Pharma' }
  }
  if (s.includes('super') || s.includes('grocer') || s.includes('mart')) {
    return { outletType: 'grocery', category: 'Supermarket' }
  }
  if (s.includes('cosmetic')) return { outletType: 'cosmetics', category: 'Other' }
  if (s.includes('hospital') || s.includes('clinic')) {
    return { outletType: 'hospital', category: 'Other' }
  }
  return { outletType: 'general', category: 'General Store' }
}

export default function BeatImporter({ onBack }: Props) {
  const { t } = useTheme()
  const { appUser } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [parties, setParties] = useState<Party[]>([])
  const [routes, setRoutes] = useState<SalesRoute[]>([])
  const [loaded, setLoaded] = useState(false)

  const [rows, setRows] = useState<Row[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  /** Add-only leaves shops the sheet has dropped on their beat; sync removes them. */
  const [mode, setMode] = useState<'add' | 'sync'>('add')
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      getDocs(collection(db, 'parties')),
      getDocs(collection(db, 'sales_routes')),
    ]).then(([p, r]) => {
      setParties(p.docs.map(d => ({ id: d.id, ...d.data() } as Party)))
      setRoutes(r.docs.map(d => ({ id: d.id, ...d.data() } as SalesRoute)))
      setLoaded(true)
    }).catch(() => setLoaded(true))
  }, [])

  /** Matched once the sheet and the database are both in hand. */
  const matched = useMemo<Row[]>(() => {
    if (!rows) return []
    const byCode = new Map<string, Party>()
    const byName = new Map<string, Party>()
    parties.forEach(p => {
      if (p.outletCode) byCode.set(p.outletCode.toUpperCase(), p)
      const k = matchKey(p.name)
      // First one wins. Two shops with the same squashed name is a problem the
      // import should not silently resolve by picking the later document.
      if (k && !byName.has(k)) byName.set(k, p)
    })

    return rows.map(r => {
      const byCodeHit = r.code ? byCode.get(r.code.toUpperCase()) : undefined
      if (byCodeHit) return { ...r, matchedId: byCodeHit.id, matchedBy: 'code' as const }
      const byNameHit = byName.get(matchKey(r.name))
      if (byNameHit) return { ...r, matchedId: byNameHit.id, matchedBy: 'name' as const }
      return r
    })
  }, [rows, parties])

  const beats = useMemo(() => {
    const map = new Map<string, Row[]>()
    matched.forEach(r => {
      if (!map.has(r.beat)) map.set(r.beat, [])
      map.get(r.beat)!.push(r)
    })
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [matched])

  const newShops = matched.filter(r => !r.matchedId)
  const byCodeCount = matched.filter(r => r.matchedBy === 'code').length
  const byNameCount = matched.filter(r => r.matchedBy === 'name').length

  const existingRoute = (beat: string) =>
    routes.find(r => r.name.trim().toLowerCase() === beat.trim().toLowerCase())

  /** Shops already on an existing beat that this sheet no longer lists. */
  const droppedFrom = (beat: string, rowsForBeat: Row[]) => {
    const route = existingRoute(beat)
    if (!route) return []
    const keeping = new Set(rowsForBeat.map(r => r.matchedId).filter(Boolean) as string[])
    return (route.outletIds || [])
      .filter(id => !keeping.has(id))
      .map(id => parties.find(p => p.id === id))
      .filter(Boolean) as Party[]
  }

  const totalDropped = beats.reduce((n, [beat, rs]) => n + droppedFrom(beat, rs).length, 0)

  const readFile = async (file: File) => {
    setError(null); setDone(null)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })

      /**
       * Find the data, rather than assuming where it is.
       *
       * Reading the first sheet and treating its first row as headers is only
       * right for a file somebody made for this. A workbook that has been round
       * a WhatsApp group has a summary tab in front of the data as often as
       * not, and a title row above the headers nearly as often. Both produce
       * "no usable rows", which tells whoever is holding the file nothing at
       * all.
       *
       * So every sheet is examined, and within each the first ten rows are
       * checked for one that names both a beat and an outlet. Whatever is found
       * first wins.
       */
      let found: { sheet: string; header: string[]; body: unknown[][] } | null = null
      const looked: string[] = []

      for (const sheetName of wb.SheetNames) {
        const grid = XLSX.utils.sheet_to_json<unknown[]>(
          wb.Sheets[sheetName], { header: 1, defval: '', blankrows: false },
        )
        for (let i = 0; i < Math.min(10, grid.length); i++) {
          const header = (grid[i] || []).map(c => String(c ?? '').trim())
          const norm = header.map(normHeader)
          const hasBeat = norm.some(h => h === 'beat' || h === 'beatname' || h === 'route')
          const hasName = norm.some(h => h.startsWith('outletname') || h === 'outlet'
            || h === 'shopname' || h === 'name')
          if (hasBeat && hasName) {
            found = { sheet: sheetName, header, body: grid.slice(i + 1) }
            break
          }
        }
        if (found) break
        const first = (grid[0] || []).map(c => String(c ?? '').trim()).filter(Boolean)
        looked.push(`${sheetName} (${first.slice(0, 6).join(', ') || 'empty'})`)
      }

      if (!found) {
        // Name what was actually seen. "No usable rows" sends somebody to stare
        // at a spreadsheet that looks perfectly fine to them.
        setError(
          'Could not find a Beat column and an Outlet Name column in this file. '
          + `Looked at: ${looked.join(' · ')}.`,
        )
        setRows(null)
        return
      }

      const parsed: Row[] = []
      for (const line of found.body) {
        const r: Record<string, unknown> = {}
        found.header.forEach((h, i) => { if (h) r[h] = (line as unknown[])[i] })

        const beat = cell(r, 'beat', 'beatname', 'route').trim()
        const name = cleanName(cell(r, 'outletname', 'outlet', 'name', 'shopname'))
        // A spacer, a repeated header inside the data, or a totals line.
        if (!beat || !name) continue
        if (normHeader(beat) === 'beat') continue
        const { outletType, category } = typeOf(cell(r, 'outlettype', 'type', 'category'))
        parsed.push({
          beat,
          place: placeOf(beat),
          code: cell(r, 'code', 'outletcode', 'shopcode').trim(),
          name,
          address: cleanAddress(cell(r, 'address', 'addr', 'location')),
          outletType,
          category,
        })
      }

      if (parsed.length === 0) {
        setError(
          `Found the columns on "${found.sheet}" but every row was empty. `
          + 'If the sheet is filtered, that is fine — hidden rows are read too.',
        )
        setRows(null)
        return
      }
      setFileName(`${file.name} · ${found.sheet}`)
      setRows(parsed)
    } catch (e: any) {
      setError(
        'Could not read that file. It needs to be the .xlsx or .csv itself, not a screenshot or a PDF.'
        + (e?.message ? ` (${e.message})` : ''),
      )
      setRows(null)
    }
  }

  const runImport = async () => {
    if (!rows) return
    setImporting(true); setError(null)
    try {
      // Created parties first, because the beats have to reference them. Ids are
      // decided here rather than after writing, so a beat can be built in the
      // same pass without waiting to learn what its shops were called.
      const created = new Map<string, string>()   // row key → new party id
      let batch = writeBatch(db)
      let n = 0
      const flush = async () => { if (n) { await batch.commit(); batch = writeBatch(db); n = 0 } }

      for (const r of matched) {
        if (r.matchedId) continue
        const key = `${r.beat}|${r.code}|${matchKey(r.name)}`
        if (created.has(key)) continue
        const ref = doc(collection(db, 'parties'))
        created.set(key, ref.id)
        batch.set(ref, {
          name: r.name,
          type: 'retailer',
          category: r.category,
          outletType: r.outletType,
          ...(r.code ? { outletCode: r.code } : {}),
          phone: '',
          address: r.address,
          place: r.place,
          pricePerPacket: 0,
          packetsAllocated: 0,
          cartonsAllocated: 0,
          lowStockThreshold: 0,
          status: 'prospect',
          addedBy: appUser!.uid,
          addedByName: appUser!.name,
          createdAt: Date.now(),
        })
        if (++n >= 400) await flush()
      }

      // Stamp the code onto shops matched by name, so the next import matches
      // exactly instead of guessing at the spelling again.
      for (const r of matched) {
        if (!r.matchedId || r.matchedBy !== 'name' || !r.code) continue
        const p = parties.find(x => x.id === r.matchedId)
        if (p?.outletCode) continue
        batch.update(doc(db, 'parties', r.matchedId), { outletCode: r.code })
        if (++n >= 400) await flush()
      }
      await flush()

      let beatsMade = 0
      let beatsUpdated = 0
      for (const [beat, rs] of beats) {
        const ids = rs.map(r =>
          r.matchedId ?? created.get(`${r.beat}|${r.code}|${matchKey(r.name)}`),
        ).filter(Boolean) as string[]

        const route = existingRoute(beat)
        if (route) {
          const keep = mode === 'sync'
            ? ids
            : [...new Set([...(route.outletIds || []), ...ids])]
          batch.update(doc(db, 'sales_routes', route.id!), {
            outletIds: keep,
            places: [...new Set([...routePlaces(route), placeOf(beat)])],
          })
          beatsUpdated++
        } else {
          batch.set(doc(collection(db, 'sales_routes')), {
            name: beat,
            places: [placeOf(beat)],
            outletIds: [...new Set(ids)],
            assignedTo: [],
            active: true,
            createdBy: appUser!.uid,
            createdByName: appUser!.name,
            createdAt: Date.now(),
          })
          beatsMade++
        }
        if (++n >= 400) await flush()
      }
      await flush()

      setDone(
        `${created.size} shop${created.size === 1 ? '' : 's'} added, `
        + `${matched.length - created.size} already here. `
        + `${beatsMade} beat${beatsMade === 1 ? '' : 's'} created`
        + (beatsUpdated ? `, ${beatsUpdated} updated.` : '.'),
      )
      setRows(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (e: any) {
      setError(e?.code === 'permission-denied'
        ? 'Firestore refused the write. Your account may not hold "Plan beats & assign the week".'
        : e?.message || 'The import stopped partway. Nothing further was written.')
    } finally { setImporting(false) }
  }

  return (
    <div style={{ minHeight: 'var(--oc-screen)', background: t.bg, paddingBottom: 56 }}>
      <PageHeader
        eyebrow="Planner"
        title="Import a beat sheet"
        subtitle="The spreadsheet from the group — shops and their beats, in one pass."
        onBack={onBack}
      />

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 760 }}>
        {done && <Note>{done}</Note>}
        {error && <Note tone="warn">{error}</Note>}

        <Section label="The file">
          <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.7, marginBottom: 12 }}>
            Needs a <strong>Beat</strong> column and an <strong>Outlet Name</strong> column. Code,
            Address and Outlet Type are used when present. Visited and Notes are ignored — they are
            yours to work in.
            <br /><br />
            Nothing is written until you have seen what it would do.
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f) }}
            style={{ fontSize: 14, color: t.text2 }}
          />
        </Section>

        {!loaded && <Note>Reading what is already here…</Note>}

        {rows && loaded && (
          <>
            <StatGrid>
              <StatCard value={matched.length} label="Rows" context={fileName} />
              <StatCard value={newShops.length} label="New shops"
                context={newShops.length ? 'will be created' : 'all known'} />
              <StatCard value={beats.length} label="Beats" />
            </StatGrid>

            {(byCodeCount > 0 || byNameCount > 0) && (
              <Note>
                {byCodeCount > 0 && `${byCodeCount} matched on their code. `}
                {byNameCount > 0 && (
                  `${byNameCount} matched on the name alone — those get their code stamped on now, `
                  + 'so next month they match exactly.'
                )}
              </Note>
            )}

            {totalDropped > 0 && (
              <Section label="Shops on a beat that this sheet does not list">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <ChipGroup
                    value={mode}
                    onChange={setMode}
                    options={[
                      { id: 'add' as const, label: `Leave all ${totalDropped} where they are` },
                      { id: 'sync' as const, label: `Remove them — the sheet is the truth` },
                    ]}
                  />
                  <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.6 }}>
                    {mode === 'add'
                      ? 'Nothing is taken off a beat. A shop left out of this month\'s sheet by accident stays put.'
                      : 'Each beat will end up matching the sheet exactly. A shop left out by accident is removed from it — the shop itself is never deleted.'}
                  </div>
                </div>
              </Section>
            )}

            {beats.map(([beat, rs]) => {
              const route = existingRoute(beat)
              const fresh = rs.filter(r => !r.matchedId)
              const dropped = droppedFrom(beat, rs)
              return (
                <Section key={beat} label={beat}>
                  <div style={{ fontSize: 13, color: t.text3, lineHeight: 1.7 }}>
                    {route ? 'Already exists — will be updated' : 'New beat'}
                    {' · '}{placeOf(beat)}{' · '}{rs.length} shops
                    {fresh.length > 0 && ` · ${fresh.length} new`}
                  </div>

                  {fresh.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 13, color: t.text2, lineHeight: 1.6 }}>
                      <strong style={{ color: t.text, fontWeight: 500 }}>Creating:</strong>{' '}
                      {fresh.slice(0, 12).map(r => r.name).join(', ')}
                      {fresh.length > 12 && `, and ${fresh.length - 12} more`}
                    </div>
                  )}

                  {dropped.length > 0 && (
                    <div style={{ marginTop: 10, fontSize: 13, color: t.warn, lineHeight: 1.6 }}>
                      <strong style={{ fontWeight: 500 }}>Not in this sheet:</strong>{' '}
                      {dropped.map(p => p.name).join(', ')}
                      {mode === 'sync' ? ' — will be taken off this beat.' : ' — left on the beat.'}
                    </div>
                  )}
                </Section>
              )
            })}

            <div className="oc-wrap" style={{ gap: 10 }}>
              <PrimaryButton onClick={runImport} disabled={importing}>
                {importing
                  ? 'Importing…'
                  : `Import ${matched.length} rows into ${beats.length} beat${beats.length === 1 ? '' : 's'}`}
              </PrimaryButton>
              <GhostButton onClick={() => { setRows(null); if (fileRef.current) fileRef.current.value = '' }}>
                Choose another file
              </GhostButton>
            </div>
          </>
        )}

        {!rows && loaded && !done && (
          <EmptyState
            title="Nothing loaded yet"
            body="Pick the .xlsx as it came from the group. You will see exactly what it would create before anything is written."
          />
        )}
      </div>
    </div>
  )
}
