import type { AlertResult, AlertSettings } from '../alerts'

interface Props {
  settings: AlertSettings
  onChange: (s: AlertSettings) => void
  result: AlertResult
}

export default function AlertPanel({ settings, onChange, result }: Props) {
  const set = (patch: Partial<AlertSettings>) => onChange({ ...settings, ...patch })
  const full = settings.sectorStart === 0 && settings.sectorEnd === 360

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Proximity alert</h2>
        <label className="switch">
          <input type="checkbox" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          <span />
        </label>
      </div>

      <div className={`alert-banner ${result.active ? 'on' : ''}`}>
        {result.active && result.nearest ? (
          <>
            <b>Obstacle {(result.nearest.distance / 1000).toFixed(2)} m</b>
            <span>at {result.nearest.angle.toFixed(0)}°</span>
          </>
        ) : (
          <>
            <b>Clear</b>
            <span>
              {result.closest
                ? `Closest ${(result.closest.distance / 1000).toFixed(2)} m at ${result.closest.angle.toFixed(0)}°`
                : 'No data'}
            </span>
          </>
        )}
      </div>

      <label className="field">
        <span>
          Threshold <b>{(settings.thresholdMm / 1000).toFixed(2)} m</b>
        </span>
        <input
          type="range"
          min={100}
          max={5000}
          step={50}
          value={settings.thresholdMm}
          onChange={(e) => set({ thresholdMm: Number(e.target.value) })}
        />
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={full}
          onChange={(e) => set(e.target.checked ? { sectorStart: 0, sectorEnd: 360 } : { sectorStart: 315, sectorEnd: 45 })}
        />
        Watch all directions
      </label>

      {!full && (
        <div className="row two">
          <label className="field">
            <span>From °</span>
            <input
              type="number"
              min={0}
              max={359}
              value={settings.sectorStart}
              onChange={(e) => set({ sectorStart: clampDeg(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>To °</span>
            <input
              type="number"
              min={0}
              max={359}
              value={settings.sectorEnd}
              onChange={(e) => set({ sectorEnd: clampDeg(e.target.value) })}
            />
          </label>
        </div>
      )}

      <label className="check">
        <input type="checkbox" checked={settings.sound} onChange={(e) => set({ sound: e.target.checked })} />
        Beep while alert is active
      </label>
    </section>
  )
}

function clampDeg(v: string): number {
  const n = Math.round(Number(v) || 0)
  return ((n % 360) + 360) % 360
}
