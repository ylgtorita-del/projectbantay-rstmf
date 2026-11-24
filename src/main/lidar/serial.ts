import { EventEmitter } from 'events'
import { SerialPort } from 'serialport'
import { TminiParser } from './parser'
import type { ConnectOptions, LidarStatus, PortInfo, Revolution } from '../../shared/types'

const CMD_START = Buffer.from([0xa5, 0x60])
const CMD_STOP = Buffer.from([0xa5, 0x65])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type BaseStatus = Omit<LidarStatus, 'recording' | 'recordingPath' | 'recordedFrames'>

export class LidarDevice extends EventEmitter {
  private port: SerialPort | null = null
  private parser: TminiParser | null = null
  private timer: NodeJS.Timeout | null = null
  private pointsPerRev = 0

  status: BaseStatus = {
    state: 'disconnected',
    scanHz: 0,
    pointsPerRev: 0,
    packets: 0,
    checksumErrors: 0,
    checksumStrict: true
  }

  async listPorts(): Promise<PortInfo[]> {
    const ports = await SerialPort.list()
    return ports.map((p) => ({
      path: p.path,
      manufacturer: p.manufacturer,
      friendlyName: (p as { friendlyName?: string }).friendlyName,
      vendorId: p.vendorId,
      productId: p.productId
    }))
  }

  private setStatus(patch: Partial<BaseStatus>): void {
    this.status = { ...this.status, ...patch }
    this.emit('status', this.status)
  }

  private write(port: SerialPort, data: Buffer): Promise<void> {
    return new Promise((resolve) => {
      port.write(data, () => port.drain(() => resolve()))
    })
  }

  async connect(opts: ConnectOptions): Promise<void> {
    if (this.port) await this.disconnect()

    this.setStatus({
      state: 'connecting',
      port: opts.path,
      message: undefined,
      scanHz: 0,
      pointsPerRev: 0,
      packets: 0,
      checksumErrors: 0,
      checksumStrict: true
    })

    const port = new SerialPort({ path: opts.path, baudRate: opts.baudRate, autoOpen: false })
    try {
      await new Promise<void>((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())))
    } catch (err) {
      this.setStatus({ state: 'error', message: (err as Error).message })
      throw err
    }

    this.port = port
    const parser = new TminiParser(opts.distanceMode, (rev: Revolution) => {
      this.pointsPerRev = rev.points.length / 3
      this.emit('scan', rev)
    })
    this.parser = parser

    port.on('error', (err) => this.setStatus({ state: 'error', message: err.message }))
    port.on('close', () => {
      if (this.port !== port) return
      this.cleanup()
      this.setStatus({ state: 'disconnected', message: 'Port closed (device unplugged?)' })
    })

    // Same sequence as YDLIDAR-TEST.py: settle, clear the input buffer, send start scan.
    await sleep(500)
    await new Promise<void>((resolve) => port.flush(() => resolve()))
    port.on('data', (d: Buffer) => parser.feed(d))
    await this.write(port, CMD_START)

    this.setStatus({ state: 'connected' })
    this.timer = setInterval(() => {
      this.setStatus({
        scanHz: Math.round(parser.hz * 10) / 10,
        pointsPerRev: this.pointsPerRev,
        packets: parser.packets,
        checksumErrors: parser.checksumErrors,
        checksumStrict: parser.strict,
        message:
          parser.packets === 0 && parser.checksumErrors === 0
            ? 'Waiting for data… check port and baud rate'
            : undefined
      })
    }, 1000)
  }

  private cleanup(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.port = null
    this.parser = null
  }

  /** Sends Stop Scan (motor off) and closes the port. */
  async disconnect(): Promise<void> {
    const port = this.port
    if (!port) return
    this.cleanup()
    try {
      if (port.isOpen) {
        await this.write(port, CMD_STOP)
        await new Promise<void>((resolve) => port.close(() => resolve()))
      }
    } catch {
      /* port already gone */
    }
    this.setStatus({ state: 'disconnected', message: undefined, scanHz: 0 })
  }
}
