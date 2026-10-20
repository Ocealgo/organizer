import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures/app'
import {
  closedDay, autoMarkedLeave, approvedLeave, noOneOnDuty, noLeaveRecorded, todayLocal, holiday, pendingLeave,
} from './fixtures/seed'
import { testDate } from './fixtures/clock'

/**
 * Attendance, read one way for both sides: the rep's own calendar and the
 * admin's register mark a day the same, because both come from attendance.ts.
 */
test.beforeEach(async () => {
  await noOneOnDuty()
  await noLeaveRecorded()
})

/** A working day before today in this month, or null early in a month. */
function anEarlierWorkday(): string | null {
  const d = testDate()
  for (let back = 1; back <= 6; back++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)
    if (x.getMonth() !== d.getMonth()) return null
    if (x.getDay() !== 0) return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  }
  return null
}

test.describe('a rep reading their own month', () => {
  test('a worked day is present, and says when it ran', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('rep')
    await page.getByRole('button', { name: /My attendance/ }).click()

    const cell = page.getByRole('gridcell', { name: `${todayLocal()}: Present` })
    await expect(cell).toBeVisible()
    await cell.click()
    await expect(page.getByTestId('attendance-detail')).toContainText('Worked')
    await expect(page.getByTestId('attendance-detail')).toContainText('47 km')
  })

  test('an automatic absence says so, and the calendar opens the appeal', async ({ page, loginAs }) => {
    const day = anEarlierWorkday()
    test.skip(!day, 'needs an earlier working day in this month')
    await autoMarkedLeave('rep', day!, 'full_day')
    await loginAs('rep')
    await page.getByRole('button', { name: /My attendance/ }).click()

    const cell = page.getByRole('gridcell', { name: `${day}: Absent` })
    await cell.click()
    await expect(page.getByTestId('attendance-detail')).toContainText('marked automatically')
    await page.getByRole('button', { name: 'This is wrong — appeal it' }).click()
    // The same appeal the list below has: a reason, then to the manager.
    await expect(page.getByPlaceholder(/Phone battery died/)).toBeVisible()
  })
})

test.describe('an admin reading the team', () => {
  test('the register marks each rep by day, and opens their calendar', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await approvedLeave('rep2', todayLocal(), 'full_day')

    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()
    await expect(page.getByRole('heading', { name: 'Attendance' })).toBeVisible()

    const ravi = page.getByTestId('register-row-e2e_rep')
    const priya = page.getByTestId('register-row-e2e_rep2')
    await expect(ravi.locator(`td[data-mark="present"]`)).toHaveCount(1)
    await expect(priya.locator(`td[data-mark="leave"]`)).toHaveCount(1)
    await expect(page.getByTestId('attendance-today')).toContainText('1 in')

    // Into Ravi's own calendar — the view he has.
    await ravi.getByRole('button', { name: 'Ravi Rep' }).click()
    await expect(page.getByText('the same calendar they see')).toBeVisible()
    await expect(page.getByRole('gridcell', { name: `${todayLocal()}: Present` })).toBeVisible()
  })

  test('the register downloads as a PDF', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download PDF' }).click(),
    ])
    expect(file.suggestedFilename()).toBe(`ocealgo-attendance_${todayLocal().slice(0, 7)}.pdf`)
    // jsPDF writes its text uncompressed, so the content can be read off the bytes.
    const text = readFileSync(await file.path()).toString('latin1')
    expect(text.startsWith('%PDF-')).toBe(true)
    expect(text).toContain('(Ravi Rep')
    expect(text).toContain('(P)')
  })
})

/**
 * A holiday declared after the sweep ran: the automatic absence it wrote does
 * not stand against the holiday, on either side's view.
 */
