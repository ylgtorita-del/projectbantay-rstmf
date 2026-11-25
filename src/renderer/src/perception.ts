/**
 * Scene understanding for a single 2D lidar revolution:
 *   1. Range filter + sort by angle
 *   2. Segmentation with an adaptive breakpoint detector (gap grows with range,
 *      because neighbouring beams spread apart the farther they travel)
 *   3. Wall extraction: split-and-merge into straight pieces, least-squares fit,
 *      keep long, dense, straight pieces as walls
 *   4. Everything else becomes an object candidate with a minimum-area
 *      oriented bounding box (rotating calipers on the convex hull)
 *   5. A tracker keeps object IDs stable across revolutions and smooths the
 *      boxes, which removes most of the frame-to-frame jitter and noise blips.
 *
 * World frame: +y = lidar front (0°), +x = right (90°), millimetres.
 */

/** YDLIDAR T-mini Plus datasheet range: 0.05–12 m (white, ~80% reflectivity target). */
export const SENSOR_MIN_RANGE_MM = 50
export const SENSOR_MAX_RANGE_MM = 12000

export interface DetectSettings {
  walls: boolean
  objects: boolean
  showPoints: boolean
  /** Ignore returns farther than this. */
  maxRangeMm: number
  /** Minimum gap between points that splits two clusters (grows with range automatically). */
  gapMm: number
  /** Clusters with fewer points are treated as noise. */
  minPoints: number
  /** A straight piece at least this long is a wall. */
  wallMinLengthMm: number
  /** How far points may deviate from a straight line and still count as one line. */
  lineTolMm: number
}

export const DEFAULT_DETECT: DetectSettings = {
  walls: true,
  objects: true,
  showPoints: true,
  maxRangeMm: SENSOR_MAX_RANGE_MM,
  gapMm: 120,
  minPoints: 8,
  wallMinLengthMm: 800,
  lineTolMm: 35
}

interface P {
  x: number
  y: number
  a: number // degrees
  d: number // mm
}

export interface Wall {
  x1: number
  y1: number
  x2: number
  y2: number
  length: number
  /** Shortest distance from the sensor to the wall segment. */
  distance: number
  /** Bearing (deg) of that closest point. */
  bearing: number
  points: number
}

export interface Box {
  cx: number
  cy: number
  w: number
  h: number
  /** Rotation of the w axis, radians, normalised to [0, π/2). */
  rot: number
}

export interface Cluster extends Box {
  /** Closest point of the object to the sensor. */
  distance: number
  bearing: number
  points: number
}

export interface TrackedObject extends Cluster {
  id: number
  vx: number
  vy: number
  speed: number
  moving: boolean
  hits: number
  missed: number
}

export interface Scene {
  walls: Wall[]
  objects: TrackedObject[]
  validPoints: number
}

const DEG = Math.PI / 180
const HALF_PI = Math.PI / 2
// Adaptive breakpoint detector (Borges & Aldon): λ = worst incidence angle, σ = range noise.
const ABD_LAMBDA = 10 * DEG
const ABD_SIGMA = 15
const MAX_ANGLE_GAP_DEG = 4
const OBJECT_MAX_SIZE_MM = 3000

