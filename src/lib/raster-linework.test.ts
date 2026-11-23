import { describe, expect, it } from 'vitest'
import { defaultRasterLineworkParams, rasterToLinework } from './raster-linework'

describe('raster to linework', () => {
  it('is deterministic and detects a high contrast segment', () => {
    const rgba = new Uint8ClampedArray(8 * 4 * 4).fill(255)
    for (let y = 0; y < 4; y++) for (let x = 2; x < 6; x++) rgba[(y * 8 + x) * 4] = rgba[(y * 8 + x) * 4 + 1] = rgba[(y * 8 + x) * 4 + 2] = 0
    const params = { ...defaultRasterLineworkParams(), threshold: 80, edgeSensitivity: 20, minSegment: 2 }
    const a = rasterToLinework(rgba, 8, 4, params), b = rasterToLinework(rgba, 8, 4, params)
    expect(a).toEqual(b)
    expect(a.candidates).toBeGreaterThan(0)
    expect(a.segments.length).toBeGreaterThan(0)
  })
  it('rejects malformed input and reports transparent pixels', () => {
    expect(() => rasterToLinework(new Uint8ClampedArray(3), 2, 2, defaultRasterLineworkParams())).toThrow()
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    rgba[3] = 0
    const result = rasterToLinework(rgba, 4, 4, { ...defaultRasterLineworkParams(), threshold: 255 })
    expect(result.transparent).toBe(1)
  })
  it('rejects non-finite and out-of-range controls instead of silently changing the preview', () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(255)
    expect(() => rasterToLinework(rgba, 4, 4, { ...defaultRasterLineworkParams(), threshold: Number.NaN })).toThrow()
    expect(() => rasterToLinework(rgba, 4, 4, { ...defaultRasterLineworkParams(), edgeSensitivity: 0 })).toThrow()
    expect(() => rasterToLinework(rgba, 4, 4, { ...defaultRasterLineworkParams(), minSegment: 1.5 })).toThrow()
    expect(() => rasterToLinework(rgba, 4, 4, { ...defaultRasterLineworkParams(), simplify: 9 })).toThrow()
  })
})
