import type { DetectSettings, Scene } from '../perception'
import { SENSOR_MAX_RANGE_MM } from '../perception'
import type { ViewFilters } from './RadarCanvas'

interface Props {
  settings: DetectSettings
  onChange: (s: DetectSettings) => void
  scene: Scene | null
  selectedId: number | null
  onSelect: (id: number | null) => void
  viewFilters: ViewFilters
  onViewFiltersChange: (f: ViewFilters) => void
}

const m = (mm: number, digits = 2) => `${(mm / 1000).toFixed(digits)} m`

export default function DetectionPanel({ settings, onChange, scene, selectedId, onSelect, viewFilters, onViewFiltersChange }: Props) {
  const set = (patch: Partial<DetectSettings>) => onChange({ ...settings, ...patch })
  const setFilter = (patch: Partial<ViewFilters>) => onViewFiltersChange({ ...viewFilters, ...patch })
  const objects = scene?.objects ?? []
  const walls = scene?.walls ?? []
  const nearestWall = walls.reduce<(typeof walls)[number] | null>(
    (best, w) => (!best || w.distance < best.distance ? w : best),
    null
  )

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Detection</h2>
        <span className="muted small">
          {objects.length} objects · {walls.length} walls
        </span>
      </div>

      <div className="row toggles">
        <Toggle label="Objects" checked={settings.objects} onChange={(v) => set({ objects: v })} />
        <Toggle label="Walls" checked={settings.walls} onChange={(v) => set({ walls: v })} />
        <Toggle label="Raw points" checked={settings.showPoints} onChange={(v) => set({ showPoints: v })} />
      </div>

      <div className="filter-group">
        <span className="filter-label">Show sectors</span>
        <div className="row toggles">
          <Toggle label="Front" checked={viewFilters.front} onChange={(v) => setFilter({ front: v })} />
          <Toggle label="Right" checked={viewFilters.right} onChange={(v) => setFilter({ right: v })} />
          <Toggle label="Rear" checked={viewFilters.rear} onChange={(v) => setFilter({ rear: v })} />
          <Toggle label="Left" checked={viewFilters.left} onChange={(v) => setFilter({ left: v })} />
        </div>
        <div className="row toggles">
          <Toggle label="Moving only" checked={viewFilters.movingOnly} onChange={(v) => setFilter({ movingOnly: v })} />
        </div>
      </div>

      {nearestWall && settings.walls && (
        <div className="kv">
          <span>Nearest wall</span>
          <b>
            {m(nearestWall.distance)} at {nearestWall.bearing.toFixed(0)}°
          </b>
        </div>
      )}

      {settings.objects && (
        <div className="obj-list">
          {objects.length === 0 && <p className="muted small">No objects detected</p>}
          {objects.slice(0, 12).map((o) => (
            <button
              key={o.id}
              className={`obj ${o.id === selectedId ? 'on' : ''} ${o.moving ? 'moving' : ''}`}
              onClick={() => onSelect(o.id === selectedId ? null : o.id)}
            >
              <span className="obj-id">#{o.id}</span>
              <span className="obj-dist">{m(o.distance)}</span>
              <span className="muted">{o.bearing.toFixed(0)}°</span>
              <span className="muted">
                {(Math.max(o.w, 40) / 1000).toFixed(2)}×{(Math.max(o.h, 40) / 1000).toFixed(2)} m
              </span>
              {o.moving && <span className="tag">moving</span>}
            </button>
          ))}
        </div>
      )}

      <details className="tuning">
        <summary>Tuning</summary>
        <Slider
          label="Range limit"
          value={settings.maxRangeMm}
          min={500}
          max={SENSOR_MAX_RANGE_MM}
          step={250}
          fmt={(v) => m(v, 1)}
          onChange={(v) => set({ maxRangeMm: v })}
        />
        <Slider
          label="Object separation gap"
          hint="Points farther apart than this belong to different objects"
          value={settings.gapMm}
          min={40}
          max={400}
          step={10}
          fmt={(v) => `${v} mm`}
          onChange={(v) => set({ gapMm: v })}
        />
        <Slider
          label="Min points per object"
          hint="Higher = less noise, but small/far objects disappear"
          value={settings.minPoints}
          min={2}
          max={15}
          step={1}
          fmt={(v) => String(v)}
          onChange={(v) => set({ minPoints: v })}
        />
        <Slider
          label="Min wall length"
          value={settings.wallMinLengthMm}
          min={300}
          max={3000}
          step={50}
          fmt={(v) => m(v, 2)}
          onChange={(v) => set({ wallMinLengthMm: v })}
        />
        <Slider
          label="Straightness tolerance"
          value={settings.lineTolMm}
          min={10}
          max={100}
          step={5}
          fmt={(v) => `${v} mm`}
          onChange={(v) => set({ lineTolMm: v })}
        />
      </details>
    </section>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  )
}

function Slider(props: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="field" title={props.hint}>
      <span>
        {props.label} <b>{props.fmt(props.value)}</b>
      </span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  )
}
