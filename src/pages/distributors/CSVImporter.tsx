import React, { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { collection, addDoc, getDocs, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase'
import { PartyType, PartyCategory } from '../../types'
import { useAuth } from '../../context/AuthContext'

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

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      {hint && <div style={{ fontSize: 10, color: '#6ee7b7', marginBottom: 4 }}>💡 {hint}</div>}
      {children}
    </div>
  )
}

function inputStyle(small?: boolean): React.CSSProperties {
  return {
    width: '100%', background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8, padding: small ? '7px 10px' : '10px 12px',
    fontSize: small ? 12 : 13, color: '#fff', outline: 'none', boxSizing: 'border-box',
  }
}

export default function CSVImporter({ onBack, onDone }: Props) {
  const { appUser } = useAuth()
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
      setError('Please upload a .csv, .xlsx, or .xls file')
      return
    }
    try {
      const arrayBuffer = await file.arrayBuffer()
      const parsed = parseImportFile(arrayBuffer)
      if (parsed.length === 0) {
        setError('No valid data found. Make sure the file has the correct column headers (Name, Phone, Address, etc.)')
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
      setError('Failed to parse file. Please check the format and try again.')
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
    if (!currentRow.name.trim()) { setError('Name is required'); return }
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

  // ── UPLOAD STEP ──────────────────────────────────────────────────────────
  if (step === 'upload') return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', padding: '24px 20px 20px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bae6fd', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 16 }}>← Back</button>
        <div style={{ color: '#bae6fd', fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>Import 📥</div>
        <div style={{ fontSize: 22, fontWeight: 900 }}>Import from Excel / CSV</div>
        <div style={{ color: '#e0f2fe', fontSize: 13, marginTop: 4 }}>Import distributors & retailers from Zoho via mapper</div>
      </div>

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 3-step guide */}
        <div style={{ background: '#161b22', borderRadius: 14, border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          {/* Step 1 */}
          <div style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, background: 'rgba(8,145,178,0.15)', border: '1.5px solid rgba(8,145,178,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#0891b2', flexShrink: 0, marginTop: 1 }}>1</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>📤 Export from Zoho</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                Go to <span style={{ color: '#94a3b8' }}>Zoho Books → Sales → Customers</span>, click <span style={{ color: '#94a3b8' }}>Export</span> and download the CSV file.
              </div>
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', marginLeft: 58 }} />

          {/* Step 2 */}
          <div style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, background: 'rgba(124,58,237,0.15)', border: '1.5px solid rgba(124,58,237,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#a78bfa', flexShrink: 0, marginTop: 1 }}>2</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>🔀 Remap columns in mapper</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: mapperLink ? 10 : 0 }}>
                Paste the CSV into the mapper, match the columns to our format, then download the result.
              </div>
              {mapperLink ? (
                <a href={mapperLink} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#a78bfa', fontWeight: 700, textDecoration: 'none' }}>
                  Open Mapper →
                </a>
              ) : (
                <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>Mapper link not set — ask your admin to add it in Settings.</div>
              )}
            </div>
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.04)', marginLeft: 58 }} />

          {/* Step 3 */}
          <div style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ width: 28, height: 28, background: 'rgba(22,163,74,0.15)', border: '1.5px solid rgba(22,163,74,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, color: '#16a34a', flexShrink: 0, marginTop: 1 }}>3</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', marginBottom: 3 }}>📁 Upload the file below</div>
              <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
                All fields are pre-filled from the file and editable. Review each entry before confirming.
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: 'none' }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        <button onClick={() => fileRef.current?.click()}
          style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 'none', borderRadius: 14, padding: '18px', fontSize: 15, fontWeight: 800, boxShadow: '0 8px 24px rgba(8,145,178,0.3)' }}>
          📁 Select CSV or Excel File
        </button>
      </div>
    </div>
  )

  // ── DONE ─────────────────────────────────────────────────────────────────
  if (step === 'done') return (
    <div style={{ minHeight: '100vh', background: '#0d1117', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 20 }}>🎉</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: '#fff', marginBottom: 8 }}>Import Complete!</div>
      <div style={{ fontSize: 15, color: '#6ee7b7', marginBottom: 32 }}>
        {importCount} {importCount === 1 ? 'entry' : 'entries'} added to your network
      </div>
      <div style={{ background: '#161b22', borderRadius: 16, padding: 20, width: '100%', maxWidth: 300, marginBottom: 32, border: '1px solid rgba(22,163,74,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Imported</span>
          <span style={{ fontSize: 13, color: '#16a34a', fontWeight: 700 }}>{importCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Skipped (duplicates)</span>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>{skippedCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Total in file</span>
          <span style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>{rows.length}</span>
        </div>
      </div>
      <button onClick={() => onDone(importCount)}
        style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 32px', fontSize: 14, fontWeight: 800 }}>
        View All Entries →
      </button>
    </div>
  )

  // ── REVIEW STEP ───────────────────────────────────────────────────────────
  if (!currentRow) return null

  const progress = Math.round(((currentIdx + 1) / activeRows.length) * 100)

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      <div style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', padding: '20px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bae6fd', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 12 }}>← Cancel</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#bae6fd', fontWeight: 700 }}>Entry {currentIdx + 1} of {activeRows.length}</div>
          <div style={{ fontSize: 13, color: '#bae6fd', fontWeight: 700 }}>{progress}%</div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#fff', borderRadius: 99, transition: 'width 0.3s' }} />
        </div>
        {skippedCount > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
            {skippedCount} duplicate {skippedCount === 1 ? 'entry' : 'entries'} auto-skipped
          </div>
        )}
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Type toggle */}
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Type</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['distributor', 'retailer'] as PartyType[]).map(t => (
              <button key={t} onClick={() => updateRow('type', t)}
                style={{ flex: 1, background: currentRow.type === t ? 'rgba(8,145,178,0.15)' : 'rgba(255,255,255,0.04)', color: currentRow.type === t ? '#0891b2' : '#64748b', border: `1.5px solid ${currentRow.type === t ? '#0891b2' : 'rgba(255,255,255,0.06)'}`, borderRadius: 12, padding: '12px', fontSize: 13, fontWeight: 800 }}>
                {t === 'distributor' ? '🚚 Distributor' : '🏪 Retailer'}
              </button>
            ))}
          </div>
        </div>

        {/* Parent distributor — retailers only */}
        {currentRow.type === 'retailer' && (
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1.5px solid rgba(255,255,255,0.08)',
            borderRadius: 12, padding: 14,
          }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, letterSpacing: 1, textTransform: 'uppercase' }}>
              Parent Distributor <span style={{ color: '#334155', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 10 }}>
              Link this retailer to a distributor to enable distribution tracking. Unlinked = independent retailer.
            </div>
            <select
              value={currentRow.underDistributorId}
              onChange={e => {
                const id = e.target.value
                const name = distributors.find(d => d.id === id)?.name || ''
                updateRow('underDistributorId', id)
                updateRow('underDistributorName', name)
              }}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8, padding: '10px 12px',
                fontSize: 13, color: currentRow.underDistributorId ? '#fff' : '#64748b',
                outline: 'none', boxSizing: 'border-box',
              }}
            >
              <option value="" style={{ background: '#1e2530', color: '#94a3b8' }}>Independent retailer</option>
              {distributors.map(d => (
                <option key={d.id} value={d.id} style={{ background: '#1e2530', color: '#fff' }}>
                  🚚 {d.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <Field label="Name *">
          <input type="text" value={currentRow.name}
            onChange={e => updateRow('name', e.target.value)}
            placeholder="Business name" style={inputStyle()} />
        </Field>

        <Field label="Phone">
          <input type="tel" value={currentRow.phone}
            onChange={e => updateRow('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10-digit mobile number" style={inputStyle()} />
        </Field>

        <Field label="Email">
          <input type="email" value={currentRow.email}
            onChange={e => updateRow('email', e.target.value)}
            placeholder="email@example.com (optional)" style={inputStyle()} />
        </Field>

        {/* Category */}
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, letterSpacing: 1, textTransform: 'uppercase' }}>Category</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => updateRow('category', c)}
                style={{ background: currentRow.category === c ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)', color: currentRow.category === c ? '#a78bfa' : '#64748b', border: `1px solid ${currentRow.category === c ? '#7c3aed' : 'rgba(255,255,255,0.06)'}`, borderRadius: 20, padding: '6px 14px', fontSize: 12, fontWeight: 700 }}>
                {c}
              </button>
            ))}
          </div>
        </div>

        <Field label="Address">
          <input type="text" value={currentRow.address}
            onChange={e => updateRow('address', e.target.value)}
            placeholder="e.g. 12/A MG Road, Ernakulam" style={inputStyle()} />
        </Field>

        <Field label="Place / Area">
          <input type="text" value={currentRow.place}
            onChange={e => updateRow('place', e.target.value)}
            placeholder="e.g. Ernakulam" style={inputStyle()} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="District">
            <input type="text" value={currentRow.district}
              onChange={e => updateRow('district', e.target.value)}
              placeholder="District" style={inputStyle(true)} />
          </Field>
          <Field label="State">
            <input type="text" value={currentRow.state}
              onChange={e => updateRow('state', e.target.value)}
              placeholder="State" style={inputStyle(true)} />
          </Field>
        </div>

        <Field label="Pincode">
          <input type="text" value={currentRow.pincode}
            onChange={e => updateRow('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit pincode" style={inputStyle()} />
        </Field>

        {currentRow.receivables > 0 && (
          <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fde68a' }}>
            📊 Outstanding receivable from Zoho: ₹{currentRow.receivables.toLocaleString()}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={handleSkipCurrent}
            style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 700 }}>
            Skip →
          </button>
          <button onClick={handleNext} disabled={importing}
            style={{ flex: 2, background: importing ? '#334155' : 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 800, opacity: importing ? 0.7 : 1 }}>
            {importing ? 'Saving...' : currentIdx === activeRows.length - 1 ? 'Import & Finish ✅' : 'Import & Next →'}
          </button>
        </div>

        {activeRows.length > currentIdx + 1 && (
          <div style={{ background: '#161b22', borderRadius: 12, padding: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>NEXT UP</div>
            {activeRows.slice(currentIdx + 1, currentIdx + 4).map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: '#64748b', padding: '3px 0' }}>
                <span style={{ color: '#334155' }}>{currentIdx + 2 + i}.</span> {r.name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
