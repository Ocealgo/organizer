import type { RepWeek } from './RepMonitor'

/**
 * The Report tab as a PDF: the same leaderboard and table, on a page that can
 * be sent to somebody who does not have the app.
 *
 * Loaded on demand. jsPDF is a few hundred kilobytes, and nobody who never
 * presses the button should pay for it on every load of the dashboard.
 *
 * Money is written "Rs" rather than "₹". jsPDF's built-in fonts have no rupee
 * sign and print a blank box in its place; embedding a font that has one would
 * add more weight than the symbol is worth on a report everybody here reads
 * in rupees anyway.
 */
export interface RepReportMeta {
  /** e.g. "Mon, 12 Oct – Sat, 17 Oct · Monday to Saturday" */
  period: string
  product: string
  beat: string
  /** What the bars rank by, e.g. "Packets ordered". */
  rankTitle: string
  /** The value each bar shows, in the units of rankTitle. */
  rankValue: (r: RepWeek) => number
  rankFormat: (n: number) => string
  from: string
  to: string
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString('en-IN')}`

const ordinal = (n: number) => {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'
  return `${n}${tail}`
}

export async function downloadRepReportPdf(rows: RepWeek[], meta: RepReportMeta): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  // Landscape: eleven columns do not fit across a portrait page legibly.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  const INK = [17, 24, 39] as const
  const MUTED = [100, 116, 139] as const
  const MARK = [42, 120, 214] as const   // the app's light-theme bar colour
  const TRACK = [226, 232, 240] as const
  let y = M

  // ── header ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK)
  doc.text('Ocealgo — Rep report', M, y + 4)
  y += 22
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED)
  doc.text(meta.period.replace(/–/g, '-'), M, y)
  y += 14
  doc.text(`Product: ${meta.product}   ·   Beat: ${meta.beat}   ·   Ranked by: ${meta.rankTitle}`, M, y)
  y += 14
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, M, y)
  y += 26

  // ── leaderboard ───────────────────────────────────────────────────────────
  // The same rule the screen uses: level reps share a place, zero has none.
  doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK)
  doc.text(meta.rankTitle, M, y)
  y += 16
  const values = rows.map(meta.rankValue)
  const max = Math.max(...values, 0)
  const placeOf = (i: number) => {
    if (values[i] <= 0) return null
    let j = i
    while (j > 0 && values[j - 1] === values[i]) j--
    return j + 1
  }
  const nameX = M + 34
  const barX = M + 190
  const barW = W - M - barX - 110
  rows.forEach((r, i) => {
    const place = placeOf(i)
    doc.setFontSize(10)
    doc.setFont('helvetica', place === 1 ? 'bold' : 'normal')
    const ink = place === 1 ? INK : MUTED
    doc.setTextColor(ink[0], ink[1], ink[2])
    doc.text(place ? ordinal(place) : '-', M, y + 7)
    doc.setTextColor(...INK)
    doc.text(r.name, nameX, y + 7)
    doc.setFillColor(...TRACK).rect(barX, y, barW, 8, 'F')
    if (values[i] > 0 && max > 0) {
      doc.setFillColor(...MARK).rect(barX, y, Math.max(2, (values[i] / max) * barW), 8, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.text(meta.rankFormat(values[i]).replace(/₹/g, 'Rs '), W - M, y + 7, { align: 'right' })
    y += 20
  })
  if (rows.length === 0) {
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED)
    doc.text('No reps in this report.', M, y + 7)
    y += 20
  }
  y += 14

  // ── the table ─────────────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Rep', 'Area', 'Days worked', 'Visits', 'Shops', 'Orders', 'Packets', 'Value',
            'Target', 'Days met', 'Meter', 'Expenses']],
    body: rows.map(r => [
      r.name,
      r.areas.length ? r.areas.join(', ') : '-',
      r.daysWorked,
      r.visits,
      r.shops,
      r.orders,
      r.packets.toLocaleString('en-IN'),
      rs(r.value),
      r.target === null ? 'Not set' : r.target.toLocaleString('en-IN'),
      r.daysTargeted === 0 ? '-' : `${r.daysMet} / ${r.daysTargeted}`,
      r.meterKm ? `${r.meterKm} km` : 'Nil',
      r.expenses ? rs(r.expenses) : 'None',
    ]),
    styles: { font: 'helvetica', fontSize: 9, textColor: [...INK], cellPadding: 5 },
    headStyles: { fillColor: [241, 245, 249], textColor: [...MUTED], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 80 },
      1: { cellWidth: 130 },
      ...Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => [i, { halign: 'right' as const }])),
    },
    theme: 'grid',
  })

  // ── what the figures mean, as on the screen ───────────────────────────────
  const end = (doc as any).lastAutoTable?.finalY ?? y
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(
    'The product filter narrows packets, value, targets and days met. Visits, shops, the meter and '
    + 'expenses are the rep\'s whole day either way. With a beat chosen, only the days that beat was '
    + 'assigned are counted. Cancelled orders and abandoned visits are left out. Days are counted up '
    + 'to today.', W - 2 * M), M, end + 18)

  doc.save(`ocealgo-rep-report_${meta.from}_${meta.to}.pdf`)
}
