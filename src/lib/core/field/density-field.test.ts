import { describe, expect, it } from 'vitest'
import { DensityField } from './density-field.ts'

const brush = { radius: 2, strength: 0.75, compression: 0.5, bufferWidth: 2 }
const point = { x: 0.5, y: 0.5 }

describe('local density field', () => {
  it('produces identical deltas and snapshots for repeated input', () => {
    const run = () => {
      const field = new DensityField(0.5)
      const delta = field.stepSegment({ x: -5, y: 12 }, point, brush)
      field.refill(0.25, 2)
      return [delta, field.snapshot()]
    }
    expect(run()).toEqual(run())
  })

  it('reports exact changed bounds and leaves a remote stroke untouched', () => {
    const field = new DensityField()
    field.stepSegment({ x: 99, y: 99 }, { x: 100, y: 100 }, brush)
    const previous = field.snapshot().cells
    const delta = field.stepSegment(point, { x: 4.5, y: 0.5 }, brush)
    expect(delta.bounds).toEqual({ minX: -3, minY: -3, maxX: 8, maxY: 4 })
    for (const cell of previous) expect(field.density(cell)).toBe(cell.density)
    expect(field.density({ x: 2, y: 4 })).toBe(1)
    expect(new Set(delta.changes.map(c => `${c.x},${c.y}`)).size).toBe(delta.changes.length)
  })

  it('creates both depletion and a finite compression ridge in one point step', () => {
    const field = new DensityField()
    field.stepSegment(point, point, brush)
    expect(field.density(point)).toBe(0.25)
    expect(field.density({ x: 3, y: 0 })).toBe(1.5)
    expect(field.density({ x: 4, y: 0 })).toBe(1)
  })

  it('relaxes both signs and releases equilibrium cells', () => {
    const field = new DensityField()
    field.stepSegment(point, point, brush)
    expect(field.refill(0, 1).bounds).toBeNull()
    field.refill(1, Math.log(2))
    expect(field.density(point)).toBeCloseTo(0.625)
    expect(field.density({ x: 3, y: 0 })).toBeCloseTo(1.25)
    field.refill(1000, 1)
    expect(field.snapshot().cells).toEqual([])
  })

  it('restores a detached snapshot and rejects over-budget work atomically', () => {
    const field = new DensityField()
    field.stepSegment(point, point, brush)
    const snapshot = field.snapshot()
    const copy = new DensityField()
    copy.restore(snapshot)
    expect(copy.snapshot()).toEqual(snapshot)
    expect(() => copy.stepSegment(point, { x: 1e6, y: 1e6 }, brush)).toThrow(RangeError)
    expect(() => copy.restore({ ...snapshot, cells: [...snapshot.cells, snapshot.cells[0]] })).toThrow(RangeError)
    expect(copy.snapshot()).toEqual(snapshot)
  })
})
