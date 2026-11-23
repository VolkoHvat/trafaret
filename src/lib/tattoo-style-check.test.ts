import { describe, expect, it } from 'vitest'
import { analyzeTattooSection } from './tattoo-style-check'

describe('analyzeTattooSection', () => {
  it('uses the shared stencil threshold and measures only complete runs', () => {
    const result = analyzeTattooSection([1, .7, .6, .6, .7, 1, .6, .6, .7], 8)
    expect(result).toEqual({ status: 'measured', samplePitchMm: 1, minInkMm: 2, minGapMm: 2, inkSeriesMm: [2, 2], gapSeriesMm: [2], inkSeriesCount: 2, gapSeriesCount: 1, coverage: 4 / 9 })
  })

  it('keeps edge-truncated ink and gap runs out of minima', () => {
    const result = analyzeTattooSection([.6, .6, .7, 1, 1, .6, .6], 6)
    expect(result.minInkMm).toBeNull()
    expect(result.minGapMm).toBe(3)
    expect(result.inkSeriesMm).toEqual([])
    expect(result.gapSeriesMm).toEqual([3])
    expect(result.inkSeriesCount).toBe(0)
    expect(result.gapSeriesCount).toBe(1)
    expect(result.coverage).toBeCloseTo(4 / 7)
  })

  it.each([
    [384, 120, 6, 0], [384, 240, 0, 6], [2048, 120, 6, 0], [2048, 120, 6, 6],
  ])('uses section distance for a %i-cell sheet of %i mm, delta (%i, %i)', (width, mm, dx, dy) => {
    const distance = Math.hypot(dx, dy) * mm / width
    const samples = [1, .67, .67, .68, .67, .68, .68]
    const result = analyzeTattooSection(samples, distance)
    expect(result.samplePitchMm).toBeCloseTo(distance / 6, 13)
    expect(result.minInkMm).toBeCloseTo(distance / 6, 13)
    expect(result.minGapMm).toBeCloseTo(distance / 6, 13)
    expect(result.coverage).toBe(3 / 7)
    expect(analyzeTattooSection(samples.reverse(), distance)).toEqual(result)
  })

  it('keeps complete series for a compound cross-section', () => {
    const result = analyzeTattooSection([1, .6, .6, 1, .6, .6, 1], 6)
    expect(result.minInkMm).toBe(2)
    expect(result.minGapMm).toBe(1)
    expect(result.inkSeriesMm).toEqual([2, 2])
    expect(result.gapSeriesMm).toEqual([1])
    expect(result.inkSeriesCount).toBe(2)
    expect(result.gapSeriesCount).toBe(1)
  })

  it('keeps empty series explicit when every run touches an edge', () => {
    expect(analyzeTattooSection([.6, .6, .6], 2)).toEqual({
      status: 'measured', samplePitchMm: 1, minInkMm: null, minGapMm: null,
      inkSeriesMm: [], gapSeriesMm: [], inkSeriesCount: 0, gapSeriesCount: 0, coverage: 1,
    })
    expect(analyzeTattooSection([1, 1, 1], 2)).toEqual({
      status: 'measured', samplePitchMm: 1, minInkMm: null, minGapMm: null,
      inkSeriesMm: [], gapSeriesMm: [], inkSeriesCount: 0, gapSeriesCount: 0, coverage: 0,
    })
  })

  it('does not hide empty, invalid, or missing input', () => {
    expect(analyzeTattooSection([], 10).status).toBe('empty')
    expect(analyzeTattooSection([1], 10).status).toBe('too-few-samples')
    expect(analyzeTattooSection([1, 1], 0).status).toBe('invalid-length')
    expect(analyzeTattooSection([1, NaN], 1).status).toBe('missing-sample')
    expect(analyzeTattooSection([1, 1], 1).coverage).toBe(0)
  })
})
