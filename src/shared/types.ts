/** How the 16-bit distance field of each sample is interpreted. */
export type DistanceMode = 'sdk' | 'raw'

/** One full 360° revolution. `points` is packed [angleDeg, distanceMm, intensity, ...]. */
export interface Revolution {
  t: number
  hz: number
  points: Float32Array
}

export interface PortInfo {
  path: string
  manufacturer?: string
  friendlyName?: string
  vendorId?: string
  productId?: string
}

export interface ConnectOptions {
  path: string
  baudRate: number
  distanceMode: DistanceMode
}

export interface LidarStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'error'
  port?: string
  message?: string
  scanHz: number
  pointsPerRev: number
  packets: number
  checksumErrors: number
  checksumStrict: boolean
  recording: boolean
  recordingPath?: string
  recordedFrames: number
}

export interface Result<T = undefined> {
  ok: boolean
  error?: string
  data?: T
}

export interface Recording {
  path: string
  frames: Revolution[]
}
