import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join, basename } from 'path'
import { LidarDevice } from './lidar/serial'
import { Recorder, exportCsv, readRecording } from './recorder'
import type { ConnectOptions, LidarStatus, Recording, Result, Revolution } from '../shared/types'

let win: BrowserWindow | null = null
const lidar = new LidarDevice()
const recorder = new Recorder()

function fullStatus(): LidarStatus {
  return {
    ...lidar.status,
    recording: recorder.active,
    recordingPath: recorder.path ?? undefined,
    recordedFrames: recorder.frames
  }
}

function sendStatus(): void {
  win?.webContents.send('lidar:status', fullStatus())
}

lidar.on('status', sendStatus)
lidar.on('scan', (rev: Revolution) => {
  recorder.write(rev)
  win?.webContents.send('lidar:scan', rev)
})

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

function registerIpc(): void {
  ipcMain.handle('ports:list', () => wrap(() => lidar.listPorts()))
  ipcMain.handle('lidar:connect', (_e, opts: ConnectOptions) => wrap(() => lidar.connect(opts)))
  ipcMain.handle('lidar:disconnect', () => wrap(() => lidar.disconnect()))
  ipcMain.handle('lidar:status', () => fullStatus())

  ipcMain.handle('rec:start', () =>
    wrap(async () => {
      const res = await dialog.showSaveDialog(win!, {
        title: 'Save recording',
        defaultPath: join(app.getPath('documents'), `bantay-scan-${stamp()}.jsonl`),
        filters: [{ name: 'Bantay recording', extensions: ['jsonl'] }]
      })
      if (res.canceled || !res.filePath) return null
      recorder.start(res.filePath)
      sendStatus()
      return res.filePath
    })
  )

  ipcMain.handle('rec:stop', () =>
    wrap(async () => {
      const r = recorder.stop()
      sendStatus()
      return r
    })
  )

  ipcMain.handle('rec:exportCsv', () =>
    wrap(async () => {
      let src = recorder.lastPath
      if (!src) {
        const pick = await dialog.showOpenDialog(win!, {
          title: 'Choose a recording to export',
          filters: [{ name: 'Bantay recording', extensions: ['jsonl'] }],
          properties: ['openFile']
        })
        if (pick.canceled || !pick.filePaths[0]) return null
        src = pick.filePaths[0]
      }
      const res = await dialog.showSaveDialog(win!, {
        title: 'Export CSV',
        defaultPath: src.replace(/\.jsonl$/i, '') + '.csv',
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (res.canceled || !res.filePath) return null
      const rows = await exportCsv(src, res.filePath)
      return { path: res.filePath, rows, source: basename(src) }
    })
  )

  ipcMain.handle('rec:open', () =>
    wrap(async (): Promise<Recording | null> => {
      const pick = await dialog.showOpenDialog(win!, {
        title: 'Open recording',
        defaultPath: app.getPath('documents'),
        filters: [{ name: 'Bantay recording', extensions: ['jsonl'] }],
        properties: ['openFile']
      })
      if (pick.canceled || !pick.filePaths[0]) return null
      const path = pick.filePaths[0]
      recorder.lastPath = path
      return { path, frames: await readRecording(path) }
    })
  )
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Bantay LiDAR',
    backgroundColor: '#0b1016',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()
})

let quitting = false
app.on('before-quit', (e) => {
  if (quitting) return
  // Stop the motor and finish the recording file before exiting.
  e.preventDefault()
  quitting = true
  recorder.stop()
  lidar.disconnect().finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
