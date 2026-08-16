#!/usr/bin/env node
/**
 * Stitch the rep walkthrough clips into one training film.
 *
 * Input is whatever `npm run walkthroughs` last produced: six screen recordings
 * and eight title cards, all already at 412x915. Output is a single mp4 with
 * chapter markers, so a trainer can jump to the part somebody is stuck on
 * instead of scrubbing.
 *
 *   npm run walkthroughs        # record the clips and cards
 *   npm run walkthroughs:film   # this
 *
 * Everything is regenerated from source. Nothing here is hand-edited, which is
 * the point: when a screen changes you re-run both steps rather than reopening
 * a project file in an editor somebody else owns.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const CLIPS = join(ROOT, 'tests/walkthroughs/clips')
const CARDS = join(ROOT, 'tests/walkthroughs/cards')
const OUT_DIR = join(ROOT, 'tests/walkthroughs/film')
const OUT = join(OUT_DIR, 'ocealgo-rep-training.mp4')

/** h.264 will not encode an odd dimension, and the clips are 915 tall. */
const W = 412
const H = 916
const FPS = 30
const CARD_SECONDS = 2.5
const BOOKEND_SECONDS = 3.5

/** winget installs outside PATH for the current shell, so look there too. */
function findBinary(name) {
  const local = process.env.LOCALAPPDATA
  if (local) {
    const base = join(local, 'Microsoft/WinGet/Packages')
    if (existsSync(base)) {
      const stack = [base]
      while (stack.length) {
        const dir = stack.pop()
        for (const e of readdirSync(dir, { withFileTypes: true })) {
          const p = join(dir, e.name)
          if (e.isDirectory()) stack.push(p)
          else if (e.name.toLowerCase() === `${name}.exe`) return p
        }
      }
    }
  }
  return name // fall back to PATH
}

const FFMPEG = findBinary('ffmpeg')
const FFPROBE = findBinary('ffprobe')

const seconds = (file) => parseFloat(execFileSync(FFPROBE, [
  '-v', 'error', '-show_entries', 'format=duration', '-of',
  'default=nw=1:nk=1', file,
], { encoding: 'utf8' }).trim())

/** The clip directory Playwright generated for a given chapter number. */
function clipFor(n) {
  const dirs = readdirSync(CLIPS, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.includes(`-0${n}-`))
  if (!dirs.length) throw new Error(`No clip directory for chapter ${n}. Run: npm run walkthroughs`)
  const video = join(CLIPS, dirs[0].name, 'video.webm')
  if (!existsSync(video)) throw new Error(`No video.webm in ${dirs[0].name}`)
  return video
}

const card = (name) => {
  const p = join(CARDS, `${name}.png`)
  if (!existsSync(p)) throw new Error(`Missing title card ${name}.png. Run: npm run walkthroughs`)
  return p
}

// ── the running order ────────────────────────────────────────────────────────
const CHAPTERS = [
  { title: 'Signing in' },
  { title: 'Starting your day' },
  { title: 'Visiting an outlet' },
  { title: 'Adding a shop' },
  { title: 'Logging your expenses' },
  { title: 'Ending your day' },
]

const segments = [{ kind: 'card', file: card('00-intro'), dur: BOOKEND_SECONDS }]
CHAPTERS.forEach((c, i) => {
  const n = i + 1
  segments.push({ kind: 'card', file: card(`0${n}-card`), dur: CARD_SECONDS, chapter: c.title })
  const clip = clipFor(n)
  segments.push({ kind: 'clip', file: clip, dur: seconds(clip) })
})
segments.push({ kind: 'card', file: card('99-outro'), dur: BOOKEND_SECONDS })

// ── chapter markers ──────────────────────────────────────────────────────────
// A four minute film nobody can navigate is a four minute film nobody watches
// twice. Each chapter starts at its title card, not at the footage.
let t = 0
const marks = []
for (const s of segments) {
  if (s.chapter) marks.push({ start: t, title: s.chapter })
  t += s.dur
}
const total = t
// Chapters have to tile the timeline from zero or the muxer silently rewrites
// the first one, leaving the printed summary disagreeing with the file. The
// opening card belongs to chapter one rather than to nothing.
if (marks.length) marks[0].start = 0

const meta = [';FFMETADATA1', 'title=Ocealgo — your day, start to finish', 'artist=Ocealgo']
marks.forEach((m, i) => {
  const end = i + 1 < marks.length ? marks[i + 1].start : total
  meta.push('[CHAPTER]', 'TIMEBASE=1/1000',
    `START=${Math.round(m.start * 1000)}`, `END=${Math.round(end * 1000) - 1}`,
    `title=${i + 1}. ${m.title}`)
})

mkdirSync(OUT_DIR, { recursive: true })
const metaFile = join(OUT_DIR, 'chapters.txt')
writeFileSync(metaFile, meta.join('\n') + '\n', 'utf8')

// ── build ────────────────────────────────────────────────────────────────────
const args = []
for (const s of segments) {
  if (s.kind === 'card') args.push('-loop', '1', '-t', String(s.dur), '-i', s.file)
  else args.push('-i', s.file)
}
args.push('-i', metaFile)

// Every segment is normalised to the same size, rate and pixel format before
// concat — mixing a VP8 recording with a still PNG otherwise fails or produces
// a stream players refuse partway through.
const filters = segments.map((_, i) =>
  `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
  `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0d1117,` +
  `fps=${FPS},format=yuv420p,setsar=1[v${i}]`).join(';')
const concat = segments.map((_, i) => `[v${i}]`).join('') +
  `concat=n=${segments.length}:v=1:a=0[out]`

args.push(
  '-filter_complex', `${filters};${concat}`,
  '-map', '[out]',
  '-map_metadata', String(segments.length),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-y', OUT,
)

rmSync(OUT, { force: true })
console.log(`Stitching ${segments.length} segments — ${total.toFixed(1)}s`)
execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' })

console.log(`\n  ${OUT}`)
console.log(`  ${Math.floor(total / 60)}m ${Math.round(total % 60)}s, ${marks.length} chapters`)
marks.forEach((m, i) => {
  const mm = String(Math.floor(m.start / 60)).padStart(2, '0')
  const ss = String(Math.floor(m.start % 60)).padStart(2, '0')
  console.log(`    ${mm}:${ss}  ${i + 1}. ${m.title}`)
})