test.describe('a holiday declared late', () => {
  test('overrides an automatic absence already on the day', async ({ page, loginAs }) => {
    const day = anEarlierWorkday()
    test.skip(!day, 'needs an earlier working day in this month')
    await autoMarkedLeave('rep', day!, 'full_day')
    await holiday(day!, 'Declared late')

    await loginAs('rep')
    await page.getByRole('button', { name: /My attendance/ }).click()
    const cell = page.getByRole('gridcell', { name: `${day}: Holiday` })
    await cell.click()
    await expect(page.getByTestId('attendance-detail')).toContainText('it does not count')
    await expect(page.getByTestId('attendance-summary')).not.toContainText('absent')
  })

  test('the register shows it as a holiday, and names it', async ({ page, loginAs }) => {
    const day = anEarlierWorkday()
    test.skip(!day, 'needs an earlier working day in this month')
    await autoMarkedLeave('rep', day!, 'full_day')
    await holiday(day!, 'Declared late')

    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()
    await expect(page.getByTestId('register-row-e2e_rep').locator('td[data-mark="holiday"]')).toHaveCount(1)
    await expect(page.getByTestId('register-row-e2e_rep').locator('td[data-mark="absent"]')).toHaveCount(0)
    await expect(page.getByTestId('holiday-note')).toContainText('Declared late')
  })
})

test('leave cannot be asked for on a holiday', async ({ page, loginAs }) => {
  const d = testDate(); d.setDate(d.getDate() + 3)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  const ahead = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await holiday(ahead, 'Festival')

  await loginAs('rep')
  await page.getByRole('button', { name: /My attendance/ }).click()
  await page.getByRole('button', { name: 'Full day', exact: true }).click()
  await page.locator('input[type=date]').last().fill(ahead)
  await expect(page.getByText('That day is a holiday — Festival. No leave is needed.')).toBeVisible()
})

/** A holiday worked anyway shows both: the day off, and that it was worked. */
test('a holiday worked is shown as a day off that was worked', async ({ page, loginAs }) => {
  await holiday(todayLocal(), 'Vijayadashami')
  await closedDay('rep', todayLocal(), { km: 47 })
  await loginAs('rep')
  await page.getByRole('button', { name: /My attendance/ }).click()

  await page.getByRole('gridcell', { name: `${todayLocal()}: Present` }).click()
  await expect(page.getByTestId('attendance-detail')).toContainText('Holiday — Vijayadashami · worked anyway')
  await expect(page.getByTestId('attendance-summary')).toContainText('1 worked on a day off')
})

test.describe('the leave tab', () => {
  test('one list with a When filter: today first, then a month, then everything', async ({ page, loginAs }) => {
    await approvedLeave('rep2', todayLocal(), 'full_day')
    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()

    await page.getByRole('button', { name: 'Leave', exact: true }).click()
    const box = page.getByTestId('leave-box')
    await expect(box).toContainText('On leave today')
    await expect(box.getByLabel('Leave day')).toBeVisible()
    await expect(box).toContainText('Priya')
    // A day shows what to decide for it, not the team.
    await expect(box.getByText('Team', { exact: true })).toHaveCount(0)
    await expect(box.getByTestId('day-nothing-pending')).toBeVisible()

    await box.getByRole('button', { name: 'A month', exact: true }).click()
    await expect(box).toContainText('Leave days in')
    await expect(box.getByRole('button', { name: 'Previous month' })).toBeVisible()

    await box.getByRole('button', { name: 'Everything', exact: true }).click()
    await expect(box).toContainText('Leave days on record')
  })

  test('a holiday picked is named, on the leave tab and in the register', async ({ page, loginAs }) => {
    await holiday(todayLocal(), 'Test Holiday')
    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()
    await expect(page.getByTestId('attendance-today')).toContainText('Holiday — Test Holiday')

    await page.getByRole('button', { name: 'Leave', exact: true }).click()
    await expect(page.getByTestId('leave-day-off')).toContainText('Holiday — Test Holiday')
  })

  test('requests are on the register, and on the leave tab for their own day', async ({ page, loginAs }) => {
    await pendingLeave('rep2', todayLocal())
    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()
    await expect(page.getByText(/^Leave requests · 1/)).toBeVisible()
    await page.getByRole('button', { name: 'Leave', exact: true }).click()
    await expect(page.getByText(/^Leave requests ·/)).toHaveCount(0)
    await expect(page.getByTestId('day-pending')).toContainText('Priya')
    await expect(page.getByTestId('day-pending').getByRole('button', { name: 'Approve' })).toBeVisible()
  })
})
