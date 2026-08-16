/**
 * Where ffmpeg actually lives on a machine that installed it with winget.
 *
 * winget drops binaries under LOCALAPPDATA rather than on PATH for the shell
 * you are currently in, so a plain `ffmpeg` fails on a box where ffmpeg is
 * demonstrably installed. Look there first, fall back to PATH for everyone who
 * installed it some other way.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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

export const FFMPEG = findBinary('ffmpeg')
export const FFPROBE = findBinary('ffprobe')
