import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../context/ThemeContext'
import { GeoPoint } from '../types'
import { GhostButton, inputStyle } from './ui'

/**
 * A map you can put a pin on.
 *
 * Leaflet rather than Google, for reasons that are about this app rather than
 * about maps: it needs no API key, so nothing has to be embedded in an APK
 * where anyone can pull it out, and no billing account has to stay healthy for
 * the field app to keep working.
 *
 * Both the tiles and the address search are configured rather than hard-coded.
 * The defaults are OpenStreetMap's own endpoints, which need no signup and are
 * the right way to start — but they are donated infrastructure, and their
 * usage policies are written for light use rather than for an app leaning on
 * them. When this is carrying real traffic, set the two env vars below to a
 * provider with commercial terms (MapTiler, Stadia, Geoapify and others serve
 * the same OSM data) and nothing in this file changes.
 *
 *   VITE_MAP_TILE_URL   — an {s}/{z}/{x}/{y} tile template
 *   VITE_MAP_TILE_ATTR  — the attribution that template requires
 *   VITE_GEOCODE_URL    — a search endpoint taking ?q=, returning Nominatim's shape
 */
const TILE_URL = import.meta.env.VITE_MAP_TILE_URL
  || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = import.meta.env.VITE_MAP_TILE_ATTR
  || '© OpenStreetMap contributors'
const GEOCODE_URL = import.meta.env.VITE_GEOCODE_URL
  || 'https://nominatim.openstreetmap.org/search'

/** Kochi. Only ever used when there is nothing at all to centre on. */
const FALLBACK: [number, number] = [9.9312, 76.2673]

/**
 * The pin, drawn rather than fetched.
 *
 * Leaflet's default marker is a PNG whose URL it works out by guessing a path
 * relative to its own stylesheet. Under a bundler that stylesheet is hashed
 * into /assets/ and the guess misses, so the marker renders as a broken image
 * — which is exactly what it did.
 *
 * The usual remedy is to import the three PNGs and hand Leaflet their hashed
 * URLs. Drawing it instead removes the class of problem rather than patching
 * this instance of it: no asset resolution to get wrong, no extra request on a
 * connection that may not have one to spare, and the pin can be the app's own
 * accent instead of Leaflet blue in a design that uses colour only to mean
 * something.
 */
function pinIcon(color: string) {
  return L.divIcon({
    // Leaflet's own divIcon class draws a white box with a border behind this.
    className: '',
    html:
      `<svg width="26" height="34" viewBox="0 0 26 34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<path d="M13 0C5.8 0 0 5.8 0 13c0 9.8 13 21 13 21s13-11.2 13-21C26 5.8 20.2 0 13 0z" fill="${color}"/>` +
      `<circle cx="13" cy="13" r="4.5" fill="#fff"/>` +
      `</svg>`,
    iconSize: [26, 34],
    // The tip of the pin is the position, not the middle of the artwork.
    iconAnchor: [13, 34],
  })
}

interface Props {
  /** Where the pin starts. Null centres on `near`, or on the fallback. */
  value: GeoPoint | null
  /** Roughly where to look when there is no pin yet — usually the user. */
  near?: GeoPoint | null
  onChange: (lat: number, lng: number) => void
  /** Offer address search. Off for a rep who is standing at the shop. */
  search?: boolean
  height?: number
}

interface Hit { label: string; lat: number; lng: number }

