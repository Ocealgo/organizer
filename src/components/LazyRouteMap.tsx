import { lazy, Suspense, ComponentProps } from 'react'
import { useTheme } from '../context/ThemeContext'
import type RouteMapType from './RouteMap'

/**
 * The day's stops, fetched only when a manager opens a day.
 *
 * Leaflet is around 45KB gzipped and this is a reports screen. It shares the
 * chunk with the pin picker, so a manager who has already placed a shop on a
 * map pays nothing to see a route.
 */
const RouteMap = lazy(() => import('./RouteMap'))

export default function LazyRouteMap(props: ComponentProps<typeof RouteMapType>) {
  const { t } = useTheme()
  return (
    <Suspense fallback={
      <div style={{
        height: props.height ?? 300, borderRadius: 6,
        border: `0.5px solid ${t.border}`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: t.text3,
      }}>
        Loading the map…
      </div>
    }>
      <RouteMap {...props} />
    </Suspense>
  )
}
