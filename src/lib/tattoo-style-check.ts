import { project } from './density-transfer'

export type TattooSectionAnalysis = {
  status: 'measured' | 'empty' | 'too-few-samples' | 'invalid-length' | 'missing-sample'
  samplePitchMm: number | null
  minInkMm: number | null
  minGapMm: number | null
  inkSeriesMm: number[]
  gapSeriesMm: number[]
  inkSeriesCount: number
  gapSeriesCount: number
  coverage: number | null
}

const empty = (status: TattooSectionAnalysis['status']): TattooSectionAnalysis => ({ status, samplePitchMm: null, minInkMm: null, minGapMm: null, inkSeriesMm: [], gapSeriesMm: [], inkSeriesCount: 0, gapSeriesCount: 0, coverage: null })

/** lengthMm is physical distance along the section (first centre to last), not sheet width.
 * Widths assume transitions midway between adjacent centres; sub-pitch detail is unresolved.
 * coverage is the fraction of sampled centres marked ink, including both ends.
 * A null minimum means no complete run of that kind was observed. Edge-truncated
 * runs are intentionally excluded from the minima and series arrays.
 */
export function analyzeTattooSection(samples: readonly number[], lengthMm: number): TattooSectionAnalysis {
  if (samples.length === 0) return empty('empty')
  if (samples.length < 2) return empty('too-few-samples')
  if (!Number.isFinite(lengthMm) || lengthMm <= 0) return empty('invalid-length')
  const pitch = lengthMm / (samples.length - 1)
  if (pitch === 0) return empty('invalid-length')
  const result: TattooSectionAnalysis = { ...empty('measured'), samplePitchMm: pitch }
  let start = 0, wasInk = false, inkCount = 0
  const inkSeriesMm: number[] = [], gapSeriesMm: number[] = []
  for (let i = 0; i < samples.length; i++) {
    const rho = samples[i]
    if (!Number.isFinite(rho)) return empty('missing-sample')
    const ink = project(rho, 'stencil') <= 64
    if (ink) inkCount++
    if (ink !== wasInk) {
      if (start > 0) {
        const widthMm = (i - start) * pitch
        ;(wasInk ? inkSeriesMm : gapSeriesMm).push(widthMm)
      }
      start = i
    }
    wasInk = ink
  }
  result.inkSeriesMm = [...inkSeriesMm].sort((a, b) => a - b)
  result.gapSeriesMm = [...gapSeriesMm].sort((a, b) => a - b)
  result.inkSeriesCount = inkSeriesMm.length
  result.gapSeriesCount = gapSeriesMm.length
  result.minInkMm = inkSeriesMm.length ? Math.min(...inkSeriesMm) : null
  result.minGapMm = gapSeriesMm.length ? Math.min(...gapSeriesMm) : null
  result.coverage = inkCount / samples.length
  return result
}
