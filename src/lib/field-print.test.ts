import { describe, expect, it } from 'vitest'
import { fieldPrintLayout } from './field-print'

describe('fieldPrintLayout', () => {
  it('preserves the backing-store aspect ratio at fractional mm widths', () => {
    expect(fieldPrintLayout(102.4, 384, 240)).toEqual({ widthMm: 102.4, heightMm: 64 })
  })
  it('accepts the exact printable boundary but never shrinks an oversized field', () => {
    expect(fieldPrintLayout(190, 190, 265).heightMm).toBe(265)
    expect(() => fieldPrintLayout(190.001, 2048, 2048)).toThrow(/A4/)
    expect(() => fieldPrintLayout(100, 100, 266)).toThrow(/A4/)
  })
  it.each([0, -1, NaN, Infinity])('rejects invalid width %s', width => {
    expect(() => fieldPrintLayout(width, 384, 240)).toThrow()
  })
  it.each([[0, 240], [384, 0], [Infinity, 240], [384, 0.5]])('rejects unusable raster %s × %s', (w, h) => {
    expect(() => fieldPrintLayout(100, w, h)).toThrow()
  })
})
