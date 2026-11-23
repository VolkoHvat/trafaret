import { expect, it } from 'vitest'
import { decodeField, encodeField, FIELD_BYTES } from './field-document'
import { capture, TileHistory } from './field-tiles'
import type { Patch } from './field-tiles'
import { DEFAULT, freshField, PathInput, Transfer, WIDTH } from './density-transfer'

it('preserves every density bit and rejects size, version, checksum, dimensions, mass and invalid numbers', () => {
  const f = freshField(); new Transfer(DEFAULT).stamp(f, { x: 1, y: 2 })
  const data = encodeField(f); expect(data.byteLength).toBe(FIELD_BYTES)
  const original = new Uint8Array(data)
  expect(new Uint8Array(encodeField(decodeField(data))).every((v, i) => v === original[i])).toBe(true)
  expect(() => decodeField(data.slice(1))).toThrow()
  for (const i of [0, 8, 12, 16, 20, 30]) { const copy = data.slice(0); new Uint8Array(copy)[i] ^= 1; expect(() => decodeField(copy)).toThrow() }
  for (const m of [NaN, Infinity, -1, 9999]) { f[0] = m; expect(() => decodeField(encodeField(f))).toThrow() }
})
it('rejects truncated non-cell-aligned input and unbalanced fields', () => {
  expect(() => decodeField(new ArrayBuffer(25))).toThrow('размер')
  const f = freshField(); f[0] = 2
  expect(() => encodeField(f)).toThrow('баланс')
})

it('caps both history directions together and drops the redo branch on commit', () => {
  const h = new TileHistory(), f = freshField()
  const commit = (v:number) => { const p:Patch = new Map(); capture(p,f,{left:0,top:0,right:0,bottom:0}); h.commit(p); f[0]=v }
  for (let i = 1; i <= 16; i++) commit(i)
  for (let i = 16; i > 4; i--) { expect(h.travel(f, false)).toBeTruthy(); expect(f[0]).toBe(i - 1); expect(h.undoCount + h.redoCount).toBe(12); expect(h.bytes).toBe(12*8192) }
  expect(h.travel(f, false)).toBeUndefined(); h.travel(f, true); expect(f[0]).toBe(5)
  commit(999); expect(h.travel(f, true)).toBeUndefined(); h.travel(f, false); expect(f[0]).toBe(5)
})
it('diagonal nib is anisotropic and conserves mass at corners and in the interior', () => {
  const f = freshField(), kernel = new Transfer({ ...DEFAULT, shape: 'nib' })
  kernel.stamp(f, { x: 30, y: 30 }); expect(f[35 * WIDTH + 35]).toBeLessThan(f[25 * WIDTH + 35])
  for (let i = 0; i < 64; i++) kernel.stamp(f, { x: i, y: 0 })
  expect(f.reduce((a, b) => a + b)).toBeCloseTo(f.length, 8); expect(f.every(v => v >= 0)).toBe(true)
})
it('refill uses interpolated sample time, does not pump at rest, and matches subdivided timed input', () => {
  const run = (time: number, split: boolean) => {
    const f = freshField(), path = new PathInput(f, new Transfer({ ...DEFAULT, shape: 'refill' }), { x: 0, y: 0, time: 0 })
    if (split) path.move({ x: 15, y: 0, time: time / 2 }); path.move({ x: 30, y: 0, time })
    expect(path.move({ x: 30, y: 0, time: 9999 }).count).toBe(0)
    expect(f.reduce((a, b) => a + b)).toBeCloseTo(f.length, 8); expect(f.every(v => v >= 0)).toBe(true)
    return f
  }
  const slow = run(1000, false), packed = run(1000, true), fast = run(10, false)
  expect(slow.every((v, i) => v === packed[i])).toBe(true); expect(slow[30]).toBeGreaterThan(fast[30])
})
