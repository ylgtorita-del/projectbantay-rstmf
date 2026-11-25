import { useEffect, useRef, useState } from 'react'
import { BIN_COUNT, BIN_DEG } from '../alerts'
import { boxCorners, Scene, SENSOR_MAX_RANGE_MM } from '../perception'

export type ColorMode = 'distance' | 'intensity'

export interface ViewFilters {
  front: boolean
  right: boolean
  rear: boolean
  left: boolean
  movingOnly: boolean
}

interface Props {
  points: Float32Array | null
  scene: Scene | null
  showPoints: boolean
  maxRangeMm: number
  selectedId: number | null
  thresholdMm: number
  alertEnabled: boolean
  alertBins: Uint8Array | null
  sectorStart: number
  sectorEnd: number
  colorMode: ColorMode
  pointSize: number
  showRoad: boolean
  viewFilters: ViewFilters
}

const RING_STEPS = [100, 250, 500, 1000, 2000, 5000, 10000]
const DEFAULT_SCALE = 0.08 // pixels per mm
const COLOR_RANGE_MM = 8000
const PALETTE = Array.from({ length: 64 }, (_, i) => {
  // near = warm, far = cool
  const t = i / 63
  return `hsl(${Math.round(10 + t * 190)}, 95%, ${Math.round(60 - t * 8)}%)`
})
const IPALETTE = Array.from({ length: 64 }, (_, i) => {
  const t = i / 63
  return `hsl(${Math.round(150 - t * 100)}, 90%, ${Math.round(30 + t * 45)}%)`
})

const LANE_WIDTH_MM = 3000
const ROAD_CENTER_X_MM = -LANE_WIDTH_MM / 2 // center dividing line offset from LiDAR
const ROAD_LEFT_EDGE_MM = ROAD_CENTER_X_MM - LANE_WIDTH_MM
const ROAD_RIGHT_EDGE_MM = ROAD_CENTER_X_MM + LANE_WIDTH_MM

const rad = (deg: number) => (deg * Math.PI) / 180

function inVisibleSector(angleDeg: number, f: ViewFilters): boolean {
  if (f.front && f.right && f.rear && f.left) return true
  const a = ((angleDeg % 360) + 360) % 360
  if (f.front && (a >= 315 || a < 45)) return true
  if (f.right && a >= 45 && a < 135) return true
  if (f.rear && a >= 135 && a < 225) return true
  if (f.left && a >= 225 && a < 315) return true
  return false
}