export function detect(points: Float32Array, cfg: DetectSettings): { walls: Wall[]; clusters: Cluster[]; valid: number } {
  const ps: P[] = []
  for (let i = 0; i < points.length; i += 3) {
    const a = points[i]
    const d = points[i + 1]
    if (d < SENSOR_MIN_RANGE_MM || d > cfg.maxRangeMm) continue
    const r = a * DEG
    ps.push({ x: Math.sin(r) * d, y: Math.cos(r) * d, a, d })
  }
  ps.sort((p, q) => p.a - q.a)
  if (ps.length < cfg.minPoints) return { walls: [], clusters: [], valid: ps.length }

  const segments = segment(ps, cfg.gapMm)
  const walls: Wall[] = []
  const clusters: Cluster[] = []

  for (const seg of segments) {
    if (seg.length < cfg.minPoints) continue // isolated noise / dust / edge mixed pixels

    const used = new Uint8Array(seg.length)
    if (cfg.walls && seg.length >= cfg.minPoints * 2) {
      const pieces: [number, number][] = []
      splitLines(seg, 0, seg.length - 1, cfg.lineTolMm, pieces)
      for (const [i0, i1] of pieces) {
        const n = i1 - i0 + 1
        if (n < Math.max(6, cfg.minPoints * 2)) continue
        const wall = fitWall(seg, i0, i1, cfg.lineTolMm)
        if (!wall || wall.length < cfg.wallMinLengthMm) continue
        walls.push(wall)
        used.fill(1, i0, i1 + 1)
      }
    }

    if (!cfg.objects) continue
    // Runs of non-wall points become objects.
    let run: P[] = []
    const flushRun = () => {
      if (run.length >= cfg.minPoints) {
        const c = makeCluster(run)
        if (Math.max(c.w, c.h) <= OBJECT_MAX_SIZE_MM) clusters.push(c)
      }
      run = []
    }
    for (let i = 0; i < seg.length; i++) {
      if (used[i]) flushRun()
      else run.push(seg[i])
    }
    flushRun()
  }

  return { walls, clusters, valid: ps.length }
}

function segment(ps: P[], gapMm: number): P[][] {
  const segs: P[][] = []
  let cur: P[] = [ps[0]]
  for (let i = 1; i < ps.length; i++) {
    const p = ps[i - 1]
    const q = ps[i]
    if (breaks(p, q, q.a - p.a, gapMm)) {
      segs.push(cur)
      cur = []
    }
    cur.push(q)
  }
  segs.push(cur)

  // Join the segment that crosses 360° → 0°.
  if (segs.length > 1) {
    const first = segs[0][0]
    const last = segs[segs.length - 1][segs[segs.length - 1].length - 1]
    if (!breaks(last, first, first.a + 360 - last.a, gapMm)) {
      const tail = segs.pop()!
      segs[0] = tail.concat(segs[0])
    }
  }
  return segs
}

function breaks(p: P, q: P, dAngDeg: number, gapMm: number): boolean {
  if (dAngDeg > MAX_ANGLE_GAP_DEG) return true
  const dphi = Math.max(dAngDeg, 0.05) * DEG
  const r = Math.min(p.d, q.d)
  const dmax = (r * Math.sin(dphi)) / Math.sin(ABD_LAMBDA - dphi) + 3 * ABD_SIGMA
  return Math.hypot(q.x - p.x, q.y - p.y) > Math.max(gapMm, dmax)
}

/** Iterative end-point fit: split until every piece is straight within tol. */
function splitLines(ps: P[], i0: number, i1: number, tol: number, out: [number, number][]): void {
  if (i1 - i0 < 2) {
    out.push([i0, i1])
    return
  }
  const a = ps[i0]
  const b = ps[i1]
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  let maxD = 0
  let idx = -1
  for (let k = i0 + 1; k < i1; k++) {
    const dist = Math.abs((ps[k].x - a.x) * dy - (ps[k].y - a.y) * dx) / len
    if (dist > maxD) {
      maxD = dist
      idx = k
    }
  }
  if (maxD > tol && idx > 0) {
    splitLines(ps, i0, idx, tol, out)
    splitLines(ps, idx, i1, tol, out)
  } else {
    out.push([i0, i1])
  }
}

