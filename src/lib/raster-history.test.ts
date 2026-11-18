import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decodeRasterData, type EncodedRaster, encodeRasterData, rasterCost,
} from './raster-history'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sha256 = (bytes: Uint8Array | Uint8ClampedArray) => createHash('sha256').update(bytes).digest('hex')

function expectExact(decoded: Uint8ClampedArray, data: Uint8ClampedArray | Uint8Array) {
  expect(decoded.length).toBe(data.length)
  expect(Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength))
    .toEqual(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

function roundtrip(data: Uint8ClampedArray, width: number, height: number) {
  const encoded = encodeRasterData(data, width, height)
  expectExact(decodeRasterData(encoded), data)
  return encoded
}

describe('raster-history pixel RLE', () => {
  it('rejects empty or mismatched rectangles', () => {
    expect(() => encodeRasterData(new Uint8ClampedArray(0), 0, 0)).toThrow()
    expect(() => encodeRasterData(new Uint8ClampedArray(4), 0, 1)).toThrow()
    expect(() => encodeRasterData(new Uint8ClampedArray(8), 2, 2)).toThrow()
    expect(() => encodeRasterData(new Uint8ClampedArray(9), 3, 1)).toThrow()
  })

  it('encodes a 4K solid fill [23,25,20,255] to a small payload with a tight buffer', () => {
    const data = new Uint8ClampedArray(4096 * 4096 * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 23; data[i + 1] = 25; data[i + 2] = 20; data[i + 3] = 255
    }
    const encoded = encodeRasterData(data, 4096, 4096)
    expect(encoded.encoding).toBe('pixel-rle')
    // 16,777,216 identical pixels -> 131,072 run blocks of 128 pixels * 5 bytes
    expect(encoded.bytes.byteLength).toBe(655_360)
    expect(encoded.bytes.buffer.byteLength).toBe(encoded.bytes.byteLength)
    const decoded = decodeRasterData(encoded)
    expect(decoded.length).toBe(data.length)
    const rnd = mulberry32(42)
    for (let k = 0; k < 1024; k++) {
      const idx = Math.floor(rnd() * decoded.length)
      expect(decoded[idx]).toBe(data[idx])
    }
    expect(sha256(decoded)).toBe(sha256(data))
  })

  it('round-trips a small exhaustive set of literal-heavy buffers exactly', () => {
    const values = [0, 1, 17, 128, 255]
    for (let width = 1; width <= 5; width++) {
      for (let height = 1; height <= 4; height++) {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let p = 0; p < width * height; p++) {
          for (let c = 0; c < 4; c++) data[p * 4 + c] = values[(p + c * 7 + width * 3 + height) % values.length]
        }
        roundtrip(data, width, height)
      }
    }
  })

  it('round-trips a small exhaustive set of run-heavy buffers exactly', () => {
    const values = [0, 23, 128, 255]
    for (let width = 1; width <= 5; width++) {
      for (let height = 1; height <= 4; height++) {
        const data = new Uint8ClampedArray(width * height * 4)
        for (let p = 0; p < width * height; p++) {
          const v = values[Math.floor(p / 3) % values.length]
          data[p * 4] = v; data[p * 4 + 1] = v; data[p * 4 + 2] = v; data[p * 4 + 3] = 255
        }
        roundtrip(data, width, height)
      }
    }
  })

  it('round-trips deterministic random data (stored raw when RLE is larger)', () => {
    const rnd = mulberry32(1234)
    const data = new Uint8ClampedArray(97 * 31 * 4)
    for (let i = 0; i < data.length; i++) data[i] = Math.floor(rnd() * 256)
    const encoded = roundtrip(data, 97, 31)
    expect(encoded.encoding).toBe('raw')
    expect(encoded.bytes.byteLength).toBe(data.length)
  })

  it('round-trips runs longer than 128 pixels', () => {
    const data = new Uint8ClampedArray(2400 * 4)
    data.fill(77, 0, 300 * 4)
    data.fill(200, 300 * 4, 700 * 4)
    data.fill(3, 700 * 4)
    const encoded = roundtrip(data, 2400, 1)
    expect(encoded.encoding).toBe('pixel-rle')
    // pixel runs of 300/400/1700 -> (3 + 4 + 14) run blocks * 5 bytes = 105
    expect(encoded.bytes.byteLength).toBe(105)
  })

  it('round-trips alternating bytes exactly', () => {
    const data = new Uint8ClampedArray(257 * 3 * 4)
    for (let i = 0; i < data.length; i++) data[i] = i % 2 === 0 ? 0 : 255
    const encoded = roundtrip(data, 257, 3)
    // every pixel is the identical [0,255,0,255], so this is one 771-pixel run:
    // 7 run blocks (128*6 + 3) * 5 bytes = 35
    expect(encoded.encoding).toBe('pixel-rle')
    expect(encoded.bytes.byteLength).toBe(35)
  })

  it('round-trips every byte value including 128 and 255', () => {
    const data = new Uint8ClampedArray(256 * 2)
    for (let i = 0; i < 256; i++) { data[i * 2] = i; data[i * 2 + 1] = (i + 128) % 256 }
    roundtrip(data, 128, 1)
  })

  it('decodes legacy byte-oriented rle entries', () => {
    // 4 uniform pixels encoded as one legacy run block: header 241 -> 16 repeated bytes
    const legacy: EncodedRaster = { encoding: 'rle', width: 2, height: 2, bytes: new Uint8Array([241, 9]) }
    const decoded = decodeRasterData(legacy)
    expectExact(decoded, new Uint8ClampedArray(16).fill(9))
  })

  it('charges cost by encoded bytes so the byte budget is unchanged', () => {
    const before = encodeRasterData(new Uint8ClampedArray(100 * 4).fill(9), 10, 10)
    const after = encodeRasterData(new Uint8ClampedArray(100 * 4).fill(9), 10, 10)
    // each 100-pixel uniform buffer encodes to one 5-byte run block, so
    // ceil((5 + 5) / 8) = 2 cost units for the pair
    expect(rasterCost(before, after)).toBe(2)
    const random = new Uint8ClampedArray(100 * 4)
    const rnd = mulberry32(7)
    for (let i = 0; i < random.length; i++) random[i] = Math.floor(rnd() * 256)
    const rawAfter = encodeRasterData(random, 10, 10)
    expect(rawAfter.encoding).toBe('raw')
    expect(rasterCost(before, rawAfter)).toBe(Math.ceil((before.bytes.byteLength + 400) / 8))
  })

})
