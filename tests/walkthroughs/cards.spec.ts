import { test } from '@playwright/test'

// Cards are rendered at exactly the clips' pixel size with no device scaling,
// so ffmpeg concatenates them without letterboxing or a resample.
test.use({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
})

/**
 * Title cards for the stitched training film.
 *
 * Rendered in the app's own theme and screenshotted at the same size as the
 * clips, so a card never looks bolted on to the footage it introduces. Built
 * here rather than in an editor for the same reason the walkthroughs are
 * scripted: when a chapter is renamed, you re-run this instead of reopening a
 * project file somebody else owns.
 *
 * Run via `npm run walkthroughs:cards`; `stitch.mjs` picks them up by name.
 */

const CARDS = [
  { file: '00-intro',    eyebrow: 'Ocealgo · Field app',   title: 'Your day, start to finish', sub: 'Six short walkthroughs for sales officers' },
  { file: '01-card',     eyebrow: 'One',                   title: 'Signing in',                sub: 'And what your home screen is telling you' },
  { file: '02-card',     eyebrow: 'Two',                   title: 'Starting your day',         sub: 'Nothing unlocks until you punch in' },
  { file: '03-card',     eyebrow: 'Three',                 title: 'Visiting an outlet',        sub: 'Shelf, competitors, order, outcome' },
  { file: '04-card',     eyebrow: 'Four',                  title: 'Adding a shop',             sub: 'When it is not on your list yet' },
  { file: '05-card',     eyebrow: 'Five',                  title: 'Logging your expenses',     sub: 'Allowance, fuel, and the weekly submit' },
  { file: '06-card',     eyebrow: 'Six',                   title: 'Ending your day',           sub: 'The closing reading, and why it matters' },
  { file: '99-outro',    eyebrow: 'That is the day',       title: 'Questions?',                sub: 'Ask your sales manager, or the admin team' },
]

const html = (c: typeof CARDS[number]) => `
<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:#0d1117;color:#f1f5f9;
       font-family:'Trebuchet MS',sans-serif;display:flex;flex-direction:column;
       justify-content:center;padding:0 34px}
  .eyebrow{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:#475569;margin-bottom:14px}
  h1{font-size:31px;font-weight:500;line-height:1.25;letter-spacing:-.01em}
  .sub{font-size:15px;font-weight:400;color:#94a3b8;line-height:1.6;margin-top:12px}
  .rule{height:.5px;background:rgba(255,255,255,.14);margin-top:30px}
</style></head><body>
  <div class="eyebrow">${c.eyebrow}</div>
  <h1>${c.title}</h1>
  <div class="sub">${c.sub}</div>
  <div class="rule"></div>
</body></html>`

test('render title cards', async ({ page }) => {
  for (const c of CARDS) {
    await page.setContent(html(c))
    await page.screenshot({ path: `tests/walkthroughs/cards/${c.file}.png` })
  }
})
