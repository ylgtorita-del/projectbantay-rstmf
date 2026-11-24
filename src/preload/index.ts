import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import type {
  ConnectOptions,
  LidarStatus,
  PortInfo,
  Recording,
  Result,
  Revolution
} from '../shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  listPorts: (): Promise<Result<PortInfo[]>> => ipcRenderer.invoke('ports:list'),
  connect: (opts: ConnectOptions): Promise<Result> => ipcRenderer.invoke('lidar:connect', opts),
  disconnect: (): Promise<Result> => ipcRenderer.invoke('lidar:disconnect'),
  getStatus: (): Promise<LidarStatus> => ipcRenderer.invoke('lidar:status'),
  onScan: (cb: (rev: Revolution) => void) => subscribe<Revolution>('lidar:scan', cb),
  onStatus: (cb: (s: LidarStatus) => void) => subscribe<LidarStatus>('lidar:status', cb),

  startRecording: (): Promise<Result<string | null>> => ipcRenderer.invoke('rec:start'),
  stopRecording: (): Promise<Result<{ path: string; frames: number } | null>> =>
    ipcRenderer.invoke('rec:stop'),
  exportCsv: (): Promise<Result<{ path: string; rows: number; source: string } | null>> =>
    ipcRenderer.invoke('rec:exportCsv'),
  openRecording: (): Promise<Result<Recording | null>> => ipcRenderer.invoke('rec:open')
}

export type BantayApi = typeof api

contextBridge.exposeInMainWorld('bantay', api)
