import { SMALL, sizeOf } from './field-size'
import type { Size } from './field-size'
export const WIDTH = SMALL.width, HEIGHT = SMALL.height, STEP = 3
export const DEFAULT = { radius: 8, buffer: 6 }
export type BufferMode = 'full' | 'off'
export type Brush = typeof DEFAULT & { bufferMode?: BufferMode; shape?: 'round' | 'nib' | 'refill' }
export type Point = { x: number; y: number; time?: number }
export type Rect = { left: number; top: number; right: number; bottom: number }
export type Mode = 'tone' | 'stencil'
export const whole = { left: 0, top: 0, right: WIDTH - 1, bottom: HEIGHT - 1 }
export const freshField = ({ width, height }: Size = SMALL) => {
  const size = sizeOf(width * height)
  if (size.width !== width || size.height !== height) throw new RangeError('Неподдерживаемый размер поля')
  return new Float64Array(width * height).fill(1)
}
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
export function merge(a: Rect | undefined, b: Rect): Rect {
  return a ? { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) } : b
}

export class Transfer {
  private core: number[][] = []
  private ring: number[][] = []
  private extent: number
  readonly spacing: number
  readonly refill: boolean
  readonly bufferMode: BufferMode
  markCore?: (index:number)=>void
  private capture?: (rect: Rect) => void
  material?: (core:[number,number][], ring:[number,number][])=>void
  constructor({ radius, buffer, bufferMode = 'full', shape = 'round' }: Brush, capture?: (rect: Rect) => void) {
    if (!['full','off'].includes(bufferMode)) throw new RangeError('buffer mode')
    this.bufferMode = bufferMode
    this.capture = capture
    if (![radius, buffer].every(Number.isInteger) || radius < 1 || radius > 14 || buffer < 2 || buffer > 16
      || !['round', 'nib', 'refill'].includes(shape)) throw new RangeError('brush')
    this.spacing = radius === 1 ? 1 : STEP
    this.refill = bufferMode === 'full' && shape === 'refill'
    this.extent = radius + buffer
    for (let dy = -this.extent; dy <= this.extent; dy++) for (let dx = -this.extent; dx <= this.extent; dx++) {
      const r = shape === 'nib' ? Math.hypot((dx + dy) * Math.SQRT1_2, (dy - dx) * Math.SQRT2) : Math.hypot(dx, dy)
      if (r < radius) this.core.push([dx, dy, -Math.expm1(-0.8 * (1 - (r / radius) ** 2))])
      else if (bufferMode === 'full' && r > radius && r < this.extent) {
        const u = (r - radius) / buffer
        this.ring.push([dx, dy, 4 * u * (1 - u)])
      }
    }
  }
  protected pigmentCore(width:number,x:number,y:number,inside:(dx:number,dy:number)=>boolean) {
    if(this.markCore)for(const [dx,dy] of this.core)if(inside(dx,dy))this.markCore((y+dy)*width+x+dx)
  }
  recover(field: Float64Array, p: Point, dt: number) {
    const { width: WIDTH, height: HEIGHT } = sizeOf(field.length)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(dt) || dt < 0) throw new RangeError('point')
    const x = Math.round(p.x), y = Math.round(p.y)
    const index = (dx: number, dy: number) => x + dx < 0 || y + dy < 0 || x + dx >= WIDTH || y + dy >= HEIGHT ? -1 : (y + dy) * WIDTH + x + dx
    let demand = 0, supply = 0
    for (const [dx, dy, w] of this.core) { const i = index(dx, dy); if (i >= 0) demand += w * Math.max(0, 1 - field[i]) }
    for (const [dx, dy, w] of this.ring) { const i = index(dx, dy); if (i >= 0) supply += w * Math.max(0, field[i] - 1) }
    const mass = Math.min(demand, supply) * -Math.expm1(-Math.min(dt, 250) / 100)
    if (!(mass > 0)) return
    for (const [dx, dy, w] of this.ring) { const i = index(dx, dy); if (i >= 0) field[i] -= mass * (w * Math.max(0, field[i] - 1) / supply) }
    for (const [dx, dy, w] of this.core) { const i = index(dx, dy); if (i >= 0) field[i] += mass * (w * Math.max(0, 1 - field[i]) / demand) }
  }
  stamp(field: Float64Array, p: Point): Rect {
    const { width: WIDTH, height: HEIGHT } = sizeOf(field.length)
    const x = Math.round(p.x), y = Math.round(p.y)
    const inside = (dx: number, dy: number) => x + dx >= 0 && x + dx < WIDTH && y + dy >= 0 && y + dy < HEIGHT
    const rect = { left: Math.max(0, x - this.extent), right: Math.min(WIDTH - 1, x + this.extent), top: Math.max(0, y - this.extent), bottom: Math.min(HEIGHT - 1, y + this.extent) }
    if (this.bufferMode === 'off') {
      this.pigmentCore(WIDTH,x,y,inside)
      return rect
    }
    this.capture?.(rect)
    let sum = 0, mass = 0
    for (const [dx, dy, w] of this.ring) if (inside(dx, dy)) sum += w
    if (sum > 0) {
      if(this.material){const samples=(weights:number[][]):[number,number][]=>weights.filter(([dx,dy])=>inside(dx,dy)).map(([dx,dy,w])=>[(y+dy)*WIDTH+x+dx,w]);this.material(samples(this.core).map(([i,w])=>[i,Math.min(1,field[i])*w]),samples(this.ring))}
      for (const [dx, dy, fraction] of this.core) if (inside(dx, dy)) {
        const i = (y + dy) * WIDTH + x + dx, take = field[i] * fraction
        field[i] -= take
        mass += take
      }
      for (const [dx, dy, w] of this.ring) if (inside(dx, dy)) field[(y + dy) * WIDTH + x + dx] += mass * w / sum
    }
    return { left: Math.max(0, x - this.extent), right: Math.min(WIDTH - 1, x + this.extent), top: Math.max(0, y - this.extent), bottom: Math.min(HEIGHT - 1, y + this.extent) }
  }
}

