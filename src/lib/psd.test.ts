import { describe, expect, it } from 'vitest'
import { readPsd, writePsd } from './psd'

function header(width: number, height: number, channels: number, compression: number) {
  const bytes = new Uint8Array(40)
  const view = new DataView(bytes.buffer)
  bytes.set([56, 66, 80, 83], 0)
  view.setUint16(4, 1)
  view.setUint16(12, channels)
  view.setUint32(14, height)
  view.setUint32(18, width)
  view.setUint16(22, 8)
  view.setUint16(24, 3)
  view.setUint16(38, compression)
  return bytes
}

describe('PSD', () => {
  it('round-trips a flattened RGBA image', () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 128,
      0, 0, 255, 255, 20, 40, 60, 255,
    ])
    const bytes = writePsd({ width: 2, height: 2, rgba })
    const decoded = readPsd(bytes)

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    expect(decoded.rgba).toEqual(rgba)
  })

  it('decodes per-row RLE planes', () => {
    const bytes = new Uint8Array([...header(2, 1, 3, 1), 1, 10, 20, 255, 30, 255, 40])
    const decoded = readPsd(bytes)

    expect(Array.from(decoded.rgba)).toEqual([10, 30, 40, 255, 20, 30, 40, 255])
  })

  it('rejects invalid files and broken RLE', () => {
    expect(() => readPsd(new Uint8Array(40))).toThrow()
    expect(() => readPsd(new Uint8Array([...header(2, 1, 3, 1), 2, 10]))).toThrow()
  })
})
