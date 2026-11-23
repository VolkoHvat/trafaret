import { describe, expect, it } from 'vitest'
import { floodFillData } from './fill'

const RED: [number, number, number] = [255, 0, 0]

function solidPixels(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) { data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3] }
  return data
}

function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

function setPixel(data: Uint8ClampedArray, width: number, x: number, y: number, rgba: [number, number, number, number]) {
  const i = (y * width + x) * 4
  data[i] = rgba[0]; data[i + 1] = rgba[1]; data[i + 2] = rgba[2]; data[i + 3] = rgba[3]
}

describe('floodFillData', () => {
  it('returns null for an empty canvas', () => {
    expect(floodFillData(new Uint8ClampedArray(0), 0, 0, 0, 0, RED, null, 28)).toBeNull()
    expect(floodFillData(new Uint8ClampedArray(0), 0, 4, 0, 0, RED, null, 28)).toBeNull()
  })

  it('fills a single pixel canvas', () => {
    const data = solidPixels(1, 1, [10, 20, 30, 255])
    const bounds = floodFillData(data, 1, 1, 0, 0, RED, null, 28)
    expect(bounds).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(pixelAt(data, 1, 0, 0)).toEqual([255, 0, 0, 255])
  })

  it('returns null when the target already equals the replacement', () => {
    const data = solidPixels(4, 4, [255, 0, 0, 255])
    expect(floodFillData(data, 4, 4, 1, 1, RED, null, 28)).toBeNull()
    expect(pixelAt(data, 4, 1, 1)).toEqual([255, 0, 0, 255])
  })

  it('stops at canvas borders and non-matching walls', () => {
    const width = 8, height = 6
    const data = solidPixels(width, height, [250, 250, 250, 255])
    for (let y = 0; y < height; y++) setPixel(data, width, 5, y, [0, 0, 0, 255])
    const bounds = floodFillData(data, width, height, 0, 0, RED, null, 0)!
    expect(bounds).toEqual({ x: 0, y: 0, width: 5, height: 6 })
    expect(pixelAt(data, width, 4, 3)).toEqual([255, 0, 0, 255])
    expect(pixelAt(data, width, 5, 3)).toEqual([0, 0, 0, 255])
    // right side of the wall stays unfilled
    expect(pixelAt(data, width, 6, 3)).toEqual([250, 250, 250, 255])
  })

  it('leaves islands of a different color untouched', () => {
    const width = 9, height = 9
    const data = solidPixels(width, height, [250, 250, 250, 255])
    for (let y = 3; y <= 5; y++) for (let x = 3; x <= 5; x++) setPixel(data, width, x, y, [0, 0, 0, 255])
    const bounds = floodFillData(data, width, height, 0, 0, RED, null, 0)!
    expect(bounds).toEqual({ x: 0, y: 0, width: 9, height: 9 })
    expect(pixelAt(data, width, 4, 4)).toEqual([0, 0, 0, 255])
    expect(pixelAt(data, width, 2, 4)).toEqual([255, 0, 0, 255])
  })

  it('respects tolerance per channel', () => {
    const width = 4, height = 1
    const data = solidPixels(width, 1, [100, 100, 100, 255])
    setPixel(data, width, 2, 0, [100, 140, 100, 255])
    setPixel(data, width, 3, 0, [100, 100, 200, 255])
    const bounds = floodFillData(data, width, height, 0, 0, RED, null, 30)!
    expect(bounds).toEqual({ x: 0, y: 0, width: 2, height: 1 })
    expect(pixelAt(data, width, 1, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(data, width, 2, 0)).toEqual([100, 140, 100, 255])
    expect(pixelAt(data, width, 3, 0)).toEqual([100, 100, 200, 255])
  })

  it('respects the selection mask (alpha 0 blocks)', () => {
    const width = 6, height = 6
    const data = solidPixels(width, height, [250, 250, 250, 255])
    const mask = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      mask[i + 3] = x < 3 ? 255 : 0
    }
    const bounds = floodFillData(data, width, height, 0, 0, RED, mask, 28)!
    expect(bounds).toEqual({ x: 0, y: 0, width: 3, height: 6 })
    expect(pixelAt(data, width, 2, 5)).toEqual([255, 0, 0, 255])
    expect(pixelAt(data, width, 3, 5)).toEqual([250, 250, 250, 255])
  })

  it('returns null when the selection blocks the seed pixel', () => {
    const width = 4, height = 4
    const data = solidPixels(width, height, [250, 250, 250, 255])
    const mask = new Uint8ClampedArray(width * height * 4)
    expect(floodFillData(data, width, height, 1, 1, RED, mask, 28)).toBeNull()
    expect(pixelAt(data, width, 1, 1)).toEqual([250, 250, 250, 255])
  })

  it('terminates and fills everything when the replacement is within tolerance of the target', () => {
    const width = 32, height = 32
    const data = solidPixels(width, height, [100, 100, 100, 255])
    const bounds = floodFillData(data, width, height, 0, 0, [112, 100, 100], null, 28)!
    expect(bounds).toEqual({ x: 0, y: 0, width, height })
    expect(pixelAt(data, width, 31, 31)).toEqual([112, 100, 100, 255])
  })

  it('handles tolerance-0 fill that matches the replacement after the first pass', () => {
    // replacement exactly equals target rgb: early return keeps the canvas unchanged
    const data = solidPixels(3, 3, [7, 7, 7, 255])
    expect(floodFillData(data, 3, 3, 1, 1, [7, 7, 7], null, 0)).toBeNull()
    expect(pixelAt(data, 3, 1, 1)).toEqual([7, 7, 7, 255])
  })

  it('fills a 4096x4096 uniform canvas', () => {
    const width = 4096, height = 4096
    const data = solidPixels(width, height, [243, 241, 233, 255])
    const start = performance.now()
    const bounds = floodFillData(data, width, height, 2048, 2048, RED, null, 28)!
    const elapsed = performance.now() - start
    expect(bounds).toEqual({ x: 0, y: 0, width, height })
    expect(pixelAt(data, width, 0, 0)).toEqual([255, 0, 0, 255])
    expect(pixelAt(data, width, 4095, 4095)).toEqual([255, 0, 0, 255])
    if (import.meta.env.MODE === 'fill-performance') {
      console.info(`4096x4096 flood fill: ${elapsed.toFixed(1)} ms (required: < 2000 ms)`)
      expect(elapsed).toBeLessThan(2000)
    }
  })

  it('clamps out-of-range start coordinates', () => {
    const data = solidPixels(3, 3, [250, 250, 250, 255])
    const bounds = floodFillData(data, 3, 3, 99, -5, RED, null, 28)!
    expect(bounds).toEqual({ x: 0, y: 0, width: 3, height: 3 })
  })
})
