import React, { useState, useRef } from 'react'
import { collection, addDoc, getDocs } from 'firebase/firestore'
import { db } from '../../firebase'
import { Party, PartyType, PartyCategory } from '../../types'
import { useAuth } from '../../context/AuthContext'
import { useStockConfig, toDisplay } from '../../hooks/useFirebase'

interface Props { onBack: () => void; onDone: (count: number) => void }

interface ParsedRow {
  name: string
  phone: string
  email: string
  place: string
  receivables: number
  skip: boolean
  // Admin fills these
  type: PartyType
  category: PartyCategory
  pricePerPacket: string
  address: string
  packetsAllocated: string
}

const CATEGORIES: PartyCategory[] = ['FMCG', 'Pharma', 'General Store', 'Supermarket', 'Online', 'Other']

const SKIP_KEYWORDS = ['amazon', 'flipkart', 'meesho', 'online', 'ecommerce', 'e-commerce']
const INDIVIDUAL_PATTERN = /^[a-z][a-z]+ [a-z]+$/i // first last name pattern

// Clean Zoho phone format: '+91-9876543210 → 9876543210
function cleanPhone(raw: string): string {
  if (!raw) return ''
  return raw.replace(/['+\-\s]/g, '').replace(/^91/, '').slice(-10)
}

// Parse amount: ₹1,380.00 → 1380
function parseAmount(raw: string): number {
  return parseFloat(raw.replace(/[₹,\s"]/g, '')) || 0
}

// Should skip this row?
function shouldSkip(name: string, receivables: number): boolean {
  const lower = name.toLowerCase()
  if (SKIP_KEYWORDS.some(k => lower.includes(k))) return true
  if (INDIVIDUAL_PATTERN.test(name.trim()) && receivables === 0) return true
  return false
}

// Parse Zoho Contacts CSV
function parseZohoCSV(text: string): ParsedRow[] {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
  const rows: ParsedRow[] = []

  for (let i = 1; i < lines.length; i++) {
    // Handle quoted commas
    const cols: string[] = []
    let current = ''
    let inQuotes = false
    for (const ch of lines[i]) {
      if (ch === '"') { inQuotes = !inQuotes }
      else if (ch === ',' && !inQuotes) { cols.push(current); current = '' }
      else { current += ch }
    }
    cols.push(current)

    const get = (idx: number) => (cols[idx] || '').trim().replace(/^["']|["']$/g, '')

    const name = get(1) || get(2) // Name or Company Name
    if (!name) continue

    const receivables = parseAmount(get(6))
    const skip = shouldSkip(name, receivables)

    rows.push({
      name,
      phone: cleanPhone(get(4)),
      email: get(3),
      place: get(0) || 'Kerala', // CONTACT_ID column has state
      receivables,
      skip,
      type: 'distributor',
      category: 'FMCG',
      pricePerPacket: '',
      address: '',
      packetsAllocated: '',
    })
  }

  return rows
}

// ── FIELD COMPONENT (outside to prevent focus loss) ───────────────────────────
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
  const { config } = useStockConfig()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [step, setStep] = useState<'upload' | 'review' | 'importing' | 'done'>('upload')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [importCount, setImportCount] = useState(0)
  const [error, setError] = useState('')
  const [existingNames, setExistingNames] = useState<Set<string>>(new Set())

  const activeRows = rows.filter(r => !r.skip)
  const currentRow = activeRows[currentIdx]

  const handleFile = async (file: File) => {
    setError('')
    if (!file.name.endsWith('.csv')) { setError('Please upload a .csv file'); return }
    const text = await file.text()
    const parsed = parseZohoCSV(text)
    if (parsed.length === 0) { setError('No valid data found in CSV'); return }

    // Load existing party names for duplicate check
    const snap = await getDocs(collection(db, 'parties'))
    const names = new Set(snap.docs.map(d => (d.data().name as string).toLowerCase()))
    setExistingNames(names)

    // Mark duplicates as skip
    const withDupes = parsed.map(r => ({
      ...r,
      skip: r.skip || names.has(r.name.toLowerCase()),
    }))

    setRows(withDupes)
    setCurrentIdx(0)
    setStep('review')
  }

  const updateRow = (field: keyof ParsedRow, value: string | boolean) => {
    setRows(prev => {
      const updated = [...prev]
      const activeIdx = prev.findIndex((r, i) => !r.skip && activeRows.indexOf(r) === currentIdx)
      // Find the actual index in rows array
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
    if (!currentRow.pricePerPacket || !currentRow.address) {
      setError('Please fill price per packet and address')
      return
    }
    setError('')

    // Save this entry
    const packets = parseInt(currentRow.packetsAllocated) || 0
    await addDoc(collection(db, 'parties'), {
      name: currentRow.name,
      type: currentRow.type,
      category: currentRow.category,
      phone: currentRow.phone,
      email: currentRow.email || '',
      address: currentRow.address,
      place: currentRow.place,
      pricePerPacket: parseFloat(currentRow.pricePerPacket),
      packetsAllocated: packets,
      cartonsAllocated: Math.floor(packets / config.packetsPerCarton),
      lowStockThreshold: 0,
      addedBy: appUser!.uid,
      addedByName: appUser!.name,
      createdAt: Date.now(),
    })
    setImportCount(c => c + 1)

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
        <div style={{ fontSize: 22, fontWeight: 900 }}>CSV Import</div>
        <div style={{ color: '#e0f2fe', fontSize: 13, marginTop: 4 }}>Import distributors & retailers from Zoho</div>
      </div>

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* How to export from Zoho */}
        <div style={{ background: '#161b22', borderRadius: 14, padding: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 10 }}>📋 How to export from Zoho</div>
          {[
            'Go to Zoho Books → Contacts',
            'Click "Export" → Select CSV format',
            'Download the Contacts.csv file',
            'Upload it below',
          ].map((step, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
              <div style={{ width: 20, height: 20, background: 'rgba(8,145,178,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#0891b2', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.5 }}>{step}</div>
            </div>
          ))}
        </div>

        {/* What gets auto-filled */}
        <div style={{ background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.15)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12, color: '#16a34a', fontWeight: 700, marginBottom: 8 }}>✅ Auto-filled from CSV</div>
          {['Name', 'Phone (if available)', 'Email (if available)', 'State / Region'].map(f => (
            <div key={f} style={{ fontSize: 12, color: '#86efac', padding: '2px 0' }}>• {f}</div>
          ))}
        </div>

        <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.15)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 12, color: '#d97706', fontWeight: 700, marginBottom: 8 }}>📝 You fill per entry</div>
          {['Type (Distributor/Retailer)', 'Category', 'Price per packet', 'Full address'].map(f => (
            <div key={f} style={{ fontSize: 12, color: '#fde68a', padding: '2px 0' }}>• {f}</div>
          ))}
        </div>

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Upload button */}
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />

        <button onClick={() => fileRef.current?.click()}
          style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 'none', borderRadius: 14, padding: '18px', fontSize: 15, fontWeight: 800, boxShadow: '0 8px 24px rgba(8,145,178,0.3)' }}>
          📁 Select CSV File
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
          <span style={{ fontSize: 13, color: '#64748b' }}>Skipped</span>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>{rows.length - importCount}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>Total in CSV</span>
          <span style={{ fontSize: 13, color: '#fff', fontWeight: 700 }}>{rows.length}</span>
        </div>
      </div>
      <button onClick={() => onDone(importCount)}
        style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 32px', fontSize: 14, fontWeight: 800 }}>
        View All Entries →
      </button>
    </div>
  )

  // ── REVIEW STEP — one entry at a time ────────────────────────────────────
  if (!currentRow) return null

  const isDuplicate = existingNames.has(currentRow.name.toLowerCase())
  const progress = Math.round(((currentIdx + 1) / activeRows.length) * 100)

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', paddingBottom: 40 }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#0891b2,#0e7490)', padding: '20px 20px 16px' }}>
        <button onClick={onBack} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#bae6fd', padding: '6px 14px', borderRadius: 20, fontSize: 12, marginBottom: 12 }}>← Cancel</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 13, color: '#bae6fd', fontWeight: 700 }}>Entry {currentIdx + 1} of {activeRows.length}</div>
          <div style={{ fontSize: 13, color: '#bae6fd', fontWeight: 700 }}>{progress}%</div>
        </div>
        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', background: '#fff', borderRadius: 99, transition: 'width 0.3s' }} />
        </div>

        {/* Skipped summary */}
        {rows.filter(r => r.skip).length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
            {rows.filter(r => r.skip).length} entries auto-skipped (duplicates / non-business)
          </div>
        )}
      </div>

      <div style={{ padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Auto-filled info */}
        <div style={{ background: '#161b22', borderRadius: 14, padding: 14, border: '1px solid rgba(8,145,178,0.25)' }}>
          <div style={{ fontSize: 11, color: '#0891b2', fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>FROM ZOHO CSV</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', marginBottom: 6 }}>{currentRow.name}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {currentRow.phone && (
              <span style={{ fontSize: 11, background: 'rgba(22,163,74,0.15)', color: '#16a34a', padding: '3px 10px', borderRadius: 99 }}>📞 {currentRow.phone}</span>
            )}
            {currentRow.email && (
              <span style={{ fontSize: 11, background: 'rgba(8,145,178,0.15)', color: '#0891b2', padding: '3px 10px', borderRadius: 99 }}>✉️ {currentRow.email}</span>
            )}
            {currentRow.place && (
              <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', padding: '3px 10px', borderRadius: 99 }}>📍 {currentRow.place}</span>
            )}
            {currentRow.receivables > 0 && (
              <span style={{ fontSize: 11, background: 'rgba(217,119,6,0.15)', color: '#d97706', padding: '3px 10px', borderRadius: 99 }}>₹{currentRow.receivables.toLocaleString()} receivable</span>
            )}
          </div>
        </div>

        {isDuplicate && (
          <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.25)', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#fde68a' }}>
            ⚠️ This name already exists in your network — it will be skipped on import
          </div>
        )}

        {/* Type selector */}
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

        {/* Full address */}
        <Field label="Full Address *">
          <input type="text"
            value={currentRow.address}
            onChange={e => updateRow('address', e.target.value)}
            placeholder="e.g. 12/A MG Road, Ernakulam"
            style={inputStyle()} />
        </Field>

        {/* Price */}
        <Field label="Selling Price Per Single Packet (₹) *" hint="Price you charge them — not your cost price">
          <input type="number"
            value={currentRow.pricePerPacket}
            onChange={e => updateRow('pricePerPacket', e.target.value)}
            placeholder="e.g. 45"
            style={inputStyle()} />
        </Field>

        {/* Packets */}
        <Field label="Packets to Allocate (optional)">
          <input type="number"
            value={currentRow.packetsAllocated}
            onChange={e => updateRow('packetsAllocated', e.target.value)}
            placeholder="Leave empty to set later"
            style={inputStyle()} />
          {currentRow.packetsAllocated && currentRow.pricePerPacket && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#6ee7b7', fontWeight: 600 }}>
              = {toDisplay(parseInt(currentRow.packetsAllocated), config.packetsPerCarton)}
              {' '}• ₹{(parseInt(currentRow.packetsAllocated) * parseFloat(currentRow.pricePerPacket)).toLocaleString()}
            </div>
          )}
        </Field>

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 10, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>
            ⚠️ {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={handleSkipCurrent}
            style={{ flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 700 }}>
            Skip →
          </button>
          <button onClick={handleNext} disabled={isDuplicate}
            style={{ flex: 2, background: isDuplicate ? '#334155' : 'linear-gradient(135deg,#0891b2,#0e7490)', color: isDuplicate ? '#64748b' : '#fff', border: 'none', borderRadius: 12, padding: '14px', fontSize: 14, fontWeight: 800, opacity: isDuplicate ? 0.6 : 1 }}>
            {isDuplicate ? 'Will be skipped' : currentIdx === activeRows.length - 1 ? 'Import & Finish ✅' : 'Import & Next →'}
          </button>
        </div>

        {/* Upcoming entries preview */}
        {activeRows.length > currentIdx + 1 && (
          <div style={{ background: '#161b22', borderRadius: 12, padding: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>NEXT UP</div>
            {activeRows.slice(currentIdx + 1, currentIdx + 4).map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: '#64748b', padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#334155' }}>{currentIdx + 2 + i}.</span> {r.name}
                {existingNames.has(r.name.toLowerCase()) && <span style={{ fontSize: 10, color: '#d97706' }}>duplicate</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
