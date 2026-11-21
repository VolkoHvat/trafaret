type Sample = Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'timeStamp'>
type Packet = Sample & Pick<PointerEvent, 'pointerId'> & { getCoalescedEvents?: () => readonly Sample[] }
type Clock = { request: (run: () => void) => number; cancel: (handle: number) => void }
export type FieldSample = { x: number; y: number; time: number; pressure: number }

export function physicalBrush(radiusMm: number, widthMm: number, columns: number) {
  if (![radiusMm, widthMm].every(n => Number.isFinite(n) && n > 0) || !Number.isSafeInteger(columns) || columns < 1) throw new RangeError('physical dimensions')
  const radius = Math.round(radiusMm / widthMm * columns)
  if (radius < 2 || radius > 14) throw new RangeError('unsupported Transfer radius')
  return { radius, actualRadiusMm: radius / columns * widthMm }
}

export function fieldMapper(columns: number, rows: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  const { left, top, width, height } = rect
  if (![columns, rows].every(n => Number.isSafeInteger(n) && n > 0) || ![width, height].every(n => Number.isFinite(n) && n > 0) || ![left, top].every(Number.isFinite)) throw new RangeError('field viewport')
  return (e: Sample): FieldSample => ({ x: (e.clientX - left) * columns / width, y: (e.clientY - top) * rows / height, time: e.timeStamp, pressure: e.pressure })
}

type Sink = {
  move: (p: FieldSample, budget: number) => { count: number; more: boolean }
  afterFrame: () => void
  commit: (dropped: number) => void
  rollback: () => void
}

// One instance per captured stroke, after the owner applies the pointerdown stamp.
export function fieldPointerStroke(id: number, clock: Clock, sink: Sink) {
  let queue: FieldSample[] = [], frame: number | null = null, ended = false, closed = false, dropped = 0
  const capacity = 2048
  function cancel(pointerId: number) {
    if (closed || pointerId !== id) return
    closed = true
    if (frame !== null) clock.cancel(frame)
    frame = null; queue.length = 0
    sink.rollback()
  }
  function drain() {
    if (closed) return
    frame = null
    let n = 0, budget = 64
    try {
      while (n < queue.length && n < 128 && budget > 0) {
        const { count, more } = sink.move(queue[n], budget)
        if (!Number.isInteger(count) || count < 0 || count > budget || (more && !count)) throw new RangeError('invalid segment progress')
        budget -= count
        if (!more) n++
      }
      queue.splice(0, n); sink.afterFrame()
      if (closed) return
      if (queue.length) frame = clock.request(drain)
      else if (ended) { closed = true; sink.commit(dropped) }
    } catch (error) { cancel(id); throw error }
  }
  function packet(e: Packet, map: (e: Sample) => FieldSample, up = false) {
    if (closed || ended || e.pointerId !== id) return
    try {
      const history = e.getCoalescedEvents?.() ?? []
      const last = history.at(-1)
      const repeated = last && last.clientX === e.clientX && last.clientY === e.clientY && last.timeStamp === e.timeStamp && last.pressure === e.pressure
      const length = history.length - (repeated ? 1 : 0)
      if (queue.length + length + 1 > capacity && queue.length > capacity / 2) {
        const old = queue.length
        queue = queue.filter((_, i) => i % 2 === 0 || i === old - 1)
        dropped += old - queue.length
      }
      const take = Math.min(capacity - queue.length - 1, length)
      dropped += length - take
      for (let i = 0; i < take; i++) queue.push(map(history[Math.floor(i * length / take)]))
      queue.push(map(e)); ended = up
      if (frame === null) frame = clock.request(drain)
    } catch (error) { cancel(id); throw error }
  }
  return { packet, cancel, lostCapture(pointerId: number) { if (!ended) cancel(pointerId) }, get pending() { return queue.length }, get dropped() { return dropped } }
}
