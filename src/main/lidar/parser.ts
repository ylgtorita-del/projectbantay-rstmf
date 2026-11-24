import type { DistanceMode, Revolution } from '../../shared/types'

/**
 * Streaming parser for the YDLIDAR T-mini Plus point-cloud protocol.
 *
 * Packet layout (little-endian), same as YDLIDAR-TEST.py:
 *   PH  u16  0x55AA        (bytes AA 55)
 *   CT  u8   bit0 = start-of-revolution packet, bits1..7 = scan freq * 10
 *   LSN u8   number of samples
 *   FSA u16  first sample angle  ((FSA >> 1) / 64 degrees)
 *   LSA u16  last sample angle
 *   CS  u16  XOR checksum
 *   LSN * 3 bytes: [intensity, distLo, distHi]
 *
 * Unlike the Python test (which only printed the first sample), every sample
 * gets an interpolated angle, and samples are grouped into full revolutions.
 */
export class TminiParser {
  private buf: Buffer = Buffer.alloc(0)
  private pts: number[] = []
  private lastAngle = -1
  private deviceHz = 0
  private measuredHz = 0
  private lastFlush = 0
  private consecutiveBad = 0

  packets = 0
  checksumErrors = 0
  /** Drops packets with a bad checksum. Auto-disabled if the device never matches. */
  strict = true

  constructor(
    private distanceMode: DistanceMode,
    private onRevolution: (rev: Revolution) => void
  ) {}

  get hz(): number {
    return this.deviceHz || this.measuredHz
  }

  /**
   * Distance in mm from the two distance bytes.
   * 'sdk': YDLidar SDK layout, distance = u16 >> 2 (low 2 bits are flags).
   * 'raw': u16 as-is, the formula used in YDLIDAR-TEST.py.
   */
  private distance(lo: number, hi: number): number {
    const raw = lo | (hi << 8)
    return this.distanceMode === 'sdk' ? raw >> 2 : raw
  }

  feed(chunk: Buffer): void {
    const b = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    let pos = 0

    for (;;) {
      let h = -1
      for (let k = pos; k < b.length - 1; k++) {
        if (b[k] === 0xaa && b[k + 1] === 0x55) {
          h = k
          break
        }
      }
      if (h < 0) {
        // Keep a trailing 0xAA in case the 0x55 arrives in the next chunk.
        pos = b.length > 0 && b[b.length - 1] === 0xaa ? b.length - 1 : b.length
        break
      }
      if (b.length - h < 10) {
        pos = h
        break
      }

      const ct = b[h + 2]
      const lsn = b[h + 3]
      if (lsn === 0) {
        pos = h + 2
        continue
      }
      const total = 10 + lsn * 3
      if (b.length - h < total) {
        pos = h
        break
      }

      const fsa = b.readUInt16LE(h + 4)
      const lsa = b.readUInt16LE(h + 6)
      const cs = b.readUInt16LE(h + 8)

      let calc = 0x55aa ^ ((lsn << 8) | ct) ^ fsa ^ lsa
      for (let i = 0; i < lsn; i++) {
        const o = h + 10 + i * 3
        calc ^= b[o]
        calc ^= b[o + 1] | (b[o + 2] << 8)
      }
      calc &= 0xffff

      if (calc !== cs) {
        this.checksumErrors++
        this.consecutiveBad++
        // If nothing has ever matched, this unit's checksum variant differs; stop rejecting.
        if (this.strict && this.consecutiveBad > 200 && this.packets === 0) this.strict = false
        if (this.strict) {
          pos = h + 2
          continue
        }
      } else {
        this.consecutiveBad = 0
      }

      this.packets++

      if (ct & 0x01) {
        this.flush()
        const f = (ct >> 1) / 10
        if (f > 0) this.deviceHz = f
      }

      const sa = (fsa >> 1) / 64
      const ea = (lsa >> 1) / 64
      let diff = ea - sa
      if (diff < 0) diff += 360

      // Fallback revolution detection if start packets are missed.
      if (this.lastAngle >= 0 && sa + 180 < this.lastAngle) this.flush()

      for (let i = 0; i < lsn; i++) {
        const o = h + 10 + i * 3
        const dist = this.distance(b[o + 1], b[o + 2])
        let a = sa + (lsn > 1 ? (diff * i) / (lsn - 1) : 0)
        if (a >= 360) a -= 360
        this.lastAngle = a
        if (dist === 0) continue
        this.pts.push(a, dist, b[o])
      }
      if (this.pts.length > 3 * 20000) this.flush()

      pos = h + total
    }

    this.buf = pos >= b.length ? Buffer.alloc(0) : Buffer.from(b.subarray(pos))
  }

  private flush(): void {
    this.lastAngle = -1
    if (this.pts.length < 3 * 10) {
      this.pts = []
      return
    }
    const now = Date.now()
    if (this.lastFlush) {
      const inst = 1000 / Math.max(1, now - this.lastFlush)
      this.measuredHz = this.measuredHz ? this.measuredHz * 0.8 + inst * 0.2 : inst
    }
    this.lastFlush = now
    const points = Float32Array.from(this.pts)
    this.pts = []
    this.onRevolution({ t: now, hz: Math.round(this.hz * 10) / 10, points })
  }
}