export default function RadarCanvas(props: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const view = useRef({ scale: DEFAULT_SCALE, ox: 0, oy: 0 })
  const dirty = useRef(true)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const [hover, setHover] = useState<{ angle: number; dist: number } | null>(null)
  const [zoomLabel, setZoomLabel] = useState('')

  useEffect(() => {
    dirty.current = true
  }, [props])

  useEffect(() => {
    const canvas = canvasRef.current!
    const wrap = wrapRef.current!
    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(wrap.clientWidth * dpr)
      canvas.height = Math.round(wrap.clientHeight * dpr)
      dirty.current = true
    })
    ro.observe(wrap)

    let raf = 0
    const loop = () => {
      const p = propsRef.current
      const flashing = p.alertBins?.some((b) => b) ?? false
      if (dirty.current || flashing) {
        draw(canvas, p, view.current)
        dirty.current = false
      }
      raf = requestAnimationFrame(loop)
    }
    loop()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const toWorld = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect()
    const v = view.current
    const x = (clientX - r.left - r.width / 2 - v.ox) / v.scale
    const y = (clientY - r.top - r.height / 2 - v.oy) / v.scale
    return { x, y }
  }

  const onWheel = (e: React.WheelEvent) => {
    const v = view.current
    const r = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left - r.width / 2
    const my = e.clientY - r.top - r.height / 2
    const wx = (mx - v.ox) / v.scale
    const wy = (my - v.oy) / v.scale
    const next = Math.min(2, Math.max(0.005, v.scale * Math.exp(-e.deltaY * 0.0015)))
    v.scale = next
    v.ox = mx - wx * next
    v.oy = my - wy * next
    dirty.current = true
    setZoomLabel(`${((r.height / 2) / next / 1000).toFixed(1)} m radius`)
  }

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: view.current.ox, oy: view.current.oy }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (drag.current) {
      view.current.ox = drag.current.ox + e.clientX - drag.current.x
      view.current.oy = drag.current.oy + e.clientY - drag.current.y
      dirty.current = true
    }
    const w = toWorld(e.clientX, e.clientY)
    let angle = (Math.atan2(w.x, -w.y) * 180) / Math.PI
    if (angle < 0) angle += 360
    setHover({ angle, dist: Math.hypot(w.x, w.y) })
  }
  const onPointerUp = () => {
    drag.current = null
  }
  const reset = () => {
    view.current = { scale: DEFAULT_SCALE, ox: 0, oy: 0 }
    dirty.current = true
    setZoomLabel('')
  }

  return (
    <div className="radar" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={reset}
      />
      <div className="radar-hud">
        {hover ? (
          <span>
            Cursor {hover.angle.toFixed(1)}° · {(hover.dist / 1000).toFixed(2)} m
          </span>
        ) : (
          <span>Scroll to zoom · drag to pan · double-click to reset</span>
        )}
        {zoomLabel && <span>{zoomLabel}</span>}
      </div>
      {!props.points && (
        <div className="radar-empty">Connect the LiDAR or open a recording to see the surroundings.</div>
      )}
    </div>
  )
}

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function draw(
  canvas: HTMLCanvasElement,
  p: Props,
  v: { scale: number; ox: number; oy: number }
): void {
  const c = canvas.getContext('2d')
  if (!c) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.width / dpr
  const h = canvas.height / dpr
  c.setTransform(dpr, 0, 0, dpr, 0, 0)

  c.fillStyle = css('--radar-bg') || '#070b10'
  c.fillRect(0, 0, w, h)

  const cx = w / 2 + v.ox
  const cy = h / 2 + v.oy
  const s = v.scale
  const maxR = (Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 10) / s

  if (p.showRoad) drawRoad(c, cx, cy, s, w, h)

  // Range rings
  const step = RING_STEPS.find((st) => st * s >= 70) ?? RING_STEPS[RING_STEPS.length - 1]
  c.lineWidth = 1
  c.font = '11px "Segoe UI", system-ui, sans-serif'
  c.textBaseline = 'bottom'
  for (let r = step; r <= maxR; r += step) {
    const major = r % (step * 2) === 0
    c.strokeStyle = major ? 'rgba(120,170,200,0.22)' : 'rgba(120,170,200,0.11)'
    c.beginPath()
    c.arc(cx, cy, r * s, 0, Math.PI * 2)
    c.stroke()
    c.fillStyle = 'rgba(150,190,215,0.55)'
    c.fillText(r >= 1000 ? `${r / 1000} m` : `${r} mm`, cx + 4, cy - r * s - 2)
  }

  // Spokes every 30°
  c.textBaseline = 'middle'
  c.textAlign = 'center'
  const labelR = Math.min(w, h) * 0.46
  for (let a = 0; a < 360; a += 30) {
    const dx = Math.sin(rad(a))
    const dy = -Math.cos(rad(a))
    c.strokeStyle = a % 90 === 0 ? 'rgba(120,170,200,0.2)' : 'rgba(120,170,200,0.09)'
    c.beginPath()
    c.moveTo(cx, cy)
    c.lineTo(cx + dx * maxR * s, cy + dy * maxR * s)
    c.stroke()
    c.fillStyle = 'rgba(150,190,215,0.6)'
    c.fillText(`${a}°`, cx + dx * labelR, cy + dy * labelR)
  }
  c.textAlign = 'start'

  // Alert zone
  if (p.alertEnabled) {
    const full = p.sectorEnd - p.sectorStart >= 360
    c.fillStyle = 'rgba(255,90,70,0.06)'
    c.beginPath()
    if (full) {
      c.arc(cx, cy, p.thresholdMm * s, 0, Math.PI * 2)
    } else {
      c.moveTo(cx, cy)
      c.arc(cx, cy, p.thresholdMm * s, rad(p.sectorStart - 90), rad(p.sectorEnd - 90))
      c.closePath()
    }
    c.fill()
    c.setLineDash([6, 5])
    c.strokeStyle = 'rgba(255,110,90,0.7)'
    c.beginPath()
    if (full) c.arc(cx, cy, p.thresholdMm * s, 0, Math.PI * 2)
    else c.arc(cx, cy, p.thresholdMm * s, rad(p.sectorStart - 90), rad(p.sectorEnd - 90))
    c.stroke()
    c.setLineDash([])

    if (p.alertBins) {
      const pulse = 0.25 + 0.2 * Math.sin(performance.now() / 120)
      c.fillStyle = `rgba(255,60,50,${pulse})`
      for (let i = 0; i < BIN_COUNT; i++) {
        if (!p.alertBins[i]) continue
        c.beginPath()
        c.moveTo(cx, cy)
        c.arc(cx, cy, p.thresholdMm * s, rad(i * BIN_DEG - 90), rad((i + 1) * BIN_DEG - 90))
        c.closePath()
        c.fill()
      }
    }
  }

  // Sensor range limits
  c.setLineDash([2, 6])
  c.strokeStyle = 'rgba(255,181,71,0.45)'
  c.beginPath()
  c.arc(cx, cy, SENSOR_MAX_RANGE_MM * s, 0, Math.PI * 2)
  c.stroke()
  c.fillStyle = 'rgba(255,181,71,0.7)'
  c.fillText('sensor max 12 m', cx + 4, cy - SENSOR_MAX_RANGE_MM * s - 8)
  if (p.maxRangeMm < SENSOR_MAX_RANGE_MM) {
    c.strokeStyle = 'rgba(160,190,215,0.45)'
    c.beginPath()
    c.arc(cx, cy, p.maxRangeMm * s, 0, Math.PI * 2)
    c.stroke()
    c.fillStyle = 'rgba(160,190,215,0.7)'
    c.fillText(`range limit ${(p.maxRangeMm / 1000).toFixed(1)} m`, cx + 4, cy - p.maxRangeMm * s - 8)
  }
  c.setLineDash([])

  // World (x right, y forward, mm) → screen
  const X = (x: number) => cx + x * s
  const Y = (y: number) => cy - y * s

  // Walls
  const vf = p.viewFilters
  if (p.scene) {
    c.lineCap = 'round'
    for (const wl of p.scene.walls) {
      if (!inVisibleSector(wl.bearing, vf)) continue
      c.strokeStyle = 'rgba(110,160,255,0.85)'
      c.lineWidth = Math.max(3, 60 * s)
      c.beginPath()
      c.moveTo(X(wl.x1), Y(wl.y1))
      c.lineTo(X(wl.x2), Y(wl.y2))
      c.stroke()
    }
    c.lineWidth = 1
    c.lineCap = 'butt'
  }

  // Points
  const pts = p.showPoints ? p.points : null
  if (pts) {
    const size = p.pointSize
    const half = size / 2
    const pal = p.colorMode === 'distance' ? PALETTE : IPALETTE
    for (let i = 0; i < pts.length; i += 3) {
      const a = rad(pts[i])
      const d = pts[i + 1]
      if (d > p.maxRangeMm) continue
      if (!inVisibleSector(pts[i], vf)) continue
      const x = cx + Math.sin(a) * d * s
      const y = cy - Math.cos(a) * d * s
      if (x < -5 || y < -5 || x > w + 5 || y > h + 5) continue
      const t =
        p.colorMode === 'distance' ? Math.min(1, d / COLOR_RANGE_MM) : Math.min(1, pts[i + 2] / 255)
      c.fillStyle = p.alertEnabled && d < p.thresholdMm && p.alertBins?.[Math.floor(pts[i] / BIN_DEG) % BIN_COUNT]
        ? '#ff4b3e'
        : pal[Math.round(t * 63)]
      c.fillRect(x - half, y - half, size, size)
    }
  }

  // Object boxes + labels
  if (p.scene) {
    c.font = '600 12px "Segoe UI", system-ui, sans-serif'
    c.textBaseline = 'bottom'
    for (const o of p.scene.objects) {
      if (!inVisibleSector(o.bearing, vf)) continue
      if (vf.movingOnly && !o.moving) continue
      const inAlert = p.alertEnabled && o.distance < p.thresholdMm
      const sel = o.id === p.selectedId
      const color = inAlert ? '#ff4b3e' : o.moving ? '#ff6bd6' : '#ffb547'
      const corners = boxCorners(o, 80)
      c.fillStyle = color + (sel ? '55' : '30')
      c.strokeStyle = color
      c.lineWidth = sel ? 3 : 2
      c.beginPath()
      corners.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))))
      c.closePath()
      c.fill()
      c.stroke()

      if (o.moving) {
        c.lineWidth = 2
        c.beginPath()
        c.moveTo(X(o.cx), Y(o.cy))
        c.lineTo(X(o.cx + o.vx * 0.8), Y(o.cy + o.vy * 0.8))
        c.stroke()
      }

      let top = corners[0]
      for (const k of corners) if (Y(k[1]) < Y(top[1])) top = k
      const sectorLabel = o.bearing >= 315 || o.bearing < 45 ? 'F'
        : o.bearing >= 45 && o.bearing < 135 ? 'R'
        : o.bearing >= 135 && o.bearing < 225 ? 'B'
        : 'L'
      const label = `#${o.id} [${sectorLabel}] ${(o.distance / 1000).toFixed(2)} m`
      const tx = X(top[0])
      const ty = Y(top[1]) - 5
      const tw = c.measureText(label).width
      c.fillStyle = 'rgba(7,11,16,0.85)'
      c.fillRect(tx - 4, ty - 15, tw + 8, 17)
      c.fillStyle = color
      c.fillText(label, tx, ty)
    }
    c.lineWidth = 1

    // Wall distance labels
    c.font = '11px "Segoe UI", system-ui, sans-serif'
    for (const wl of p.scene.walls) {
      if (!inVisibleSector(wl.bearing, vf)) continue
      const mx = X((wl.x1 + wl.x2) / 2)
      const my = Y((wl.y1 + wl.y2) / 2)
      const label = `wall ${(wl.distance / 1000).toFixed(2)} m`
      const tw = c.measureText(label).width
      c.fillStyle = 'rgba(7,11,16,0.75)'
      c.fillRect(mx - tw / 2 - 3, my - 14, tw + 6, 15)
      c.fillStyle = 'rgba(150,185,255,0.95)'
      c.fillText(label, mx - tw / 2, my)
    }
  }

  // Sensor marker (forward = 0° = up) — shaped as a small vehicle arrow
  c.fillStyle = '#e8f4ff'
  c.beginPath()
  c.arc(cx, cy, 5, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = 'rgba(232,244,255,0.8)'
  c.beginPath()
  c.moveTo(cx, cy - 18)
  c.lineTo(cx - 7, cy - 6)
  c.lineTo(cx + 7, cy - 6)
  c.closePath()
  c.fill()
}

