import type { Holiday } from '../types'
import { Day, MARK_LETTER, REGISTER_TOTALS, Summary } from './attendance'

/**
 * The attendance register as a PDF: one A4 landscape page per month, a row per
 * rep, a letter per day — the screen's grid, for the file, the printer and the
 * person who was not looking at the app.
 *
 * Loaded on demand, like the other PDFs: jsPDF is a few hundred kilobytes and
 * nobody who never presses the button should carry it.
 */
export interface RegisterRow {
  name: string
  days: Day[]
  sum: Summary
}

// The app's colours, as RGB, for a page that is always printed on white.
const GOOD: [number, number, number] = [22, 101, 52]
const WARN: [number, number, number] = [161, 73, 10]
const OFF: [number, number, number] = [185, 28, 28]
const LEAVE: [number, number, number] = [71, 85, 105]
const MUTED: [number, number, number] = [100, 116, 139]
const INK: [number, number, number] = [17, 24, 39]
const SHADE: [number, number, number] = [241, 245, 249]

const colourOf = (d: Day) =>
  d.mark === 'present' || d.mark === 'auto_closed' ? GOOD
    : d.mark === 'half' || d.mark === 'absent' ? WARN
    : d.mark === 'holiday' || d.mark === 'off' ? OFF
    : d.mark === 'leave' || d.mark === 'requested' ? LEAVE : MUTED

export async function downloadAttendancePdf(
  month: string, dates: string[], rows: RegisterRow[], holidays: Holiday[],
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 28
  const monthName = new Date(month + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const inMonth = holidays.filter(h => h.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))
  const holidayOn = new Map(inMonth.map(h => [h.date, h.name]))
  const isOff = (d: string) => new Date(d + 'T00:00:00').getDay() === 0 || holidayOn.has(d)

  // ── header ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK)
  doc.text(`Ocealgo — Attendance, ${monthName}`, M, M + 6)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED)
  doc.text(`As the app recorded it · generated ${new Date().toLocaleString('en-IN')}`, M, M + 22)
  if (inMonth.length) {
    doc.setTextColor(...OFF)
    doc.text(`Holidays: ${inMonth.map(h => `${h.name} (${Number(h.date.slice(8))})`).join(', ')}`, M, M + 35)
  }

  // ── the grid ──────────────────────────────────────────────────────────────
  const weekday = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'narrow' })
  const head = [['Name', ...dates.map(d => `${Number(d.slice(8))}\n${weekday(d)}`),
    ...REGISTER_TOTALS.map(c => c.head.replace(' ', '\n'))]]
  // No "½" in the built-in fonts, so leave days are written 2.5 here.
  const days = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1)
  const leaveCol = dates.length + 1 + REGISTER_TOTALS.findIndex(c => c.key)
  // jsPDF's built-in fonts have no "½", so the PDF says "H/2" where the screen
  // says "½".
  const letter = (d: Day) => d.mark === 'half' ? 'H/2' : MARK_LETTER[d.mark] || ''
  const body = rows.map(r => [
    `${r.name}\n${days(r.sum.leaveDays)} leave taken`,
    ...r.days.map(letter),
    ...REGISTER_TOTALS.map(c => c.days ? days(c.of(r.sum)) : String(c.of(r.sum))),
  ])

  autoTable(doc, {
    startY: M + (inMonth.length ? 46 : 34),
    margin: { left: M, right: M },
    head, body,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 2.5, halign: 'center', valign: 'middle',
              textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.4 },
    headStyles: { fillColor: [248, 250, 252], textColor: MUTED, fontStyle: 'bold', fontSize: 6.5 },
    columnStyles: { 0: { halign: 'left', cellWidth: 92, fontSize: 7.5 } },
    didParseCell: data => {
      const col = data.column.index
      const day = col >= 1 && col <= dates.length ? dates[col - 1] : null
      // Sundays and holidays shaded down the whole column, heading red.
      if (day && isOff(day)) {
        data.cell.styles.fillColor = SHADE
        if (data.section === 'head') data.cell.styles.textColor = OFF
      }
      if (data.section === 'body' && day) {
        const d = rows[data.row.index].days[col - 1]
        data.cell.styles.textColor = colourOf(d)
        data.cell.styles.fontStyle = 'bold'
      }
      if (data.section === 'body' && col === 0) data.cell.styles.fontStyle = 'bold'
      // The leave total is the figure people come to the file for.
      if (col === leaveCol) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.textColor = INK }
    },
  })

  // ── the key ───────────────────────────────────────────────────────────────
  const end = (doc as any).lastAutoTable?.finalY ?? M + 60
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(
    'P present · H/2 half day · A absent '
    + '(marked automatically: no punch-in) · L leave · L? leave requested · H holiday · – no record. '
    + 'Shaded columns are Sundays and holidays; a P on one was worked on a day off. '
    + 'Leave taken: a full day of leave or an absence counts 1, a half day counts 0.5 — two half days are one day; '
    + 'Applied is leave asked for and approved, Automatic is leave marked for no punch-in.',
    W - 2 * M), M, end + 14)

  doc.save(`ocealgo-attendance_${month}.pdf`)
}
