#!/usr/bin/env node
/**
 * Render the brand sting the training film opens on.
 *
 *   npm run walkthroughs:sting   # this, writes tests/walkthroughs/sting.mp4
 *   npm run walkthroughs:film    # picks it up automatically
 *
 * Four seconds of near-black with a soft teal light sweeping across, revealing
 * faint ripple rings on what reads as calm water, then settling back to dark.
 * No text and no logo, so the sting makes no claim the app has to live up to.
 *
 * It is drawn procedurally by ffmpeg rather than fetched from anywhere, for the
 * same reason the clips and the cards are: everything in this film regenerates
 * from source. Tune the constants below and re-run — there is no project file
 * and no asset to lose.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { FFMPEG } from './ffmpeg-path.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'tests/walkthroughs/sting.mp4')

/** Matches the film exactly, so the stitcher has nothing to letterbox. */
const W = 412
const H = 916
const FPS = 30
const DUR = 4

/** The deck background. Everything else is lit on top of it. */
const BG = { r: 13, g: 17, b: 23 }
/** Peak of the sweep, before the white-hot core is added on top. */
const TEAL = { r: 45, g: 212, b: 191 }

// ── the picture, as one expression per channel ───────────────────────────────
// geq runs this for every pixel of every frame, with X/Y in pixels and T in
// seconds. Built up in named pieces here because as a single string it is
// unreadable and, worse, uneditable six months from now.

const CX = Math.round(W / 2)
const CY = Math.round(H * 0.54) // optical centre for the vignette, a little low

/**
 * The ripples radiate from a point well below the bottom edge. Keeping the
 * origin out of frame is the whole trick: rings centred on any visible point
 * read as a target or an eye no matter how faint they are, whereas the far
 * outer arcs of the same wave read as a surface.
 */
const RIPPLE_Y = H + 380
const NEAR = 380 // distance from the origin to the nearest visible pixel

/** Sweep centre, travelling left to right and fully off-frame at both ends. */
const SX = `(-120+${W + 240}*T/${DUR})`
/** Wide soft band of light, and the narrow white core inside it. */
const SWEEP = `exp(-pow(X-${SX},2)/24200)`
const CORE = `exp(-pow(X-${SX},2)/2450)`

/**
 * How far into the visible frame a pixel is, measured out from that origin.
 * Zero along the bottom edge and roughly 900 at the top, so everything below
 * fades with height and the arcs bow gently upward at the corners.
 */
const RAD = `(hypot(X-${CX},Y-${RIPPLE_Y})-${NEAR})`
const RINGS = `sin(${RAD}*0.032-T*4)*exp(-${RAD}*0.0022)*0.11`

/** A trace of ambient glow so the frame is never flatly black. */
const AMBIENT = `0.03*exp(-${RAD}*0.0018)`
/** Corners fall off, which keeps the eye where the light is. */
const VIGNETTE = `clip(1-0.55*pow(hypot((X-${CX})/${CX},(Y-${CY})/${CY}),2),0,1)`

/**
 * The rings are multiplied by the sweep rather than added to it: they exist all
 * along, and the light travelling past is what reveals them.
 */
const LIT = `clip((${AMBIENT}+${SWEEP}*(0.16+${RINGS}))*${VIGNETTE},0,1)`
const WHITE = `${CORE}*0.10`

const channel = (c) =>
  `clip(${BG[c]}+${LIT}*${TEAL[c] - BG[c]}+${WHITE}*170,0,255)`

const filters = [
  `color=c=black:s=${W}x${H}:d=${DUR}:r=${FPS}`,
  'format=gbrp',
  `geq=r='${channel('r')}':g='${channel('g')}':b='${channel('b')}'`,
  'gblur=sigma=1.2',       // takes the aliased edge off the rings
  'format=yuv420p',
  'noise=alls=7:allf=t',   // grain, so the gradients do not band on a phone
  'fade=t=in:st=0:d=0.6',
  `fade=t=out:st=${DUR - 0.8}:d=0.8`,
]

mkdirSync(dirname(OUT), { recursive: true })
console.log(`Rendering ${DUR}s at ${W}x${H}…`)
execFileSync(FFMPEG, [
  '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', filters.join(','),
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18',
  '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
  '-y', OUT,
], { stdio: 'inherit' })

console.log(`\n  ${OUT}`)
console.log('  Now run: npm run walkthroughs:film')
