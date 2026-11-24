export const BIN_DEG = 10
export const BIN_COUNT = 360 / BIN_DEG

export interface AlertSettings {
  enabled: boolean
  thresholdMm: number
  /** Watched sector, clockwise from sectorStart to sectorEnd (degrees). 0..360 = all around. */
  sectorStart: number
  sectorEnd: number
  sound: boolean
}

export interface AlertResult {
  active: boolean
  bins: Uint8Array
  nearest: { angle: number; distance: number } | null
  /** Closest valid point overall, regardless of threshold. */
  closest: { angle: number; distance: number } | null
}

export function inSector(a: number, start: number, end: number): boolean {
  if (end - start >= 360 || (start === 0 && end === 360)) return true
  const s = ((start % 360) + 360) % 360
  const e = ((end % 360) + 360) % 360
  return s <= e ? a >= s && a <= e : a >= s || a <= e
}

export function evaluateAlerts(points: Float32Array | null, cfg: AlertSettings): AlertResult {
  const bins = new Uint8Array(BIN_COUNT)
  let nearest: AlertResult['nearest'] = null
  let closest: AlertResult['closest'] = null
  if (!points) return { active: false, bins, nearest, closest }

  for (let i = 0; i < points.length; i += 3) {
    const a = points[i]
    const d = points[i + 1]
    if (d <= 0) continue
    if (!closest || d < closest.distance) closest = { angle: a, distance: d }
    if (!cfg.enabled || d >= cfg.thresholdMm) continue
    if (!inSector(a, cfg.sectorStart, cfg.sectorEnd)) continue
    bins[Math.floor(a / BIN_DEG) % BIN_COUNT] = 1
    if (!nearest || d < nearest.distance) nearest = { angle: a, distance: d }
  }
  return { active: nearest !== null, bins, nearest, closest }
}

let ctx: AudioContext | null = null
export function beep(): void {
  try {
    ctx ??= new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'square'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.16)
  } catch {
    /* audio unavailable */
  }
}
