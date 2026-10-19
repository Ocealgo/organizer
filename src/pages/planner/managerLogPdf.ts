import type { ManagerActivity } from '../../types'
import { MANAGER_ACTIVITY_LABEL } from '../../types'

/**
 * Monitor managers as a PDF: every entry in the window, by day, with what it
 * was, who it was with, how long, and the notes.
 *
 * Loaded on demand, like the rep report's — jsPDF is a few hundred kilobytes
 * and nobody who never presses the button should carry it.
 */
export interface ManagerLogMeta {
  /** e.g. "Mon, 12 Oct - Sun, 18 Oct" */
  period: string
  /** "Everybody", or the one manager filtered to. */
  who: string
  from: string
  to: string
}

const longDay = (d: string) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

export async function downloadManagerLogPdf(
  days: [string, ManagerActivity[]][], meta: ManagerLogMeta,
): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  const INK: [number, number, number] = [17, 24, 39]
  const MUTED: [number, number, number] = [100, 116, 139]
  const entries = days.reduce((n, [, rows]) => n + rows.length, 0)

  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...INK)
  doc.text('Ocealgo — Monitor managers', M, M + 4)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...MUTED)
  doc.text(meta.period, M, M + 26)
  doc.text(`Who: ${meta.who}   ·   ${entries} ${entries === 1 ? 'entry' : 'entries'}`, M, M + 40)
  doc.text(`Generated ${new Date().toLocaleString('en-IN')}`, M, M + 54)

  // One table, a row per entry, the day carried on each row so a page break
  // never leaves a row without its date.
  const body = days.flatMap(([date, rows]) =>
    [...rows]
      .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt - b.createdAt)
      .map(e => [
        longDay(date),
        e.name,
        MANAGER_ACTIVITY_LABEL[e.kind],
        e.title + (e.updatedAt ? ' (edited)' : ''),
        [e.withNames?.length ? e.withNames.join(', ') : null, e.partyName].filter(Boolean).join(' · ') || '-',
        e.minutes ? `${e.minutes} min` : '-',
        e.notes || '-',
      ]))

  autoTable(doc, {
    startY: M + 72,
    margin: { left: M, right: M },
    head: [['Date', 'Manager', 'What', 'Title', 'With', 'Time', 'Notes']],
    body: body.length ? body : [['', '', '', 'Nothing logged in this window.', '', '', '']],
    styles: { font: 'helvetica', fontSize: 9, textColor: INK, cellPadding: 5, valign: 'top' },
    headStyles: { fillColor: [241, 245, 249], textColor: MUTED, fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 92 },
      1: { cellWidth: 92, fontStyle: 'bold' },
      2: { cellWidth: 74 },
      3: { cellWidth: 130 },
      4: { cellWidth: 120 },
      5: { cellWidth: 46, halign: 'right' },
    },
    theme: 'grid',
  })

  const end = (doc as any).lastAutoTable?.finalY ?? M + 72
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
  doc.text(doc.splitTextToSize(
    'Only what nothing else in the app records: meetings, days out with a rep, and office days. '
    + 'Approvals, dispatches and payments are stamped with their actor where they happen.',
    W - 2 * M), M, end + 18)

  doc.save(`ocealgo-monitor-managers_${meta.from}_${meta.to}.pdf`)
}
