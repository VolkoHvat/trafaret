import { atlasSize, chart, type Hit, type Settings } from './surface-model'
import type { Size } from './field-size'

import { islandsFor, texelBounds } from './surface-body'

export class SurfaceZone {
  private cells: Uint8Array
  private atlas: Size
  constructor(atlas: Size = atlasSize) {
    islandsFor(atlas)
    this.atlas = { ...atlas }
    this.cells = new Uint8Array(atlas.width * atlas.height)
  }
  private selected = 0
  private version = 0

  get active() { return this.selected > 0 }
  get revision() { return this.version }

  readonly contains = (x: number, y: number): boolean => {
    if (!this.active) return true
    x = Math.round(x); y = Math.round(y)
    return x >= 0 && x < this.atlas.width && y >= 0 && y < this.atlas.height && this.cells[y * this.atlas.width + x] === 1
  }

  dab(hit: Hit, radius: number, settings: Settings): void {
    if (!Number.isFinite(radius) || radius < 0) throw new RangeError('surface zone radius')
    const c = texelBounds(chart(hit.part, settings, this.atlas)), cx = Math.round(hit.x), cy = Math.round(hit.y)
    const left = Math.max(c.left, Math.ceil(cx - radius)), right = Math.min(c.right, Math.floor(cx + radius))
    const top = Math.max(c.top, Math.ceil(cy - radius)), bottom = Math.min(c.bottom, Math.floor(cy + radius))
    const before = this.selected
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const i = y * this.atlas.width + x
      if (!this.cells[i] && (x-cx)**2 + (y-cy)**2 <= radius**2) {
        this.cells[i] = 1; this.selected++
      }
    }
    if (this.selected !== before) this.version++
  }

  clear(): void {
    if (!this.active) return
    this.cells.fill(0); this.selected = 0; this.version++
  }

  clone(): SurfaceZone {
    const copy = new SurfaceZone(this.atlas)
    copy.cells.set(this.cells); copy.selected = this.selected; copy.version = this.version
    return copy
  }
}
