import { describe, expect, it } from 'vitest'
import { MIX_CAPACITY as Q, MixingField, mixingBrush, mixingOptics, projectMix } from './pigment-mixing'
import type { MixCell, RGB } from './pigment-mixing'
import { PigmentField } from './pigment'

const paper: RGB = [255, 255, 255]
const red = mixingBrush('red', 0.5), blue = mixingBrush('blue', 0.5)
describe('abstract pigment mixing', () => {
  it('overlap retains both colors, favors the last, and leaves neighbors unchanged', () => {
    const f = new MixingField(2048, 2048)
    const first = f.deposit(4095, 1022, red)
    f.deposit(4095, 1023, red); f.deposit(4095, 1023, blue)
    f.deposit(0, 0, blue); f.deposit(0, 0, red)
    const rb = projectMix(paper, f.get(4095, 1023), 'pigment'), br = projectMix(paper, f.get(0, 0), 'pigment')
    expect(rb[2]).toBeGreaterThan(rb[0]); expect(rb[0]).toBeGreaterThan(rb[1]); expect(br).toEqual([rb[2], rb[1], rb[0]])
    expect(f.get(4095, 1022)).toBe(first.after); expect(f.get(2048, 0)).toBeNull()
  })
  it('repeat approaches a fixed point; displaced material accounts for every unit', () => {
    const brush = mixingBrush([28, 82, 197], 0.12)
    let c: MixCell | null = null
    for (let i = 0; i < 180; i++) {
      const old = c?.mass ?? 0
      const step: ReturnType<typeof brush> = brush(c); c = step.after!
      expect(old + step.offered).toBe(c.mass + step.displaced); expect(c.mass).toBeGreaterThanOrEqual(old)
      const opt = mixingOptics(c); expect(opt.coverage).toBeLessThanOrEqual(1)
      for (let j = 0; j < 3; j++) {
        expect(opt.scattering[j]).toBeGreaterThanOrEqual(0); expect(opt.absorption[j]).toBeGreaterThanOrEqual(0)
        expect(opt.scattering[j] + opt.absorption[j]).toBe(c.mass)
      }
    }
    expect(c!.mass / Q).toBeGreaterThan(0.999); expect(brush(c).after).toEqual(c); expect(mixingBrush('white', 0)(c).after).toBe(c)
  })
  it('white lightens, black darkens; full custom sRGB round trips; stencil reads only base', () => {
    const base: RGB = [110, 110, 110]
    for (const [color, expected] of [['white', paper], ['black', [0, 0, 0]], ['yellow', [255, 255, 0]], [[21, 142, 203], [21, 142, 203]]] as const) {
      const c = mixingBrush(color, 1)(null).after
      expect(projectMix(base, c, 'pigment')).toEqual(expected); expect(projectMix(base, c, 'stencil')).toBe(base)
    }
    expect(projectMix(base, mixingBrush('white', 0.2)(null).after, 'pigment')[0]).toBeGreaterThan(110)
    expect(projectMix(base, mixingBrush('black', 0.2)(null).after, 'pigment')[0]).toBeLessThan(110)
  })
  it('moves only existing composition with normalized, balanced transfer', () => {
    const f = new PigmentField(64,64), color=mixingBrush([113,17,240],1)
    f.apply(f.prepareMix([100,103],color,true),'after');const old=f.mixAt(100)!
    const operation=f.materialStroke();operation.stamp([[100,1]],[[101,1],[102,2],[103,1]])
    expect(f.mixAt(101)).toBeNull();const moved=operation.delta();f.apply(moved,'after')
    const cells=[100,101,102].map(i=>f.mixAt(i)!)
    expect(cells.map(c=>c.mass)).toEqual([40960,8192,16383]);expect(f.mixAt(103)).toEqual(old)
    for(let k=0;k<3;k++)expect(cells.reduce((s,c)=>s+c.scattering[k],0)).toBe(old.scattering[k]);f.apply(moved,'before');expect(f.mixAt(100)).toEqual(old);expect(f.mixAt(102)).toBeNull()
  })
  it('serialized local deltas undo/redo exactly and snapshots restore deterministically', () => {
    const f = new MixingField(2048, 2048)
    const ds = [f.deposit(20, 17, red), f.deposit(20, 17, blue), f.deposit(0, 0, red)]
    const state = JSON.stringify(f.snapshot()), restored = MixingField.restore(JSON.parse(state))
    for (const d of [...ds].reverse()) restored.apply(JSON.parse(JSON.stringify(d)), 'before')
    expect(restored.snapshot().cells).toEqual([])
    for (const d of ds) restored.apply(JSON.parse(JSON.stringify(d)), 'after')
    expect(JSON.stringify(restored.snapshot())).toBe(state)
    expect(restored.deposit(20, 17, red)).toEqual(f.deposit(20, 17, red))
  })
  it('rejects invalid addresses, weights, colors and serialized mass', () => {
    const f = new MixingField(33, 31)
    expect(() => f.deposit(1, 1, red)).toThrow(); expect(() => f.deposit(0, 992, red)).toThrow()
    expect(() => mixingBrush('red', NaN)).toThrow(); expect(() => mixingBrush([0, 0, 256], 1)).toThrow()
    expect(() => MixingField.restore({ ...f.snapshot(), cells: [[0, 0, { mass: 1, scattering: [0, 2, 0] }]] })).toThrow()
  })
})
