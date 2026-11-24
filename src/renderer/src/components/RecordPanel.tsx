import { useEffect, useState } from 'react'
import type { LidarStatus, Revolution } from '../../../shared/types'

interface Props {
  status: LidarStatus | null
  onReplayFrame: (rev: Revolution | null) => void
  onReplayChange: (active: boolean) => void
  onMessage: (msg: string, isError?: boolean) => void
}

const SPEEDS = [0.25, 0.5, 1, 2, 4]

function fileName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export default function RecordPanel({ status, onReplayFrame, onReplayChange, onMessage }: Props) {
  const recording = status?.recording ?? false
  const connected = status?.state === 'connected'

  const [replay, setReplay] = useState<{ path: string; frames: Revolution[] } | null>(null)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  // Push the current replay frame to the radar.
  useEffect(() => {
    if (replay) onReplayFrame(replay.frames[idx] ?? null)
  }, [replay, idx, onReplayFrame])

  // Playback timing follows the recorded timestamps.
  useEffect(() => {
    if (!replay || !playing) return
    const frames = replay.frames
    if (idx >= frames.length - 1) {
      setPlaying(false)
      return
    }
    const dt = Math.max(10, Math.min(2000, frames[idx + 1].t - frames[idx].t)) / speed
    const id = setTimeout(() => setIdx((i) => i + 1), dt)
    return () => clearTimeout(id)
  }, [replay, playing, idx, speed])

  const startRec = async () => {
    const res = await window.bantay.startRecording()
    if (!res.ok) onMessage(res.error ?? 'Could not start recording', true)
  }
  const stopRec = async () => {
    const res = await window.bantay.stopRecording()
    if (res.ok && res.data) onMessage(`Saved ${res.data.frames} revolutions to ${fileName(res.data.path)}`)
  }
  const exportCsv = async () => {
    const res = await window.bantay.exportCsv()
    if (!res.ok) onMessage(res.error ?? 'Export failed', true)
    else if (res.data) onMessage(`Exported ${res.data.rows.toLocaleString()} points to ${fileName(res.data.path)}`)
  }
  const open = async () => {
    const res = await window.bantay.openRecording()
    if (!res.ok) return onMessage(res.error ?? 'Could not open recording', true)
    if (!res.data) return
    if (res.data.frames.length === 0) return onMessage('That recording has no scans in it', true)
    setReplay(res.data)
    setIdx(0)
    setPlaying(true)
    onReplayChange(true)
  }
  const closeReplay = () => {
    setReplay(null)
    setPlaying(false)
    onReplayFrame(null)
    onReplayChange(false)
  }

  const frames = replay?.frames ?? []
  const elapsed = frames.length ? (frames[idx].t - frames[0].t) / 1000 : 0
  const duration = frames.length ? (frames[frames.length - 1].t - frames[0].t) / 1000 : 0

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Record &amp; replay</h2>
        {recording && <span className="rec-dot">REC {status?.recordedFrames ?? 0}</span>}
      </div>

      {!replay && (
        <>
          <div className="row">
            {recording ? (
              <button className="danger grow" onClick={stopRec}>
                ■ Stop recording
              </button>
            ) : (
              <button className="grow" onClick={startRec} disabled={!connected}>
                ● Record
              </button>
            )}
          </div>
          {recording && status?.recordingPath && <p className="muted small">{fileName(status.recordingPath)}</p>}
          <div className="row">
            <button className="ghost grow" onClick={exportCsv} disabled={recording}>
              Export CSV
            </button>
            <button className="ghost grow" onClick={open} disabled={recording}>
              Open recording…
            </button>
          </div>
        </>
      )}

      {replay && (
        <div className="replay">
          <p className="muted small">Replaying {fileName(replay.path)}</p>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
          />
          <div className="row between small muted">
            <span>{elapsed.toFixed(1)} s</span>
            <span>
              {idx + 1} / {frames.length}
            </span>
            <span>{duration.toFixed(1)} s</span>
          </div>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                if (idx >= frames.length - 1) setIdx(0)
                setPlaying((p) => !p)
              }}
            >
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <button className="ghost grow" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
          <button className="ghost" onClick={closeReplay}>
            ← Back to live
          </button>
        </div>
      )}
    </section>
  )
}