function bounded({ x, y, time = 0 }: Point, { width: WIDTH, height: HEIGHT }: Size) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('point')
  return { x: clamp(x, 0, WIDTH - 1), y: clamp(y, 0, HEIGHT - 1), time: Number.isFinite(time) ? time : 0 }
}
export class PathInput {
  private last: Point
  private previousStamp: Point
  private until: number
  private brush: Transfer
  private field: Float64Array
  readonly first: Rect
  constructor(field: Float64Array, brush: Transfer, start: Point) {
    this.until = brush.spacing
    this.field = field; this.brush = brush; this.last = bounded(start, sizeOf(field.length)); this.previousStamp = this.last
    // The initial impulse also serves as the entire tap; release never stamps.
    this.first = brush.stamp(field, this.last)
  }
  move(point: Point, budget = Infinity, resumable = false) {
    const next = bounded(point, sizeOf(this.field.length)), dx = next.x - this.last.x, dy = next.y - this.last.y
    const spacing = this.brush.spacing, length = Math.hypot(dx, dy)
    if (budget !== Infinity && (!Number.isSafeInteger(budget) || budget < 0)) throw new RangeError('input budget')
    if (!resumable && length > 0 && this.until + spacing * budget <= length + 1e-9) throw new RangeError('input budget')
    let distance = this.until, count = 0, dirty: Rect | undefined
    while (distance <= length + 1e-9 && length > 0) {
      if (count >= budget) {
        if (!resumable) throw new RangeError('input budget')
        const t = (distance - spacing) / length
        this.last = { x:this.last.x+dx*t, y:this.last.y+dy*t, time:(this.last.time??0)+(next.time-(this.last.time??0))*t }; this.until=spacing
        return { dirty, count, more:true }
      }
      count++
      const t = Math.min(1, distance / length)
      const snap = (v: number) => Math.round(v * 1e9) / 1e9
      const time = (this.last.time ?? 0) + (next.time - (this.last.time ?? 0)) * t
      const point = { x: snap(this.last.x + dx * t), y: snap(this.last.y + dy * t), time }
      const rect = this.brush.stamp(this.field, point)
      if (this.brush.refill) this.brush.recover(this.field, point, Math.max(0, time - (this.previousStamp.time ?? 0)))
      this.previousStamp = point; dirty = merge(dirty, rect)
      distance += spacing
    }
    this.until = distance - length; this.last = next
    return { dirty, count }
  }
}

export function project(m: number, mode: Mode) {
  return mode === 'stencil' ? (m < 0.68 ? 22 : 247) : Math.round(clamp(176 + 100 * Math.log2(Math.max(0.01, m)), 16, 251))
}
export function demoOrder(brush: Brush, size: Size, reverse: boolean) {
  const kernel = new Transfer(brush)
  const lines = [[{ x: 52, y: 159 }, { x: 329, y: 81 }], [{ x: 67, y: 74 }, { x: 314, y: 176 }]]
  const scale = (p:Point) => ({x:p.x*size.width/SMALL.width,y:p.y*size.height/SMALL.height})
  const f = freshField(size)
  for (const i of reverse ? [1,0] : [0,1]) new PathInput(f,kernel,scale(lines[i][0])).move(scale(lines[i][1]))
  return f
}
export function demonstration(brush:Brush) {
  const ab = demoOrder(brush, SMALL, false), ba = demoOrder(brush, SMALL, true)
  let difference = 0, pixels = 0
  ab.forEach((m, i) => { difference += Math.abs(m - ba[i]); if (project(m, 'tone') !== project(ba[i], 'tone')) pixels++ })
  return { ab, ba, difference, pixels }
}
