import { useCallback, useEffect, useState } from 'react'
import type { DistanceMode, LidarStatus, PortInfo } from '../../../shared/types'

const BAUDS = [230400, 128000, 115200, 153600, 512000]

interface Props {
  status: LidarStatus | null
  disabled: boolean
  onError: (msg: string) => void
}

function portLabel(p: PortInfo): string {
  const name = p.friendlyName || p.manufacturer
  return name ? `${p.path} — ${name.replace(` (${p.path})`, '')}` : p.path
}

function pickDefault(ports: PortInfo[]): string {
  const likely = ports.find((p) =>
    /cp210|silicon labs|ch340|wch|usb.*serial|ydlidar/i.test(`${p.manufacturer} ${p.friendlyName}`)
  )
  return (ports.find((p) => p.path === 'COM4') ?? likely ?? ports[0])?.path ?? ''
}

export default function ConnectionBar({ status, disabled, onError }: Props) {
  const [ports, setPorts] = useState<PortInfo[]>([])
  const [port, setPort] = useState('')
  const [baud, setBaud] = useState(230400)
  const [mode, setMode] = useState<DistanceMode>('sdk')
  const [busy, setBusy] = useState(false)

  const state = status?.state ?? 'disconnected'
  const connected = state === 'connected' || state === 'connecting'

  const refresh = useCallback(async () => {
    const res = await window.bantay.listPorts()
    if (!res.ok) return onError(res.error ?? 'Could not list ports')
    const list = res.data ?? []
    setPorts(list)
    setPort((cur) => (list.some((p) => p.path === cur) ? cur : pickDefault(list)))
  }, [onError])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = async () => {
    setBusy(true)
    const res = connected
      ? await window.bantay.disconnect()
      : await window.bantay.connect({ path: port, baudRate: baud, distanceMode: mode })
    setBusy(false)
    if (!res.ok) onError(res.error ?? 'Connection failed')
  }

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <div>
          <strong>Bantay LiDAR</strong>
          <small>YDLIDAR T-mini Plus</small>
        </div>
      </div>

      <label className="field">
        <span>Port</span>
        <div className="row">
          <select value={port} onChange={(e) => setPort(e.target.value)} disabled={connected || disabled}>
            {ports.length === 0 && <option value="">No ports found</option>}
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {portLabel(p)}
              </option>
            ))}
          </select>
          <button className="ghost icon" onClick={refresh} disabled={connected} title="Refresh ports">
            ↻
          </button>
        </div>
      </label>

      <label className="field">
        <span>Baud</span>
        <select value={baud} onChange={(e) => setBaud(Number(e.target.value))} disabled={connected || disabled}>
          {BAUDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span title="How the 16-bit distance field is decoded">Distance decode</span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as DistanceMode)}
          disabled={connected || disabled}
        >
          <option value="sdk">SDK (raw ÷ 4)</option>
          <option value="raw">Raw (as in test script)</option>
        </select>
      </label>

      <button
        className={connected ? 'danger' : 'primary'}
        onClick={toggle}
        disabled={busy || disabled || (!connected && !port)}
      >
        {busy ? '…' : connected ? 'Disconnect' : 'Connect'}
      </button>

      <div className="stats">
        <span className={`pill ${state}`}>
          <i /> {disabled ? 'replay' : state}
        </span>
        <Stat label="Scan" value={status?.scanHz ? `${status.scanHz} Hz` : '—'} />
        <Stat label="Points/rev" value={status?.pointsPerRev ? String(status.pointsPerRev) : '—'} />
        <Stat
          label="CRC errors"
          value={status ? `${status.checksumErrors}${status.checksumStrict ? '' : ' (off)'}` : '—'}
        />
      </div>
    </header>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  )
}
