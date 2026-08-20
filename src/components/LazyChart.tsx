import { lazy, Suspense, ComponentProps } from 'react'
import { useTheme } from '../context/ThemeContext'
import type TrendChartType from './TrendChart'

/**
 * The chart, fetched only when somebody opens a report.
 *
 * Recharts and its D3 dependencies are large — larger than the map. Reports are
 * a manager's screen, opened occasionally at a desk; the field app is a rep's,
 * opened every morning on a phone with two bars. Behind a dynamic import the
 * reps never download any of it, which is the same trade LazyMap makes and for
 * the same reason.
 */
const TrendChart = lazy(() => import('./TrendChart'))

export default function LazyChart(props: ComponentProps<typeof TrendChartType>) {
  const { t } = useTheme()
  return (
    <Suspense fallback={
      <div style={{
        height: props.height ?? 220, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontSize: 13, color: t.text3,
      }}>
        Drawing the chart…
      </div>
    }>
      <TrendChart {...props} />
    </Suspense>
  )
}
