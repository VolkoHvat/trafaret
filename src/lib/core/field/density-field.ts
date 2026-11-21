export interface FieldPoint { x: number; y: number }
/** Half-open world-space extent of changed cells. */
export interface FieldBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface FieldBrush {
  radius: number
  strength: number // central depletion per step, 0..1
  compression: number // peak surrounding ridge, 0..1
  bufferWidth: number
}
export interface FieldCell extends FieldPoint { density: number }
export interface FieldCellChange extends FieldPoint { before: number; after: number }
export interface FieldDelta { changes: readonly FieldCellChange[]; bounds: FieldBounds | null }
export interface FieldSnapshot { cellSize: number; cells: readonly FieldCell[] }

const maxVisits = 65536
const maxStored = 262144

const key = (x: number, y: number) => `${x},${y}`
const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1
const gridCoordinate = (n: number) => Number.isFinite(n) && Math.abs(n) <= 2 ** 30

export class DensityField {
  readonly cellSize: number
  private cells = new Map<string, FieldCell>()

  constructor(cellSize = 1) {
    if (!Number.isFinite(cellSize) || cellSize < 1e-9 || cellSize > 1e9) throw new RangeError('Invalid cell size')
    this.cellSize = cellSize
  }

  density({ x, y }: FieldPoint) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Invalid point')
    return this.cells.get(key(Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)))?.density ?? 1
  }

  private commit(changes: FieldCellChange[]): FieldDelta {
    let size = this.cells.size
    for (const { before, after } of changes) size += Number(before === 1) - Number(after === 1)
    if (size > maxStored) throw new RangeError('Field cell budget exceeded')
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { x, y, after } of changes) {
      if (after === 1) this.cells.delete(key(x, y))
      else this.cells.set(key(x, y), { x, y, density: after })
      minX = Math.min(minX, x); minY = Math.min(minY, y)
      maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1)
    }
    const s = this.cellSize
    return { changes, bounds: changes.length ? { minX: minX * s, minY: minY * s, maxX: maxX * s, maxY: maxY * s } : null }
  }

  /** One swept dab: each cell is sampled at its centre once, including for point segments. */
  stepSegment(start: FieldPoint, end: FieldPoint, brush: FieldBrush): FieldDelta {
    const s = this.cellSize
    const ax = start.x / s, ay = start.y / s, bx = end.x / s, by = end.y / s
    const radius = brush.radius / s, width = brush.bufferWidth / s
    const { strength, compression } = brush
    if (![ax, ay, bx, by].every(gridCoordinate) || !(radius > 0) || !(width >= 0)
      || !Number.isFinite(radius + width) || !unit(strength) || !unit(compression)) throw new RangeError('Invalid segment or brush')
    const reach = radius + (compression ? width : 0)
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
    const horizontal = Math.abs(dx) >= Math.abs(dy)
    const [u, v, du, dv] = horizontal ? [ax, ay, dx, dy] : [ay, ax, dy, dx]
    // Along the dominant axis |slope| <= 1, so a strip of +/-2R contains the entire capsule.
    const lo = Math.ceil(Math.min(u, u + du) - reach - 0.5)
    const hi = Math.floor(Math.max(u, u + du) + reach - 0.5)
    if (reach > maxVisits || (hi - lo + 1) * (Math.ceil(4 * reach) + 1) > maxVisits) throw new RangeError('Segment work budget exceeded')
    const changes: FieldCellChange[] = []
    for (let i = lo; i <= hi; i++) {
      const t = du ? Math.max(0, Math.min(1, (i + 0.5 - u) / du)) : 0
      const mid = v + dv * t
      for (let j = Math.ceil(mid - 2 * reach - 0.5); j <= mid + 2 * reach - 0.5; j++) {
        const x = horizontal ? i : j, y = horizontal ? j : i
        const px = x + 0.5 - ax, py = y + 0.5 - ay
        const h = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0
        const d = Math.sqrt((px - h * dx) ** 2 + (py - h * dy) ** 2)
        if (d >= reach) continue
        const before = this.cells.get(key(x, y))?.density ?? 1
        const ring = width ? (d - radius) / width : 0
        const effect = d < radius ? -Math.pow(1 - Math.pow(d / radius, 2), 2) : compression * 4 * ring * (1 - ring)
        const after = Math.max(0, before + (d < radius ? strength * effect : effect))
        if (after !== before) changes.push({ x, y, before, after })
      }
    }
    return this.commit(changes)
  }

  /** Explicit relaxation of active cells only; no clock or historical source list. */
  refill(deltaTime: number, rate: number): FieldDelta {
    if (!Number.isFinite(deltaTime) || deltaTime < 0 || !Number.isFinite(rate) || rate < 0) throw new RangeError('Invalid refill')
    const factor = Math.exp(-rate * deltaTime)
    const changes: FieldCellChange[] = []
    if (factor !== 1) for (const { x, y, density: before } of this.cells.values()) {
      const deviation = (before - 1) * factor
      const after = Math.abs(deviation) <= 1e-12 ? 1 : 1 + deviation
      if (after !== before) changes.push({ x, y, before, after })
    }
    return this.commit(changes)
  }

  snapshot(): FieldSnapshot {
    const cells = Array.from(this.cells.values(), cell => ({ ...cell })).sort((a, b) => a.y - b.y || a.x - b.x)
    return { cellSize: this.cellSize, cells }
  }

  restore(snapshot: FieldSnapshot) {
    if (snapshot.cellSize !== this.cellSize || snapshot.cells.length > maxStored) throw new RangeError('Incompatible snapshot')
    const next = new Map<string, FieldCell>()
    for (const { x, y, density } of snapshot.cells) {
      if (![x, y].every(Number.isSafeInteger) || Math.max(Math.abs(x), Math.abs(y)) > 2 ** 30 + maxVisits + 1
        || !Number.isFinite(density) || density < 0 || density === 1 || next.has(key(x, y))) throw new RangeError('Invalid snapshot cell')
      next.set(key(x, y), { x, y, density })
    }
    this.cells = next
  }
}