/** Total-least-squares line fit through ps[i0..i1], clipped to the point extent. */
function fitWall(ps: P[], i0: number, i1: number, tol: number): Wall | null {
  const n = i1 - i0 + 1
  let mx = 0
  let my = 0
  for (let k = i0; k <= i1; k++) {
    mx += ps[k].x
    my += ps[k].y
  }
  mx /= n
  my /= n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let k = i0; k <= i1; k++) {
    const dx = ps[k].x - mx
    const dy = ps[k].y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const c = Math.cos(th)
  const s = Math.sin(th)
  let tmin = Infinity
  let tmax = -Infinity
  let rss = 0
  for (let k = i0; k <= i1; k++) {
    const dx = ps[k].x - mx
    const dy = ps[k].y - my
    const t = dx * c + dy * s
    const e = -dx * s + dy * c
    rss += e * e
    if (t < tmin) tmin = t
    if (t > tmax) tmax = t
  }
  if (Math.sqrt(rss / n) > tol * 0.6) return null // too rough to be a flat surface

  const length = tmax - tmin
  // Real walls are dense: reject sparse "lines" formed by scattered far-away points.
  // (~4° of beam spread per point at the far end is the loosest we accept.)
  const spacing = length / (n - 1)
  const far = Math.max(ps[i0].d, ps[i1].d)
  if (spacing > Math.max(150, far * 0.07)) return null

  const x1 = mx + c * tmin
  const y1 = my + s * tmin
  const x2 = mx + c * tmax
  const y2 = my + s * tmax
  const closest = closestOnSegment(x1, y1, x2, y2)
  return {
    x1,
    y1,
    x2,
    y2,
    length,
    distance: Math.hypot(closest.x, closest.y),
    bearing: bearingDeg(closest.x, closest.y),
    points: n
  }
}

function closestOnSegment(x1: number, y1: number, x2: number, y2: number): { x: number; y: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  const l2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, -(x1 * dx + y1 * dy) / l2))
  return { x: x1 + t * dx, y: y1 + t * dy }
}

export function bearingDeg(x: number, y: number): number {
  const b = Math.atan2(x, y) / DEG
  return b < 0 ? b + 360 : b
}

function makeCluster(ps: P[]): Cluster {
  let nearest = ps[0]
  for (const p of ps) if (p.d < nearest.d) nearest = p
  return { ...minAreaRect(ps), distance: nearest.d, bearing: nearest.a, points: ps.length }
}

function convexHull(ps: P[]): { x: number; y: number }[] {
  const pts = ps.map((p) => ({ x: p.x, y: p.y })).sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: { x: number; y: number }[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: { x: number; y: number }[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

/** Minimum-area oriented bounding box (rotating calipers over the hull edges). */
function minAreaRect(ps: P[]): Box {
  const hull = convexHull(ps)
  if (hull.length < 3) {
    const a = hull[0]
    const b = hull[hull.length - 1]
    return normalizeBox({
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      w: Math.hypot(b.x - a.x, b.y - a.y),
      h: 0,
      rot: Math.atan2(b.y - a.y, b.x - a.x)
    })
  }
  let best: Box | null = null
  let bestArea = Infinity
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i]
    const q = hull[(i + 1) % hull.length]
    const th = Math.atan2(q.y - p.y, q.x - p.x)
    const c = Math.cos(th)
    const s = Math.sin(th)
    let u0 = Infinity
    let u1 = -Infinity
    let v0 = Infinity
    let v1 = -Infinity
    for (const h of hull) {
      const u = h.x * c + h.y * s
      const v = -h.x * s + h.y * c
      if (u < u0) u0 = u
      if (u > u1) u1 = u
      if (v < v0) v0 = v
      if (v > v1) v1 = v
    }
    const area = (u1 - u0) * (v1 - v0)
    if (area < bestArea) {
      bestArea = area
      const uc = (u0 + u1) / 2
      const vc = (v0 + v1) / 2
      best = { cx: uc * c - vc * s, cy: uc * s + vc * c, w: u1 - u0, h: v1 - v0, rot: th }
    }
  }
  return normalizeBox(best!)
}

/** Rotating a box by 90° swaps w and h; bring rot into [0, π/2). */
function normalizeBox<T extends Box>(b: T): T {
  const k = Math.floor(b.rot / HALF_PI)
  b.rot -= k * HALF_PI
  if (Math.abs(k) % 2 === 1) [b.w, b.h] = [b.h, b.w]
  return b
}

export function boxCorners(b: Box, minThickness = 0): [number, number][] {
  const w = Math.max(b.w, minThickness) / 2
  const h = Math.max(b.h, minThickness) / 2
  const c = Math.cos(b.rot)
  const s = Math.sin(b.rot)
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h]
  ].map(([u, v]) => [b.cx + u * c - v * s, b.cy + u * s + v * c] as [number, number])
}

