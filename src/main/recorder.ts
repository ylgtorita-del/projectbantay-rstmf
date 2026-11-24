import { createReadStream, createWriteStream, promises as fs, WriteStream } from 'fs'
import { createInterface } from 'readline'
import type { Revolution } from '../shared/types'

/**
 * Recording format: JSON Lines, one revolution per line:
 *   {"t":1732400000000,"hz":10,"p":[angle,dist,intensity, ...]}
 */
export class Recorder {
  private stream: WriteStream | null = null
  path: string | null = null
  lastPath: string | null = null
  frames = 0

  get active(): boolean {
    return this.stream !== null
  }

  start(path: string): void {
    this.stop()
    this.stream = createWriteStream(path, { encoding: 'utf8' })
    this.path = path
    this.frames = 0
  }

  write(rev: Revolution): void {
    if (!this.stream) return
    const p = rev.points
    const parts: string[] = new Array(p.length)
    for (let i = 0; i < p.length; i += 3) {
      parts[i] = p[i].toFixed(2)
      parts[i + 1] = String(Math.round(p[i + 1]))
      parts[i + 2] = String(Math.round(p[i + 2]))
    }
    this.stream.write(`{"t":${rev.t},"hz":${rev.hz},"p":[${parts.join(',')}]}\n`)
    this.frames++
  }

  stop(): { path: string; frames: number } | null {
    if (!this.stream || !this.path) return null
    this.stream.end()
    const result = { path: this.path, frames: this.frames }
    this.lastPath = this.path
    this.stream = null
    this.path = null
    return result
  }
}

export async function readRecording(path: string): Promise<Revolution[]> {
  const text = await fs.readFile(path, 'utf8')
  const frames: Revolution[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const o = JSON.parse(line) as { t: number; hz?: number; p: number[] }
      frames.push({ t: o.t, hz: o.hz ?? 0, points: Float32Array.from(o.p) })
    } catch {
      /* skip a truncated line */
    }
  }
  return frames
}

/** Converts a .jsonl recording to CSV: timestamp_ms,angle_deg,distance_mm,intensity */
export async function exportCsv(src: string, dest: string): Promise<number> {
  const out = createWriteStream(dest, { encoding: 'utf8' })
  out.write('timestamp_ms,revolution,angle_deg,distance_mm,intensity\n')
  const rl = createInterface({ input: createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity })
  let rows = 0
  let rev = 0
  for await (const line of rl) {
    if (!line.trim()) continue
    let o: { t: number; p: number[] }
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    let chunk = ''
    for (let i = 0; i < o.p.length; i += 3) {
      chunk += `${o.t},${rev},${o.p[i]},${o.p[i + 1]},${o.p[i + 2]}\n`
      rows++
    }
    rev++
    if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()))
  }
  await new Promise<void>((resolve) => out.end(() => resolve()))
  return rows
}
