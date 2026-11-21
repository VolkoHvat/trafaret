import { describe, expect, it } from 'vitest'
import { fieldMapper, fieldPointerStroke, physicalBrush } from './field-pointer-input'

type Fake = { clientX: number; clientY: number; pressure: number; timeStamp: number; pointerId: number }
const sample = (x: number, timeStamp = x): Fake => ({ clientX: x, clientY: x / 2, pressure: 0.5, timeStamp, pointerId: 7 })

function clock() {
  const callbacks: (() => void)[] = []
  return {
    callbacks,
    request(run: () => void) { callbacks.push(run); return callbacks.length },
    cancel() { callbacks.shift() },
    flush() { callbacks.shift()?.() },
  }
}

describe('field pointer input', () => {
  it('maps physical brush size independently of viewport zoom', () => {
    expect(physicalBrush(2, 200, 1000)).toEqual({ radius: 10, actualRadiusMm: 2 })
    expect(physicalBrush(2, 200, 500)).toEqual({ radius: 5, actualRadiusMm: 2 })
    expect(() => physicalBrush(1, 100, 100)).toThrow(RangeError)
  })

  it('maps client coordinates from the field viewport, not the zoomed CSS box', () => {
    const map = fieldMapper(1000, 500, { left: 10, top: 20, width: 200, height: 100 })
    expect(map(sample(110, 42))).toEqual({ x: 500, y: 175, time: 42, pressure: 0.5 })
  })

  it('requires whole cell counts but accepts fractional CSS dimensions', () => {
    const rect = { left: 0, top: 0, width: 100.5, height: 50.25 }
    expect(fieldMapper(384, 240, rect)(sample(100.5))).toMatchObject({ x: 384, y: 240 })
    expect(() => fieldMapper(384.5, 240, rect)).toThrow(RangeError)
    expect(() => fieldMapper(384, 240.5, rect)).toThrow(RangeError)
  })

  it('deduplicates the terminal coalesced event', () => {
    const raf = clock(), moved: number[] = [], committed: number[] = []
    const stroke = fieldPointerStroke(7, raf, {
      move(point, budget) { moved.push(point.x); return { count: Math.min(1, budget), more: false } },
      afterFrame() {}, commit(dropped) { committed.push(dropped) }, rollback() { throw Error('unexpected rollback') },
    })
    const map = (e: Omit<Fake, 'pointerId'>) => ({ x: e.clientX, y: e.clientY, time: e.timeStamp, pressure: e.pressure })
    const end = sample(3)
    stroke.packet({ ...end, getCoalescedEvents: () => [sample(1), sample(2), end] }, map, true)
    expect(raf.callbacks).toHaveLength(1)
    raf.flush()
    expect(moved).toEqual([1, 2, 3])
    expect(committed).toEqual([0])
  })

  it('cancels the captured pointer without committing and ignores other pointers', () => {
    const raf = clock(), committed: number[] = [], rolledBack: number[] = []
    const stroke = fieldPointerStroke(7, raf, {
      move: () => ({ count: 1, more: false }), afterFrame() {}, commit: d => committed.push(d), rollback: () => rolledBack.push(1),
    })
    const map = (e: Omit<Fake, 'pointerId'>) => ({ x: e.clientX, y: e.clientY, time: e.timeStamp, pressure: e.pressure })
    stroke.packet({ ...sample(1), pointerId: 8 }, map)
    stroke.cancel(8)
    expect(rolledBack).toEqual([])
    stroke.cancel(7)
    expect(rolledBack).toEqual([1]); expect(committed).toEqual([])
  })

  it('bounds a long coalesced input and reports dropped samples', () => {
    const raf = clock(), moved: number[] = [], committed: number[] = []
    const stroke = fieldPointerStroke(7, raf, {
      move(point) { moved.push(point.x); return { count: 1, more: false } }, afterFrame() {}, commit: d => committed.push(d), rollback() {},
    })
    const events = Array.from({ length: 3000 }, (_, i) => sample(i))
    stroke.packet({ ...sample(3000), getCoalescedEvents: () => events }, e => ({ x: e.clientX, y: 0, time: e.timeStamp, pressure: 0 }), true)
    expect(stroke.pending).toBe(2048)
    expect(stroke.dropped).toBe(953)
    expect(moved).toHaveLength(0)
    raf.flush()
    expect(moved).toHaveLength(64)
    expect(committed).toEqual([])
    while (raf.callbacks.length) raf.flush()
    expect(committed).toEqual([953])
    expect(moved).toHaveLength(2048)
    expect(moved.at(-1)).toBe(3000)
  })
})
