import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures/app'
import { managerActivity, todayLocal } from './fixtures/seed'
import { testDate } from './fixtures/clock'

/**
 * Monitor managers: what the managers did, read back by an admin.
 *
 * Its own row in Reports rather than a tab of Monitor reps — other people, an
 * admin's question about them, and entries only an admin may read. So the row
 * is there for an admin and absent for a manager, and the PDF carries what the
 * screen shows.
 */
async function openManagers(page: any) {
  await page.getByRole('button', { name: /^Reports/ }).first().click()
  await page.getByRole('button', { name: /^Monitor managers/ }).click()
  await expect(page.getByRole('heading', { name: 'Monitor managers' })).toBeVisible()
}

test('an admin reads it in Reports, and it is no longer a dashboard tile', async ({ page, loginAs }) => {
  await managerActivity('manager', todayLocal(), { title: 'Monday team review', notes: 'Onam scheme agreed.' })

  await loginAs('admin')
  await expect(page.getByRole('button', { name: /^Manager activity/ })).toHaveCount(0)
  await openManagers(page)

  await expect(page.getByText('Manoj Manager — Monday team review')).toBeVisible()
  await expect(page.getByText('Onam scheme agreed.')).toBeVisible()
})

test('a sales manager does not see the row', async ({ page, loginAs }) => {
  await loginAs('manager')
  await page.getByRole('button', { name: /^Reports/ }).first().click()
  await expect(page.getByRole('button', { name: /^Monitor reps/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Monitor managers/ })).toHaveCount(0)
})

test('downloads as a PDF of the entries shown', async ({ page, loginAs }) => {
  await managerActivity('manager', todayLocal(), {
    kind: 'joint_field', title: 'Out with Ravi', withUids: ['e2e_rep'], withNames: ['Ravi Rep'], minutes: 240,
  })

  await loginAs('admin')
  await openManagers(page)
  const button = page.getByRole('button', { name: 'Download PDF' })
  await expect(button).toBeEnabled()

  const [file] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(file.suggestedFilename()).toMatch(/^ocealgo-monitor-managers_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf$/)

  // jsPDF writes its text uncompressed, so the content can be read off the bytes.
  const text = readFileSync(await file.path()).toString('latin1')
  expect(text.startsWith('%PDF-')).toBe(true)
  expect(text).toContain('(Manoj Manager)')
  expect(text).toContain('(Out with a rep)')
  expect(text).toContain('(Out with Ravi)')
  expect(text).toContain('(240 min)')
})

/** The same "When" as Monitor reps: a day, a week, a month or a range, and the list follows it. */
test('the When filter narrows the entries to the window picked', async ({ page, loginAs }) => {
  const d = testDate(); d.setDate(d.getDate() - 10)
  const earlier = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await managerActivity('manager', todayLocal(), { title: 'Today review' })
  await managerActivity('manager', earlier, { title: 'Older review' })

  await loginAs('admin')
  await openManagers(page)

  // A week opens on this one: today in, ten days ago out.
  await expect(page.getByText('Manoj Manager — Today review')).toBeVisible()
  await expect(page.getByText('Manoj Manager — Older review')).toHaveCount(0)

  // A range reaching back takes in both.
  await page.getByRole('button', { name: 'A range', exact: true }).click()
  await page.getByLabel('From').fill(earlier)
  await page.getByLabel('To', { exact: true }).fill(todayLocal())
  await expect(page.getByText('Manoj Manager — Older review')).toBeVisible()
  await expect(page.getByText('Manoj Manager — Today review')).toBeVisible()

  // A day is that day alone.
  await page.getByRole('button', { name: 'A day', exact: true }).click()
  await page.getByLabel('Day').fill(earlier)
  await expect(page.getByText('Manoj Manager — Older review')).toBeVisible()
  await expect(page.getByText('Manoj Manager — Today review')).toHaveCount(0)
})
