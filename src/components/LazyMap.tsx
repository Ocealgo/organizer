import { lazy, Suspense, ComponentProps } from 'react'
import { useTheme } from '../context/ThemeContext'
import type MapPickerType from './MapPicker'

/**
 * The map, fetched only when somebody actually opens one.
 *
 * Leaflet and its stylesheet are about 45KB gzipped. Most people who open this
 * app are reps on a phone somewhere with two bars, starting a day and logging
 * visits, and they will never place a pin — making them download a mapping
 * library first is a cost paid by everyone for something few of them use.
 *
 * Behind a dynamic import it is fetched at the moment the map is asked for,
 * and never otherwise. Everything else about the component is unchanged, so
 * call sites only have to import this instead.
 */
const MapPicker = lazy(() => import('./MapPicker'))

export default function LazyMap(props: ComponentProps<typeof MapPickerType>) {
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
      <MapPicker {...props} />
    </Suspense>
  )
}
