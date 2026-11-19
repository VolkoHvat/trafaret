import { describe, expect, it } from 'vitest'
import { convertToDisplayP3, writeIccProfile } from './icc'

describe('ICC', () => {
  it('writes a valid ICC header and tag table', () => {
    for (const profile of ['srgb', 'display-p3'] as const) {
      const bytes = writeIccProfile(profile)
      const view = new DataView(bytes.buffer)

      expect(bytes.length).toBe(view.getUint32(0))
      expect(new TextDecoder('ascii').decode(bytes.subarray(36, 40))).toBe('acsp')
      expect(view.getUint32(128)).toBe(9)
      expect(new TextDecoder('ascii').decode(bytes.subarray(132, 136))).toBe('rXYZ')
    }
  })

  it('converts primary red to Display P3 and preserves neutral values', () => {
    const converted = convertToDisplayP3(new Uint8ClampedArray([
      255, 0, 0, 255, 128, 128, 128, 255,
    ]))

    expect(converted[0]).toBeGreaterThan(225)
    expect(converted[0]).toBeLessThan(245)
    expect(converted[1]).toBeGreaterThan(40)
    expect(converted[1]).toBeLessThan(60)
    expect(converted[2]).toBeGreaterThan(25)
    expect(converted[2]).toBeLessThan(45)
    expect(converted[3]).toBe(255)
    expect(converted[4]).toBe(128)
    expect(converted[5]).toBe(128)
    expect(converted[6]).toBe(128)
  })
})
