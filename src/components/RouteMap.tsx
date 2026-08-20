import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useTheme } from '../context/ThemeContext'

/**
 * A day's stops, in the order they happened.
 *
 * Not a route in the satnav sense and deliberately not sold as one — nothing
 * here knows which roads anybody took. It is the sequence of places the app
 * already recorded a position for: where the day started, where each shop was
 * punched into, where it ended. Joined by a straight line because a straight
 * line is honestly what is known, and drawing a road would be inventing one.
 *
 * That needs no background tracking, no foreground service, no permanent
 * notification and no battery. It also works for reps on iPhone, who cannot be
 * tracked continuously at all — a web app stops receiving positions the moment
 * the screen locks, so anything built on breadcrumbs would have covered half
 * the team and quietly missed the other half.
 */

export interface RouteStop {
  lat: number
  lng: number
  /** "Started the day", a shop name, "Finished". */
  title: string
  /** The time, and anything else worth a line. */
  detail?: string
}

interface Props {
  stops: RouteStop[]
  height?: number
}

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL
  || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const TILE_ATTR = import.meta.env.VITE_MAP_TILE_ATTR
  || '© OpenStreetMap contributors'

/** A, B … Z, then AA, AB. Past twenty-six stops nobody is reading letters anyway. */
export function stopLabel(i: number): string {
  let n = i, out = ''
  do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1 } while (n >= 0)
  return out
}

export default function RouteMap({ stops, height = 300 }: Props) {
  const { t } = useTheme()
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!host.current || map.current) return
    const m = L.map(host.current, { attributionControl: true, scrollWheelZoom: false })
    L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    // Leaflet measures its container on creation; inside a panel that is still
    // laying out that measurement is zero and the tiles come back grey.
    setTimeout(() => m.invalidateSize(), 0)
    return () => { m.remove(); map.current = null; layer.current = null }
  }, [])

  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    if (stops.length === 0) return

    const points: L.LatLngExpression[] = stops.map(s => [s.lat, s.lng])

    // The line first, so the markers sit on top of it rather than under.
    if (points.length > 1) {
      L.polyline(points, {
        color: t.accent, weight: 2, opacity: 0.9,
        // Dashed, because the line between two recorded points is an
        // assumption about the journey rather than a record of it.
        dashArray: '5 6',
      }).addTo(g)
    }

    stops.forEach((s, i) => {
      const label = stopLabel(i)
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html:
            `<div style="width:26px;height:26px;border-radius:50%;` +
            `background:${t.accent};color:${t.bg};` +
            `display:flex;align-items:center;justify-content:center;` +
            `font-size:12px;font-weight:600;font-family:inherit;` +
            `box-shadow:0 0 0 2px ${t.bg2};">${label}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        }),
      })
        .addTo(g)
        .bindPopup(
          `<strong>${label} · ${escapeHtml(s.title)}</strong>` +
          (s.detail ? `<br/>${escapeHtml(s.detail)}` : ''),
        )
    })

    m.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 })
  }, [stops, t.accent, t.bg, t.bg2])

  return (
    <div ref={host} style={{
      height, width: '100%', borderRadius: 6,
      border: `0.5px solid ${t.border}`, overflow: 'hidden',
      // Leaflet's panes sit above everything unless given their own stacking.
      zIndex: 0, position: 'relative',
    }} />
  )
}

/** Popups take an HTML string, and a shop can be called anything. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
