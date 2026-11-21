import { describe, expect, it } from 'vitest'
import { LARGE } from './field-size'
import { DEFAULT, demonstration, freshField, HEIGHT, PathInput, project, Transfer, WIDTH } from './density-transfer'

const kernel = new Transfer(DEFAULT)
const p = { x: 80, y: 80 }
const idx = (x: number, y: number) => y * WIDTH + x
const mass = (f: Float64Array) => f.reduce((a, b) => a + b, 0)
describe('fixed energy density', () => {
  it('conserves actual removed mass at the edge and never fills an empty core from nowhere', () => {
    const f = freshField(), total = mass(f)
    for (let n = 0; n < 100; n++) kernel.stamp(f, { x: 0, y: 0 })
    expect(mass(f)).toBeCloseTo(total, 8); expect(f.every(v => v >= 0)).toBe(true)
    f.fill(0); kernel.stamp(f, p); expect(mass(f)).toBe(0)
  })
  it('holds still after a tap, removes less on exact repeat and consumes the displaced rim on offset repeat', () => {
    const f = freshField(), path = new PathInput(f, kernel, p), snapshot = f.slice()
    for (let i = 0; i < 100; i++) expect(path.move(p).count).toBe(0)
    expect(f.every((v, i) => v === snapshot[i])).toBe(true)
    const center = idx(80, 80), rim = idx(91, 80)
    kernel.stamp(f, p); expect(f[center]).toBeCloseTo(Math.exp(-1.6), 12)
    expect(snapshot[center] - f[center]).toBeLessThan(1 - snapshot[center])
    const before = f[rim]; expect(before).toBeGreaterThan(1)
    kernel.stamp(f, { x: 91, y: 80 }); expect(before - f[rim]).toBeCloseTo(before * (1 - Math.exp(-0.8)), 12)
  })
  it('carries distance around corners and across subdivisions', () => {
    const f = freshField(), g = freshField(), a = new PathInput(f, kernel, p), b = new PathInput(g, kernel, p)
    a.move({ x: 91, y: 91 }); a.move({ x: 91, y: 103 })
    for (let j = 1; j <= 11; j++) b.move({ x: 80 + j, y: 80 + j })
    for (let j = 1; j <= 12; j++) b.move({ x: 91, y: 91 + j })
    expect(f.every((v, i) => v === g[i])).toBe(true)
  })
  it('expands the buffer without changing extracted mass or touching distant cells', () => {
    const f = freshField(), g = freshField(); kernel.stamp(f, p); new Transfer({ radius: 8, buffer: 14 }).stamp(g, p)
    expect(g[idx(98, 80)]).toBeGreaterThan(f[idx(98, 80)]); expect(g[idx(103, 80)]).toBe(1)
    expect(f[idx(80, 80)]).toBe(g[idx(80, 80)]); expect(mass(g)).toBeCloseTo(mass(f), 9)
  })
  it('measures order dependence in both field and projected image', () => {
    const demo = demonstration(DEFAULT)
    expect(demo.difference).toBeGreaterThan(1); expect(demo.pixels).toBeGreaterThan(10)
    for (const f of [demo.ab, demo.ba]) expect(mass(f)).toBeCloseTo(WIDTH * HEIGHT, 8)
    expect(project(1, 'stencil')).not.toBe(project(0.3, 'stencil'))
  })
  it('preserves the fractional step when a frame has zero impulses left', () => {
    const run = (pause: boolean) => {
      const field = freshField(), path = new PathInput(field, kernel, p)
      path.move({ x: 82, y: 80 })
      const next = { x: 82, y: 94 }
      if (pause) expect(path.move(next, 0, true)).toEqual({ dirty: undefined, count: 0, more: true })
      path.move(next)
      return field
    }
    const expected = run(false)
    expect(run(true).every((v, i) => v === expected[i])).toBe(true)
  })
  it('keeps the same boundary behavior on the large allowlisted field', () => {
    const f = freshField(LARGE), before = mass(f)
    new Transfer({ ...DEFAULT, shape: 'nib' }).stamp(f, { x: 0, y: 0 })
    expect(mass(f)).toBeCloseTo(before, 8)
    expect(f.every(v => v >= 0)).toBe(true)
  })
  it('rejects unsafe kernels, malformed points and overloaded packets', () => {
    expect(() => new Transfer({ radius: Infinity, buffer: 2 })).toThrow(RangeError)
    expect(() => new Transfer({ radius: 8, buffer: 6, shape: 'invalid' as never })).toThrow(RangeError)
    const refill = new Transfer({ ...DEFAULT, shape: 'refill' })
    expect(() => refill.recover(freshField(), p, NaN)).toThrow(RangeError)
    const path = new PathInput(freshField(), kernel, p)
    expect(() => path.move({ x: NaN, y: 0 })).toThrow(RangeError)
    const limited = new PathInput(freshField(), kernel, p)
    expect(() => limited.move({ x: 5000, y: 80 }, 2)).toThrow(RangeError)
    expect(() => freshField({ width: 240, height: 384 } as never)).toThrow(RangeError)
  })
})
