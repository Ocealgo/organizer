import { test, expect } from './fixtures/app'
import {
  closedDay, autoMarkedLeave, approvedLeave, noOneOnDuty, noLeaveRecorded, todayLocal,
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

  test('the register downloads as a spreadsheet', async ({ page, loginAs }) => {
    await closedDay('rep', todayLocal(), { km: 47 })
    await loginAs('admin')
    await page.getByRole('button', { name: /^Attendance/ }).first().click()
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download Excel' }).click(),
    ])
    expect(file.suggestedFilename()).toBe(`ocealgo-attendance_${todayLocal().slice(0, 7)}.xlsx`)
  })
})