function drawRoad(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  w: number,
  h: number
): void {
  const toScreenX = (worldX: number) => cx + worldX * s
  const leftEdge = toScreenX(ROAD_LEFT_EDGE_MM)
  const rightEdge = toScreenX(ROAD_RIGHT_EDGE_MM)
  const centerLine = toScreenX(ROAD_CENTER_X_MM)

  // Asphalt surface
  c.fillStyle = 'rgba(35,35,40,0.7)'
  c.fillRect(leftEdge, 0, rightEdge - leftEdge, h)

  // Road edge lines (solid white)
  const edgeW = Math.max(1, 150 * s)
  c.fillStyle = 'rgba(255,255,255,0.45)'
  c.fillRect(leftEdge - edgeW / 2, 0, edgeW, h)
  c.fillRect(rightEdge - edgeW / 2, 0, edgeW, h)

  // Center dividing line (dashed yellow)
  const lineW = Math.max(1, 100 * s)
  const dashLen = 3000 * s
  const gapLen = 2000 * s
  c.strokeStyle = 'rgba(255,200,0,0.6)'
  c.lineWidth = lineW
  c.setLineDash([dashLen, gapLen])
  c.beginPath()
  c.moveTo(centerLine, 0)
  c.lineTo(centerLine, h)
  c.stroke()
  c.setLineDash([])
  c.lineWidth = 1
}