export default function MapPicker({ value, near, onChange, search = false, height = 300 }: Props) {
  const { t } = useTheme()
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // ── the map, built once ───────────────────────────────────────────────────
  useEffect(() => {
    if (!host.current || map.current) return

    const start: [number, number] = value
      ? [value.lat, value.lng]
      : near ? [near.lat, near.lng] : FALLBACK

    const m = L.map(host.current, { attributionControl: true })
      .setView(start, value || near ? 17 : 12)
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(m)

    // Tapping the map is the primary gesture — dragging the pin is fiddly with
    // a thumb, and on a phone the pin is often under the thumb already.
    m.on('click', (e: L.LeafletMouseEvent) => onChange(e.latlng.lat, e.latlng.lng))

    map.current = m
    // Leaflet measures its container on creation. Inside a panel that is still
    // laying out, that measurement is zero and the tiles come back grey.
    setTimeout(() => m.invalidateSize(), 0)

    return () => { m.remove(); map.current = null; marker.current = null }
    // Built from the first value it is given and then driven by the effect
    // below — rebuilding on every change would fight the user's panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── the pin follows the value ─────────────────────────────────────────────
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!value) {
      if (marker.current) { marker.current.remove(); marker.current = null }
      return
    }
    const at: [number, number] = [value.lat, value.lng]
    if (marker.current) {
      marker.current.setLatLng(at)
      // Follows the theme if it is switched while the map is open.
      marker.current.setIcon(pinIcon(t.accent))
    } else {
      marker.current = L.marker(at, { draggable: true, icon: pinIcon(t.accent) })
        .on('dragend', ev => {
          const p = (ev.target as L.Marker).getLatLng()
          onChange(p.lat, p.lng)
        })
        .addTo(m)
    }
    if (!m.getBounds().contains(at)) m.setView(at, Math.max(m.getZoom(), 16))
  }, [value, onChange, t.accent])

  // ── address search ────────────────────────────────────────────────────────
  async function runSearch() {
    const term = q.trim()
    if (!term) return
    setSearching(true); setSearchError(null); setHits(null)
    try {
      // countrycodes keeps "MG Road" in Kerala rather than in another country
      // that also has one, which is most of them.
      const url = `${GEOCODE_URL}?format=json&limit=5&countrycodes=in&q=${encodeURIComponent(term)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`Search returned ${res.status}`)
      const raw = await res.json()
      const found: Hit[] = (Array.isArray(raw) ? raw : []).map((r: any) => ({
        label: String(r.display_name ?? ''),
        lat: parseFloat(r.lat), lng: parseFloat(r.lon),
      })).filter((h: Hit) => !isNaN(h.lat) && !isNaN(h.lng))
      setHits(found)
      if (found.length === 0) setSearchError('Nothing found for that. Try the area or the road on its own.')
    } catch (e: any) {
      console.error('[MapPicker] address search failed', e)
      // Search failing must never stop somebody placing a pin by hand.
      setSearchError('Could not search for that address. Place the pin on the map instead.')
    } finally {
      setSearching(false)
    }
  }

  function take(hit: Hit) {
    setHits(null); setQ(hit.label)
    map.current?.setView([hit.lat, hit.lng], 17)
    onChange(hit.lat, hit.lng)
  }

  return (
    <div>
      {search && (
        <div style={{ marginBottom: 10 }}>
          <div className="oc-wrap" style={{ gap: 8 }}>
            <input value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runSearch() } }}
              placeholder="Search an address or area"
              style={{ ...inputStyle(t), flex: '1 1 200px', width: 'auto' }} />
            <GhostButton onClick={runSearch} disabled={searching || !q.trim()}>
              {searching ? 'Searching…' : 'Search'}
            </GhostButton>
          </div>

          {hits && hits.length > 0 && (
            <div style={{ marginTop: 8, borderBottom: `0.5px solid ${t.border}` }}>
              {hits.map((h, i) => (
                <button key={i} className="oc-row" onClick={() => take(h)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none',
                           border: 'none', borderTop: `0.5px solid ${t.border}`, padding: '10px 8px',
                           fontSize: 13, color: t.text, cursor: 'pointer', lineHeight: 1.5 }}>
                  {h.label}
                </button>
              ))}
            </div>
          )}
          {searchError && (
            <div style={{ fontSize: 13, color: t.text3, marginTop: 8 }}>{searchError}</div>
          )}
        </div>
      )}

      <div ref={host} style={{
        height, width: '100%', borderRadius: 6,
        border: `0.5px solid ${t.border}`, overflow: 'hidden',
        // Leaflet's own panes sit above everything unless told otherwise, and
        // this map lives inside panels that have their own stacking.
        zIndex: 0, position: 'relative',
      }} />

      <div style={{ fontSize: 12, color: t.text3, marginTop: 8, lineHeight: 1.6 }}>
        {value
          ? 'Tap the map or drag the pin to move it.'
          : 'Tap the map to place the pin.'}
      </div>
    </div>
  )
}
