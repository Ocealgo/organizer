#!/usr/bin/env node
/**
 * Speak the narration script into one wav per chapter.
 *
 *   npm run walkthroughs:narrate   # this, writes tests/walkthroughs/narration/
 *   npm run walkthroughs:film      # mixes them in automatically
 *
 * NARRATION.md is the source. Edit the words there, re-run this, re-stitch —
 * the same loop as every other part of the film. Nothing is authored twice.
 *
 * The voice is Windows' built-in SAPI synthesiser, which costs nothing and
 * works offline but sounds like 2013 and speaks American. It is a scratch
 * track: good enough to check pacing against the footage, not good enough to
 * put in front of a sales team.
 *
 * To replace it, put your own 01.wav … 06.wav in the narration directory and
 * skip this script entirely. The stitcher only cares that the files exist, so
 * a trainer reading the script into a phone drops in with no code change.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FFPROBE } from './ffmpeg-path.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SCRIPT = join(ROOT, 'tests/walkthroughs/NARRATION.md')
const OUT_DIR = join(ROOT, 'tests/walkthroughs/narration')

/** `Get-InstalledVoice` names, if you want the other one: David, Zira, Mark. */
const VOICE = 'Microsoft Zira Desktop'
/** SAPI's -10..10. Negative is slower, and slower narration overruns its clip. */
const RATE = 0

// ── reading the script ───────────────────────────────────────────────────────
// Only the blockquoted lines are narration. The unquoted paragraphs under each
// chapter — "If a rep gets stuck", "The point to land" — are notes to whoever
// is running the session, and must not be read aloud.
function chapters() {
  const lines = readFileSync(SCRIPT, 'utf8').split(/\r?\n/)
  const found = []
  let current = null
  for (const line of lines) {
    const heading = line.match(/^## (\d\d) [—-] (.+?)(?: _\(.*\)_)?\s*$/)
    if (heading) {
      current = { n: heading[1], title: heading[2], said: [] }
      found.push(current)
      continue
    }
    if (line.startsWith('## ')) current = null // e.g. the running-order section
    if (!current) continue
    if (line.startsWith('>')) current.said.push(line.replace(/^>\s?/, ''))
  }
  return found.map(c => ({ ...c, text: speakable(c.said.join('\n')) }))
}

/**
 * Markdown that means something to a reader means nothing to a synthesiser.
 * Bold is emphasis it cannot voice, and an em dash it reads as a word.
 */
const speakable = (s) => s
  .replace(/\*\*(.+?)\*\*/gs, '$1')
  .replace(/\s*—\s*/g, ', ')
  .replace(/[ \t]+/g, ' ')
  .split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).join('\n\n')

// ── speaking it ──────────────────────────────────────────────────────────────
// The text goes via a file rather than the command line: it is several hundred
// words of quotes, apostrophes and non-ascii punctuation, and every one of
// those is a way for shell quoting to mangle a sentence silently.
function speak(text, wav) {
  const tmp = `${wav}.txt`
  writeFileSync(tmp, text, 'utf8')
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$s.SelectVoice('${VOICE}')`,
      `$s.Rate = ${RATE}`,
      `$s.SetOutputToWaveFile('${wav}')`,
      `$s.Speak([IO.File]::ReadAllText('${tmp}', [Text.Encoding]::UTF8))`,
      '$s.Dispose()',
    ].join('; ')], { stdio: 'pipe' })
  } finally {
    rmSync(tmp, { force: true })
  }
}

const seconds = (file) => parseFloat(execFileSync(FFPROBE, [
  '-v', 'error', '-show_entries', 'format=duration', '-of',
  'default=nw=1:nk=1', file,
], { encoding: 'utf8' }).trim())

// ── go ───────────────────────────────────────────────────────────────────────
const found = chapters()
if (!found.length) throw new Error(`No numbered chapters found in ${SCRIPT}`)

mkdirSync(OUT_DIR, { recursive: true })
console.log(`Speaking ${found.length} chapters as ${VOICE}…\n`)

for (const c of found) {
  const wav = join(OUT_DIR, `${c.n}.wav`)
  speak(c.text, wav)
  const words = c.text.split(/\s+/).length
  console.log(`  ${c.n}  ${seconds(wav).toFixed(1).padStart(5)}s  ${String(words).padStart(3)} words  ${c.title}`)
}

console.log('\n  Now run: npm run walkthroughs:film')
