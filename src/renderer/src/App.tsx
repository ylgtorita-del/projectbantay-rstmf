import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ConnectionBar from './components/ConnectionBar'
import RadarCanvas, { ColorMode, ViewFilters } from './components/RadarCanvas'
import AlertPanel from './components/AlertPanel'
import RecordPanel from './components/RecordPanel'
import DetectionPanel from './components/DetectionPanel'
import { AlertSettings, beep, evaluateAlerts } from './alerts'
import { DEFAULT_DETECT, DetectSettings, Scene, Tracker, detect } from './perception'
import type { LidarStatus, Revolution } from '../../shared/types'

function loadDetect(): DetectSettings {
  try {
    const raw = localStorage.getItem('bantay.detect')
    if (raw) return { ...DEFAULT_DETECT, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_DETECT
}

const DEFAULT_ALERT: AlertSettings = {
  enabled: true,
  thresholdMm: 500,
  sectorStart: 0,
  sectorEnd: 360,
  sound: false
}

function loadAlert(): AlertSettings {
  try {
    const raw = localStorage.getItem('bantay.alert')
    if (raw) return { ...DEFAULT_ALERT, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return DEFAULT_ALERT
}

export default function App() {
  const [status, setStatus] = useState<LidarStatus | null>(null)
  const [live, setLive] = useState<Revolution | null>(null)
  const [replayFrame, setReplayFrame] = useState<Revolution | null>(null)
  const [replaying, setReplaying] = useState(false)
  const [alertCfg, setAlertCfg] = useState<AlertSettings>(loadAlert)
  const [colorMode, setColorMode] = useState<ColorMode>('distance')
  const [pointSize, setPointSize] = useState(3)
  const [showRoad, setShowRoad] = useState(() => {
    try {
      const v = localStorage.getItem('bantay.showRoad')
      return v === null ? true : v === 'true'
    } catch { return true }
  })
  const [viewFilters, setViewFilters] = useState<ViewFilters>(() => {
    const def: ViewFilters = { front: true, right: true, rear: true, left: true, movingOnly: false }
    try {
      const raw = localStorage.getItem('bantay.viewFilters')
      if (raw) return { ...def, ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return def
  })
  const [detectCfg, setDetectCfg] = useState<DetectSettings>(loadDetect)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const trackerRef = useRef(new Tracker())
  const [toast, setToast] = useState<{ msg: string; error: boolean } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const notify = useCallback((msg: string, error = false) => {
    setToast({ msg, error })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), error ? 6000 : 4000)
  }, [])
  const notifyError = useCallback((msg: string) => notify(msg, true), [notify])

  useEffect(() => {
    window.bantay.getStatus().then(setStatus)
    const offStatus = window.bantay.onStatus(setStatus)
    const offScan = window.bantay.onScan(setLive)
    return () => {
      offStatus()
      offScan()
    }
  }, [])

  useEffect(() => {
    if (status?.state === 'error' && status.message) notifyError(status.message)
  }, [status?.state, status?.message, notifyError])

  useEffect(() => {
    try {
      localStorage.setItem('bantay.alert', JSON.stringify(alertCfg))
    } catch {
      /* ignore */
    }
  }, [alertCfg])

  useEffect(() => {
    try {
      localStorage.setItem('bantay.detect', JSON.stringify(detectCfg))
    } catch {
      /* ignore */
    }
  }, [detectCfg])

  useEffect(() => {
    try { localStorage.setItem('bantay.showRoad', String(showRoad)) } catch { /* ignore */ }
  }, [showRoad])

  useEffect(() => {
    try { localStorage.setItem('bantay.viewFilters', JSON.stringify(viewFilters)) } catch { /* ignore */ }
  }, [viewFilters])

  const frame = replaying ? replayFrame : status?.state === 'connected' ? live : null
  const alerts = useMemo(() => evaluateAlerts(frame?.points ?? null, alertCfg), [frame, alertCfg])

  const scene = useMemo<Scene | null>(() => {
    if (!frame) return null
    const raw = detect(frame.points, detectCfg)
    const objects = detectCfg.objects ? trackerRef.current.update(raw.clusters, frame.t) : []
    return { walls: raw.walls, objects, validPoints: raw.valid }
  }, [frame, detectCfg])

  useEffect(() => {
    if (selectedId !== null && !scene?.objects.some((o) => o.id === selectedId)) setSelectedId(null)
  }, [scene, selectedId])

  // Beep repeatedly while the alert is active.
  const alertActive = alerts.active && alertCfg.sound
  useEffect(() => {
    if (!alertActive) return
    beep()
    const id = setInterval(beep, 600)
    return () => clearInterval(id)
  }, [alertActive])

  const onReplayChange = useCallback((active: boolean) => setReplaying(active), [])

  return (
    <div className={`app ${alerts.active ? 'alerting' : ''}`}>
      <ConnectionBar status={status} disabled={replaying} onError={notifyError} />

      <main className="body">
        <RadarCanvas
          points={frame?.points ?? null}
          scene={scene}
          showPoints={detectCfg.showPoints}
          maxRangeMm={detectCfg.maxRangeMm}
          selectedId={selectedId}
          thresholdMm={alertCfg.thresholdMm}
          alertEnabled={alertCfg.enabled}
          alertBins={alertCfg.enabled ? alerts.bins : null}
          sectorStart={alertCfg.sectorStart}
          sectorEnd={alertCfg.sectorEnd}
          colorMode={colorMode}
          pointSize={pointSize}
          showRoad={showRoad}
          viewFilters={viewFilters}
        />

        <aside className="side">
          <DetectionPanel
            settings={detectCfg}
            onChange={setDetectCfg}
            scene={scene}
            selectedId={selectedId}
            onSelect={setSelectedId}
            viewFilters={viewFilters}
            onViewFiltersChange={setViewFilters}
          />
          <AlertPanel settings={alertCfg} onChange={setAlertCfg} result={alerts} />
          <RecordPanel
            status={status}
            onReplayFrame={setReplayFrame}
            onReplayChange={onReplayChange}
            onMessage={notify}
          />
          <section className="panel">
            <div className="panel-head">
              <h2>Display</h2>
            </div>
            <label className="row" style={{ cursor: 'pointer', fontSize: 12 }}>
              <input type="checkbox" checked={showRoad} onChange={(e) => setShowRoad(e.target.checked)} />
              <span>Show road overlay</span>
            </label>
            <label className="field">
              <span>Color points by</span>
              <div className="seg">
                {(['distance', 'intensity'] as ColorMode[]).map((m) => (
                  <button key={m} className={colorMode === m ? 'on' : ''} onClick={() => setColorMode(m)}>
                    {m}
                  </button>
                ))}
              </div>
            </label>
            <label className="field">
              <span>
                Point size <b>{pointSize}px</b>
              </span>
              <input
                type="range"
                min={1}
                max={8}
                value={pointSize}
                onChange={(e) => setPointSize(Number(e.target.value))}
              />
            </label>
            <p className="muted small">
              {frame ? `${(frame.points.length / 3).toLocaleString()} points in this revolution` : 'No scan yet'}
            </p>
          </section>
        </aside>
      </main>

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
