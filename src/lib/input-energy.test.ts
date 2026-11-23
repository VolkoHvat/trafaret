import { describe, expect, it } from 'vitest'
import { FixedEnergyInput, MeasuredEnergyInput, type EnergyInputSample } from './input-energy.ts'

const sample = (patch: Partial<EnergyInputSample> = {}): EnergyInputSample => ({
  x: 0, y: 0, time: 0, pointerType: 'mouse', ...patch,
})

describe('fixed energy input', () => {
  it('keeps the same impulse regardless of hand motion', () => {
    const input = new FixedEnergyInput(1.5)
    const first = input.next()
    const second = input.next()
    expect(first.energy).toBe(1.5)
    expect(second).toEqual(first)
  })
})

describe('measured energy input', () => {
  it('computes work from pressure and hand displacement', () => {
    const input = new MeasuredEnergyInput()
    expect(input.next(sample({ pressure: 0.6, pointerType: 'pen' })).energy).toBe(0)
    const impulse = input.next(sample({ x: 4, y: 3, time: 0.5, pressure: 0.6, pointerType: 'pen' }))

    expect(impulse.speed).toBeCloseTo(10, 12)
    expect(impulse.power).toBeCloseTo(6, 12)
    expect(impulse.energy).toBeCloseTo(3, 12)
    expect(impulse.source).toBe('measured-pressure')
    expect(impulse.confidence).toBe('measured')
  })

  it('uses an honest velocity-only fallback for mouse and touch', () => {
    const input = new MeasuredEnergyInput()
    input.next(sample())
    const impulse = input.next(sample({ x: 2, time: 0.5 }))
    expect(impulse.energy).toBe(2)
    expect(impulse.source).toBe('velocity-only')
    expect(impulse.confidence).toBe('modelled')
  })

  it('does not create energy at zero speed or invalid time deltas', () => {
    const input = new MeasuredEnergyInput()
    input.next(sample())
    expect(input.next(sample({ time: 0 })).energy).toBe(0)
    expect(input.next(sample({ x: 100, time: -1 })).energy).toBe(0)
  })

  it('does not inherit movement after reset', () => {
    const input = new MeasuredEnergyInput()
    input.next(sample())
    input.next(sample({ x: 100, time: 1 }))
    input.reset()
    expect(input.next(sample({ x: 200, time: 2 })).energy).toBe(0)
  })

  it('rejects non-finite samples', () => {
    expect(() => new MeasuredEnergyInput().next(sample({ x: NaN }))).toThrow('Invalid input sample')
  })
})
