import { describe, expect, it } from 'vitest'
import { analyzeQuality } from './analyzer'
import type { VectorObject } from '../../types'

const document = { width: 100, height: 100 }

const object = (points: [number, number, number][], overrides: Partial<VectorObject> = {}): VectorObject => ({
  id: 'stroke-1', kind: 'stroke', points,
  brush: {
    id: 'fineline', name: 'Fineline', family: 'line', size: 4, opacity: 1,
    thinning: 0.5, streamline: 0.5, smoothing: 0.5, taperStart: 0, taperEnd: 0,
    pressureCurve: 'linear', passes: 1, jitter: 0,
  },
  color: '#000', pen: true,
  transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  ...overrides,
})

describe('analyzeQuality', () => {
  it('is deterministic for a clean in-bounds line', () => {
    const input = { points: [[10, 10, 0.5], [30, 10, 0.5], [50, 10, 0.5]] as [number, number, number][], document }
    const first = analyzeQuality(input)
    const second = analyzeQuality(input)

    expect(first).toEqual(second)
    expect(first.score).toBeGreaterThan(0.9)
    expect(first.level).toBe('excellent')
    expect(first.metrics.bounds.count).toBe(0)
    expect(first.metrics.intersections.count).toBe(0)
  })

  it('detects sharp turns, self-intersections, and short noisy segments', () => {
    const report = analyzeQuality({
      points: [[10, 10, 0.5], [40, 10, 0.5], [10, 40, 0.5], [40, 40, 0.5], [10, 10, 0.5], [10.1, 10.1, 0.5]] as [number, number, number][],
      document,
    })

    expect(report.metrics.sharpTurns.count).toBeGreaterThan(0)
    expect(report.metrics.intersections.count).toBeGreaterThan(0)
    expect(report.metrics.noise.count).toBeGreaterThan(0)
    expect(report.recommendations.length).toBeGreaterThan(0)
  })

  it('evaluates transformed vector objects and width profile consistency', () => {
    const report = analyzeQuality({
      object: object([[10, 10, 0.5], [30, 10, 0.5], [50, 10, 0.5]], {
        origin: { x: 10, y: 10 },
        transform: { x: 40, y: 0, scale: 1, rotation: 0 },
        widthProfile: { 0: 1, 1: 2, 2: 4 },
      }),
      document,
    })

    expect(report.metrics.bounds.count).toBe(0)
    expect(report.metrics.thickness.variation).toBeGreaterThan(0)
    expect(report.metrics.thickness.score).toBeLessThan(1)
  })

  it('reports motion only when timed or pressure samples are available', () => {
    const unavailable = analyzeQuality({ points: [[1, 1], [5, 1]], document })
    const available = analyzeQuality({
      points: [[1, 1], [5, 1]], document,
      samples: { points: [{ x: 1, y: 1, pressure: 0.2, time: 0 }, { x: 5, y: 1, pressure: 0.8, time: 10 }] },
    })

    expect(unavailable.metrics.motion.available).toBe(false)
    expect(available.metrics.motion.available).toBe(true)
    expect(available.metrics.motion.pressureVariation).toBeGreaterThan(0)
    expect(available.metrics.motion.speedVariation).toBe(0)
  })

  it('accepts multiple vector objects and reports out-of-bounds points', () => {
    const report = analyzeQuality({
      objects: [
        object([[-5, 10, 0.5], [10, 10, 0.5]]),
        object([[20, 20, 0.5], [30, 20, 0.5]], { id: 'stroke-2' }),
      ],
      document,
    })

    expect(report.analyzedPoints).toBe(4)
    expect(report.metrics.bounds.count).toBe(1)
    expect(report.metrics.bounds.outsideDistance).toBe(5)
  })
})
