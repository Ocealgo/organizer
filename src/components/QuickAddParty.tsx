import { useState } from 'react'
import { collection, addDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import {
  Party, PartyType, PartyCategory, GeoPoint,
  OutletType, OUTLET_TYPE_LABEL,
} from '../types'
import CustomSelect from './CustomSelect'
import { Field, ChipGroup, Note, GhostButton, PrimaryButton, inputStyle } from './ui'

/**
 * Adding a distributor or retailer from the field, mid-visit.
 *
 * The Network screen asks for the full record — address, district, state,
 * pincode, opening allocation. That form is for someone at a desk. A rep
 * standing in a shop they have just walked into needs the shortest thing that
 * still produces a usable record: who they are, how to reach them, where they
 * are. Everything else is filled in later from Network, and the entry is
 * created as a prospect exactly like any other, so nothing downstream has to
 * know it came from here.
 */

const CATEGORIES: PartyCategory[] = ['FMCG', 'Pharma', 'General Store', 'Supermarket', 'Online', 'Other']

/** The channel that goes with a type, before the rep changes it. */
const defaultOutletType = (type: PartyType): OutletType =>
  type === 'distributor' ? 'distributor' : 'general'

function validatePhone(p: string) { return /^[6-9]\d{9}$/.test(p.trim()) }

interface Props {
  /** Every party, for the duplicate checks and the parent-distributor list. */
  parties: Party[]
  /** Where the rep is standing. Becomes the shop's registered position. */
  coordinates?: GeoPoint | null
  onCancel: () => void
  /** The saved party, id included, so the caller can carry straight on. */
  onCreated: (party: Party) => void
}

export default function QuickAddParty({ parties, coordinates, onCancel, onCreated }: Props) {
  const { appUser } = useAuth()
  const { t } = useTheme()

  const [type, setType] = useState<PartyType>('retailer')
  const [outletType, setOutletType] = useState<OutletType>('general')
  const [category, setCategory] = useState<PartyCategory>('General Store')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [place, setPlace] = useState('')
  const [address, setAddress] = useState('')
  const [underDistributorId, setUnderDistributorId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const distributors = parties.filter(p => p.type === 'distributor')

  const changeType = (ty: PartyType) => {
    setType(ty)
    setOutletType(defaultOutletType(ty))
    if (ty === 'distributor') setUnderDistributorId('')
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Enter the shop or firm name.'
    if (!validatePhone(phone)) e.phone = 'Enter a 10-digit Indian mobile number.'
    if (!place.trim()) e.place = 'Enter the place or area.'

    const phoneDup = parties.find(p => p.phone.trim() === phone.trim())
    if (phoneDup) e.phone = `This number is already registered to ${phoneDup.name}.`

    const nameDup = parties.find(p =>
      p.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      (p.place || '').trim().toLowerCase() === place.trim().toLowerCase())
    if (nameDup) e.name = `A ${nameDup.type} called ${nameDup.name} already exists at ${nameDup.place}.`

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const save = async () => {
    if (!appUser || !validate()) return
    setSaving(true); setFailed(null)
    try {
      const parent = distributors.find(d => d.id === underDistributorId)
      const data = {
        name: name.trim(),
        type,
        outletType,
        category,
        phone: phone.trim(),
        address: address.trim(),
        place: place.trim(),
        district: '', state: '', pincode: '',
        pricePerPacket: 0,
        packetsAllocated: 0,
        cartonsAllocated: 0,
        lowStockThreshold: 0,
        // The rules only accept a party created as a prospect.
        status: 'prospect' as const,
        ...(type === 'retailer' && parent
          ? { underDistributorId: parent.id!, underDistributorName: parent.name }
          : {}),
        // Registering the position now saves the next rep a geofence miss.
        ...(coordinates ? { coordinates } : {}),
        addedBy: appUser.uid,
        addedByName: appUser.name,
        createdAt: Date.now(),
      }
      const ref = await addDoc(collection(db, 'parties'), data)

      await addDoc(collection(db, 'alerts'), {
        type: 'new_party',
        message: `${appUser.name} added ${type}: ${data.name} during a field visit`,
        relatedId: ref.id, read: false, createdAt: Date.now(),
      })

      onCreated({ id: ref.id, ...data } as Party)
    } catch (err: any) {
      console.error('[QuickAddParty] create failed', err)
      setFailed(err?.message || 'Could not save this outlet. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 460 }}>
      <Note>
        Just enough to start visiting them. The full address, district and
        opening allocation can be added later from Network.
      </Note>

      <Field label="Type">
        <ChipGroup
          value={type}
          onChange={changeType}
          options={[
            { id: 'retailer' as PartyType, label: 'Retailer' },
            { id: 'distributor' as PartyType, label: 'Distributor' },
          ]}
        />
      </Field>

      <Field label="Channel" hint="Decides what the visit form asks you for.">
        <CustomSelect
          value={outletType}
          onChange={v => setOutletType(v as OutletType)}
          searchable={false}
          options={(Object.keys(OUTLET_TYPE_LABEL) as OutletType[])
            .map(k => ({ value: k, label: OUTLET_TYPE_LABEL[k] }))}
        />
      </Field>

      <Field label="Category">
        <ChipGroup value={category} onChange={setCategory}
          options={CATEGORIES.map(c => ({ id: c, label: c }))} />
      </Field>

      {type === 'retailer' && distributors.length > 0 && (
        <Field label="Parent distributor"
          hint="Leave it unset if they buy from us directly.">
          <CustomSelect
            value={underDistributorId}
            onChange={setUnderDistributorId}
            placeholder="Independent retailer"
            options={[
              { value: '', label: 'Independent retailer' },
              ...distributors.map(d => ({ value: d.id!, label: d.name, sub: d.place || d.address })),
            ]}
          />
        </Field>
      )}

      <Field label="Shop or firm name" error={errors.name}>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder="Rajan Enterprises" style={inputStyle(t)} />
      </Field>

      <Field label="Phone number" error={errors.phone}>
        <input type="tel" inputMode="numeric" value={phone}
          onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          placeholder="10-digit mobile number" style={inputStyle(t)} />
      </Field>

      <Field label="Place or area" error={errors.place}>
        <input value={place} onChange={e => setPlace(e.target.value)}
          placeholder="Koramangala" style={inputStyle(t)} />
      </Field>

      <Field label="Address" hint="Optional — the street address if you have it.">
        <input value={address} onChange={e => setAddress(e.target.value)}
          placeholder="12/A, MG Road" style={inputStyle(t)} />
      </Field>

      <div style={{ fontSize: 13, fontWeight: 400, color: t.text3, lineHeight: 1.6 }}>
        {coordinates
          ? 'This outlet will be registered at where you are standing now.'
          : 'No location available, so the outlet is saved without a position.'}
      </div>

      {failed && <div style={{ fontSize: 13, color: t.warn }}>{failed}</div>}

      <div className="oc-wrap" style={{ gap: 10, marginTop: 4 }}>
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? 'Saving…' : `Save ${type}`}
        </PrimaryButton>
        <GhostButton onClick={onCancel} disabled={saving}>Cancel</GhostButton>
      </div>
    </div>
  )
}
