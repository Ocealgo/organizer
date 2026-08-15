import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { collection, addDoc, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { PartyType, PartyCategory } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import CustomSelect from '../../components/CustomSelect'
import {
  PageHeader, Section, StatGrid, StatCard, Field, ChipGroup, Note,
  GhostButton, PrimaryButton, inputStyle,
} from '../../components/ui'

interface Props { onBack: () => void; onDone: (count: number) => void }

interface ParsedRow {
  name: string
  phone: string
  email: string
  address: string
  place: string
  district: string
  state: string
  pincode: string
  receivables: number
  skip: boolean
  type: PartyType
  category: PartyCategory
  underDistributorId: string
  underDistributorName: string
}

const CATEGORIES: PartyCategory[] = ['FMCG', 'Pharma', 'General Store', 'Supermarket', 'Online', 'Other']

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findByHeader(row: Record<string, string>, ...patterns: string[]): string {
  const normPatterns = patterns.map(normalizeHeader)
  for (const [key, val] of Object.entries(row)) {
    const normKey = normalizeHeader(key)
    if (normPatterns.some(p => normKey === p || normKey.startsWith(p))) {
      return String(val ?? '').trim()
    }
  }
  return ''
}

function cleanPhone(raw: string): string {
  if (!raw) return ''
  return raw.replace(/['+\-\s]/g, '').replace(/^91/, '').slice(-10)
}

function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/[₹,\s"]/g, '')) || 0
}

function parseTypeValue(val: string): PartyType {
  return val.toLowerCase().includes('distributor') ? 'distributor' : 'retailer'
}

function parseCategoryValue(val: string): PartyCategory {
  const v = val.toLowerCase()
  if (v.includes('pharma')) return 'Pharma'
  if (v.includes('general')) return 'General Store'
  if (v.includes('super')) return 'Supermarket'
  if (v.includes('online')) return 'Online'
  if (v.includes('fmcg')) return 'FMCG'
  for (const cat of CATEGORIES) {
    if (v === cat.toLowerCase()) return cat
  }
  return 'Other'
}

function parseImportFile(arrayBuffer: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array', cellText: true, raw: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const data = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })
  if (data.length === 0) return []

  return data
    .map(row => {
      const name = findByHeader(row, 'name', 'customername', 'companyname', 'businessname')
      if (!name) return null

      const typeStr = findByHeader(row, 'type', 'partytype')
      const catStr = findByHeader(row, 'category', 'businesstype')
      const receivablesStr = findByHeader(row, 'outstandingreceivables', 'receivables', 'outstandingbalance', 'outstanding')

      return {
        name,
        phone: cleanPhone(findByHeader(row, 'phone', 'mobile', 'mobileno', 'phonenumber')),
        email: findByHeader(row, 'email', 'emailaddress', 'emailid'),
        address: findByHeader(row, 'address', 'billingaddress', 'streetaddress', 'fulladdress'),
        place: findByHeader(row, 'placearea', 'place', 'area', 'city', 'location', 'town'),
        district: findByHeader(row, 'district'),
        state: findByHeader(row, 'state', 'stateprovince'),
        pincode: findByHeader(row, 'pincode', 'zip', 'postalcode', 'pin', 'zipcode'),
        receivables: parseAmount(receivablesStr),
        skip: false,
        type: typeStr ? parseTypeValue(typeStr) : 'retailer',
        category: catStr ? parseCategoryValue(catStr) : 'FMCG',
        underDistributorId: '',
        underDistributorName: '',
      } as ParsedRow
    })
    .filter(Boolean) as ParsedRow[]
}

export default function CSVImporter({ onBack, onDone }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [step, setStep] = useState<'upload' | 'review' | 'done'>('upload')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [importCount, setImportCount] = useState(0)
  const [error, setError] = useState('')
  const [, setExistingNames] = useState<Set<string>>(new Set())
  const [distributors, setDistributors] = useState<{ id: string; name: string }[]>([])
  const [mapperLink, setMapperLink] = useState('')
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'config', 'settings'))
      .then(snap => { if (snap.exists()) setMapperLink(snap.data().mapperLink || '') })
      .catch(() => {})
  }, [])

  const activeRows = rows.filter(r => !r.skip)
  const currentRow = activeRows[currentIdx]
  const skippedCount = rows.filter(r => r.skip).length

  const handleFile = async (file: File) => {
    setError('')
    const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
    const isCSV = file.name.endsWith('.csv')
    if (!isExcel && !isCSV) {
      setError('That file type will not work. Upload a .csv, .xlsx or .xls file.')
      return
    }
    try {
      const arrayBuffer = await file.arrayBuffer()
      const parsed = parseImportFile(arrayBuffer)
      if (parsed.length === 0) {
        setError('No usable rows found. Check that the file has the expected column headers, starting with a name column.')
        return
      }

      const snap = await getDocs(collection(db, 'parties'))
      const names = new Set(snap.docs.map(d => (d.data().name as string).toLowerCase().trim()))
      setExistingNames(names)
      setDistributors(
        snap.docs
          .filter(d => d.data().type === 'distributor')
          .map(d => ({ id: d.id, name: d.data().name as string }))
          .sort((a, b) => a.name.localeCompare(b.name))
      )

      const withDupes = parsed.map(r => ({
        ...r,
        skip: names.has(r.name.toLowerCase().trim()),
      }))

      setRows(withDupes)
      setCurrentIdx(0)
      setStep('review')
    } catch {
      setError('The file could not be read. Check the format and try again.')
    }
  }

  const updateRow = (field: keyof ParsedRow, value: string | boolean | number | PartyType | PartyCategory) => {
    setRows(prev => {
      const updated = [...prev]
      let count = -1
      for (let i = 0; i < prev.length; i++) {
        if (!prev[i].skip) count++
        if (count === currentIdx) {
          updated[i] = { ...updated[i], [field]: value }
          break
        }
      }
      return updated
    })
  }

  const handleNext = async () => {
    if (!currentRow.name.trim()) { setError('Enter a name before importing this row.'); return }
    setError('')
    setImporting(true)
    try {
      await addDoc(collection(db, 'parties'), {
        name: currentRow.name.trim(),
        type: currentRow.type,
        category: currentRow.category,
        phone: currentRow.phone,
        email: currentRow.email || '',
        address: currentRow.address,
        place: currentRow.place,
        district: currentRow.district || '',
        state: currentRow.state || '',
        pincode: currentRow.pincode || '',
        pricePerPacket: 0,
        packetsAllocated: 0,
        cartonsAllocated: 0,
        lowStockThreshold: 0,
        ...(currentRow.underDistributorId
          ? { underDistributorId: currentRow.underDistributorId, underDistributorName: currentRow.underDistributorName }
          : {}),
        status: 'prospect',
        addedBy: appUser!.uid,
        addedByName: appUser!.name,
        createdAt: Date.now(),
      })
      setImportCount(c => c + 1)
    } finally {
      setImporting(false)
    }

    if (currentIdx < activeRows.length - 1) {
      setCurrentIdx(i => i + 1)
    } else {
      setStep('done')
    }
  }

  const handleSkipCurrent = () => {
    setError('')
    if (currentIdx < activeRows.length - 1) {
      setCurrentIdx(i => i + 1)
    } else {
      setStep('done')
    }
  }

  // ── UPLOAD ────────────────────────────────────────────────────────────────
  if (step === 'upload') return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow="Import"
        title="Import from Excel or CSV"
        subtitle="Bring distributors and retailers across from Zoho."
        onBack={onBack}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 560 }}>
        <Section label="How this works">
          <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <li style={{ fontSize: 14, fontWeight: 400, color: t.text, lineHeight: 1.6 }}>
              Export your customers from Zoho Books, under Sales then Customers.
            </li>
            <li style={{ fontSize: 14, fontWeight: 400, color: t.text, lineHeight: 1.6 }}>
              Run the file through the mapper so its columns match ours, then download the result.
              {mapperLink ? (
                <div style={{ marginTop: 8 }}>
                  <a href={mapperLink} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 13, fontWeight: 400, color: t.accent, textDecoration: 'none' }}>
                    Open the mapper
                  </a>
                </div>
              ) : (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 400, color: t.text3 }}>
                  No mapper link is set. An admin can add one in Settings.
                </div>
              )}
            </li>
            <li style={{ fontSize: 14, fontWeight: 400, color: t.text, lineHeight: 1.6 }}>
              Upload it here. Every field is filled in from the file and stays editable, so you
              review each entry before it is saved.
            </li>
          </ol>
        </Section>

        {error && <Note tone="warn">{error}</Note>}

        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        <div>
          <PrimaryButton onClick={() => fileRef.current?.click()}>Choose a file</PrimaryButton>
        </div>
      </div>
    </div>
  )

  // ── DONE ──────────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div style={{ minHeight: '100vh', background: t.bg }}>
      <PageHeader
        eyebrow="Import"
        title="Import finished"
        subtitle={`${importCount} ${importCount === 1 ? 'entry' : 'entries'} added to your network.`}
      />
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 460 }}>
        <StatGrid>
          <StatCard value={importCount} label="Imported" />
          <StatCard value={skippedCount} label="Skipped" context="Already in the list" />
          <StatCard value={rows.length} label="Rows in file" />
        </StatGrid>
        <div>
          <PrimaryButton onClick={() => onDone(importCount)}>View all entries</PrimaryButton>
        </div>
      </div>
    </div>
  )

  // ── REVIEW ────────────────────────────────────────────────────────────────
  if (!currentRow) return null

  return (
    <div style={{ minHeight: '100vh', background: t.bg, paddingBottom: 40 }}>
      <PageHeader
        eyebrow={`Entry ${currentIdx + 1} of ${activeRows.length}`}
        title={currentRow.name || 'Untitled entry'}
        subtitle={skippedCount > 0
          ? `${skippedCount} duplicate ${skippedCount === 1 ? 'row was' : 'rows were'} skipped automatically.`
          : undefined}
        onBack={onBack}
      />

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
        <Field label="Type">
          <ChipGroup
            value={currentRow.type}
            onChange={ty => updateRow('type', ty)}
            options={[
              { id: 'distributor' as PartyType, label: 'Distributor' },
              { id: 'retailer' as PartyType, label: 'Retailer' },
            ]}
          />
        </Field>

        {currentRow.type === 'retailer' && (
          <Field label="Parent distributor"
            hint="Link a retailer to a distributor to track distribution. Leave it unset for an independent retailer.">
            <CustomSelect
              value={currentRow.underDistributorId}
              onChange={id => {
                updateRow('underDistributorId', id)
                updateRow('underDistributorName', distributors.find(d => d.id === id)?.name || '')
              }}
              placeholder="Independent retailer"
              options={[{ value: '', label: 'Independent retailer' },
                        ...distributors.map(d => ({ value: d.id, label: d.name }))]}
            />
          </Field>
        )}

        <Field label="Name">
          <input type="text" value={currentRow.name}
            onChange={e => updateRow('name', e.target.value)}
            placeholder="Business name" style={inputStyle(t)} />
        </Field>

        <Field label="Phone">
          <input type="tel" inputMode="numeric" value={currentRow.phone}
            onChange={e => updateRow('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit mobile number" style={inputStyle(t)} />
        </Field>

        <Field label="Email">
          <input type="email" value={currentRow.email}
            onChange={e => updateRow('email', e.target.value)}
            placeholder="Optional" style={inputStyle(t)} />
        </Field>

        <Field label="Category">
          <ChipGroup
            value={currentRow.category}
            onChange={c => updateRow('category', c)}
            options={CATEGORIES.map(c => ({ id: c, label: c }))}
          />
        </Field>

        <Field label="Address">
          <input type="text" value={currentRow.address}
            onChange={e => updateRow('address', e.target.value)}
            placeholder="12/A MG Road, Ernakulam" style={inputStyle(t)} />
        </Field>

        <Field label="Place or area">
          <input type="text" value={currentRow.place}
            onChange={e => updateRow('place', e.target.value)}
            placeholder="Ernakulam" style={inputStyle(t)} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="District">
            <input type="text" value={currentRow.district}
              onChange={e => updateRow('district', e.target.value)}
              placeholder="District" style={inputStyle(t)} />
          </Field>
          <Field label="State">
            <input type="text" value={currentRow.state}
              onChange={e => updateRow('state', e.target.value)}
              placeholder="State" style={inputStyle(t)} />
          </Field>
        </div>

        <Field label="Pincode">
          <input type="text" inputMode="numeric" value={currentRow.pincode}
            onChange={e => updateRow('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit pincode" style={inputStyle(t)} />
        </Field>

        {currentRow.receivables > 0 && (
          <Note>
            Zoho shows ₹{currentRow.receivables.toLocaleString('en-IN')} outstanding against this
            customer. It is not imported — record it in the credit book if it still applies.
          </Note>
        )}

        {error && <Note tone="warn">{error}</Note>}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <PrimaryButton onClick={handleNext} disabled={importing}>
            {importing ? 'Saving' : currentIdx === activeRows.length - 1 ? 'Import and finish' : 'Import and continue'}
          </PrimaryButton>
          <GhostButton onClick={handleSkipCurrent}>Skip this one</GhostButton>
        </div>

        {activeRows.length > currentIdx + 1 && (
          <Section label="Next up">
            <div style={{ borderBottom: `0.5px solid ${t.border}` }}>
              {activeRows.slice(currentIdx + 1, currentIdx + 4).map((r, i) => (
                <div key={i} style={{ borderTop: `0.5px solid ${t.border}`, padding: '11px 0',
                                      fontSize: 14, fontWeight: 400, color: t.text2 }}>
                  {r.name}
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
