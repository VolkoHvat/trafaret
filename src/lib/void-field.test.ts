import { describe, expect, it } from 'vitest'
import { VoidProcess, type PenLaw } from './void-field.ts'

const strength = 8 * Math.PI
const law = (patch: Partial<PenLaw> = {}): PenLaw => ({
  width: 2, diffusion: 4, strength, aspect: 1, angle: 0, drift: { x: 0, y: 0 }, ...patch,
})

function processWith(patch: Partial<PenLaw> = {}) {
  const process = new VoidProcess()
  process.append({ point: { x: 0, y: 0 }, time: 0, pressure: 1, law: law(patch) })
  return process
}

describe('dynamic void field', () => {
  it('keeps the infinite equilibrium field implicit', () => {
    const process = new VoidProcess()
    expect(process.sourceCount).toBe(0)
    expect(process.measure({ x: 1e12, y: -1e12 }, 100)).toEqual({
      density: 1, saturation: 1, compression: 0, rarefaction: 0,
      densityRate: 0, saturationRate: 0, rarefactionRate: 0,
    })
  })

  it('creates zero saturation and measures its dynamic rate', () => {
    const process = processWith()
    const initial = process.measure({ x: 0, y: 0 }, 0)
    const later = process.measure({ x: 0, y: 0 }, 1)

    expect(initial.saturation).toBeCloseTo(0, 12)
    expect(initial.rarefaction).toBeCloseTo(1, 12)
    expect(initial.saturationRate).toBeCloseTo(2, 12)
    expect(later.saturation).toBeCloseTo(2 / 3, 12)
    expect(later.saturationRate).toBeCloseTo(2 / 9, 12)
  })

  it('does not let future sources affect the past', () => {
    const process = new VoidProcess()
    process.append({ point: { x: 0, y: 0 }, time: 2, pressure: 1, law: law() })
    expect(process.measure({ x: 0, y: 0 }, 1.99).saturation).toBe(1)
    expect(process.measure({ x: 0, y: 0 }, 2).saturation).toBeCloseTo(0, 12)
  })

  it('conserves integrated density while the disturbance spreads', () => {
    const process = processWith()
    const integrate = (time: number) => {
      const observation = process.observe({ minX: -30, minY: -30, columns: 61, rows: 61, step: 1 }, time)
      return observation.saturation.reduce((sum, saturation) => sum + saturation, 0)
    }
    const initial = integrate(0)
    expect(initial / (61 * 61)).toBeCloseTo(1, 2)
    expect(integrate(2) / initial).toBeCloseTo(1, 2)
  })

  it('creates a compression buffer above equilibrium density', () => {
    const process = processWith()
    const observation = process.observe({ minX: -8, minY: -8, columns: 17, rows: 17, step: 1 }, 0.2)
    expect(observation.saturation.some(value => value > 1)).toBe(true)
    expect(process.measure({ x: 0, y: 0 }, 0.2).compression).toBe(0)
  })

  it('measures the contour from compression to natural density', () => {
    const process = processWith()
    const contour = process.measureContour({ x: 0, y: 0 }, 0.2, 0)

    expect(contour.found).toBe(true)
    expect(contour.inner).toBeGreaterThan(0)
    expect(contour.outer).toBeGreaterThan(contour.inner!)
    expect(contour.width).toBeGreaterThan(0)
    expect(contour.peakCompression).toBeGreaterThan(0)
  })

  it('measures brush energy from motion, radius and buffer width', () => {
    const process = processWith({ drift: { x: 2, y: 0 } })
    const measurement = process.measureEnergy({ x: 0.4, y: 0 }, 0.2)

    expect(measurement.curveSpeed).toBeCloseTo(2, 12)
    expect(measurement.fieldSpeed).toBeGreaterThan(0)
    expect(measurement.rarefactionRadius).toBeGreaterThan(0)
    expect(measurement.bufferWidth).toBeGreaterThan(0)
    expect(measurement.energy).toBeCloseTo(
      measurement.curveSpeed * measurement.fieldSpeed * measurement.rarefactionRadius * measurement.bufferWidth, 12,
    )
    expect(new VoidProcess().measureEnergy({ x: 0, y: 0 }, 0).energy).toBe(0)
  })

  it('expresses pen anisotropy through field deformation', () => {
    const process = processWith({ aspect: 2, compression: 0 })
    expect(process.measure({ x: 4, y: 0 }, 0).rarefaction)
      .toBeGreaterThan(process.measure({ x: 0, y: 4 }, 0).rarefaction)
  })

  it('moves the rarefaction with the law drift', () => {
    const process = processWith({ drift: { x: 2, y: 0 } })
    expect(process.measure({ x: 2, y: 0 }, 1).rarefaction)
      .toBeGreaterThan(process.measure({ x: 0, y: 0 }, 1).rarefaction)
  })

  it('reverses source motion through inertia', () => {
    const process = processWith({ drift: { x: Math.PI, y: 0 }, reverseInertia: Math.PI })
    expect(process.measure({ x: 1, y: 0 }, 0.5).rarefaction)
      .toBeGreaterThan(process.measure({ x: 0, y: 0 }, 0.5).rarefaction)
    expect(process.measure({ x: 0, y: 0 }, 1).rarefaction)
      .toBeGreaterThan(process.measure({ x: 1, y: 0 }, 1).rarefaction)
  })

  it('refills the field behind the leading edge', () => {
    const persistent = processWith({ refill: 0 })
    const refilling = processWith({ refill: 12 })
    const persistentTail = persistent.measure({ x: 0, y: 0 }, 0.2)
    const refillingTail = refilling.measure({ x: 0, y: 0 }, 0.2)
    expect(refillingTail.saturation).toBeGreaterThan(persistentTail.saturation)
    expect(refillingTail.saturationRate).toBeGreaterThan(0)
    expect(refillingTail.rarefactionRate).toBeLessThan(0)

    for (const process of [persistent, refilling]) {
      process.append({ point: { x: 1000, y: 0 }, time: 0.2, pressure: 1, law: process === persistent ? law() : law({ refill: 12 }) })
    }
    expect(refilling.measure({ x: 1000, y: 0 }, 0.2).saturation).toBeCloseTo(0, 12)
  })

  it('prunes only sources that have refilled', () => {
    const refilling = processWith({ refill: 12 })
    expect(refilling.prune(2)).toBe(1)
    expect(refilling.sourceCount).toBe(0)
    const persistent = processWith()
    expect(persistent.prune(2)).toBe(0)
    expect(persistent.sourceCount).toBe(1)
  })

  it('keeps observation and remodeling separate from the actual process', () => {
    const process = processWith({ drift: { x: 4, y: 0 } })
    const before = process.measure({ x: 0, y: 0 }, 1)
    process.observe({ minX: -2, minY: -2, columns: 5, rows: 5, step: 1 }, 0.5)
    const remodeled = process.remodel([
      { point: { x: 4, y: 0 }, pressure: 1 },
      { point: { x: 8, y: 4 }, pressure: 0.8 },
    ], undefined, 0.1, 0.01)

    expect(process.sourceCount).toBe(1)
    expect(process.predictedCount).toBe(0)
    expect(remodeled.sourceCount).toBe(11)
    expect(remodeled.predictedCount).toBe(10)
    expect(remodeled.measure({ x: 4, y: 0 }, 0.05).rarefaction).toBeGreaterThan(0.5)
    expect(process.measure({ x: 0, y: 0 }, 1)).toEqual(before)
  })
})