/**
 * Nearest-neighbour multi-object tracker. Objects must be seen in 2 revolutions
 * before they are shown (filters one-off noise) and survive short dropouts.
 */
export class Tracker {
  private tracks: TrackedObject[] = []
  private nextId = 1
  private lastT = -1
  private cache: TrackedObject[] = []

  reset(): void {
    this.tracks = []
    this.lastT = -1
    this.cache = []
  }

  update(dets: Cluster[], t: number): TrackedObject[] {
    if (t === this.lastT) return this.cache
    if (this.lastT < 0 || t < this.lastT || t - this.lastT > 2000) {
      this.tracks = []
      this.nextId = 1
    }
    const dt = this.lastT > 0 && t > this.lastT ? (t - this.lastT) / 1000 : 0.1
    this.lastT = t

    // Greedy matching on predicted centre distance.
    const pairs: { ti: number; di: number; dist: number }[] = []
    this.tracks.forEach((tr, ti) => {
      const px = tr.cx + tr.vx * dt
      const py = tr.cy + tr.vy * dt
      dets.forEach((d, di) => {
        const dist = Math.hypot(d.cx - px, d.cy - py)
        const gate = 250 + 0.5 * Math.max(tr.w, tr.h, d.w, d.h)
        if (dist < gate) pairs.push({ ti, di, dist })
      })
    })
    pairs.sort((a, b) => a.dist - b.dist)
    const tUsed = new Set<number>()
    const dUsed = new Set<number>()
    for (const { ti, di } of pairs) {
      if (tUsed.has(ti) || dUsed.has(di)) continue
      tUsed.add(ti)
      dUsed.add(di)
      this.correct(this.tracks[ti], dets[di], dt)
    }

    this.tracks.forEach((tr, ti) => {
      if (tUsed.has(ti)) return
      tr.missed++
      tr.cx += tr.vx * dt
      tr.cy += tr.vy * dt
    })
    this.tracks = this.tracks.filter((tr) => tr.missed <= 3)

    dets.forEach((d, di) => {
      if (dUsed.has(di)) return
      this.tracks.push({ ...d, id: this.nextId++, vx: 0, vy: 0, speed: 0, moving: false, hits: 1, missed: 0 })
    })

    this.cache = this.tracks
      .filter((tr) => tr.hits >= 2 && tr.missed <= 1)
      .map((tr) => ({ ...tr }))
      .sort((a, b) => a.distance - b.distance)
    return this.cache
  }

  private correct(tr: TrackedObject, d: Cluster, dt: number): void {
    const a = 0.55 // position smoothing
    const as = 0.3 // size / angle smoothing

    // Velocity from centre motion (smoothed).
    const vx = (d.cx - tr.cx) / dt
    const vy = (d.cy - tr.cy) / dt
    tr.vx = tr.vx * 0.7 + vx * 0.3
    tr.vy = tr.vy * 0.7 + vy * 0.3
    tr.speed = Math.hypot(tr.vx, tr.vy)

    tr.cx += (d.cx - tr.cx) * a
    tr.cy += (d.cy - tr.cy) * a

    // Angle is periodic in π/2; an odd number of quarter turns swaps w/h.
    let dw = d.w
    let dh = d.h
    const raw = d.rot - tr.rot
    const k = Math.round(raw / HALF_PI)
    if (Math.abs(k) % 2 === 1) [dw, dh] = [dh, dw]
    tr.rot += (raw - k * HALF_PI) * as
    tr.w += (dw - tr.w) * as
    tr.h += (dh - tr.h) * as
    normalizeBox(tr)

    tr.distance += (d.distance - tr.distance) * 0.6
    tr.bearing = d.bearing
    tr.points = d.points
    tr.hits++
    tr.missed = 0
    tr.moving = tr.hits >= 4 && tr.speed > 200
  }
}
