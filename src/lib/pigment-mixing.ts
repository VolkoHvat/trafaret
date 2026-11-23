/** Stylized paint on an abstract surface. Not a medical model of ink, skin or healing. */
export type RGB = readonly [number, number, number]
const palette = { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], blue: [0, 0, 255], yellow: [255, 255, 0] } as const
export type MixingColor = keyof typeof palette | RGB
export const MIX_CAPACITY = 65535
const Q = MIX_CAPACITY

// Per band, scattering + absorption = mass. Store only the independent quantities.
export type MixCell = Readonly<{ mass: number; scattering: RGB }>
export type MixDelta = Readonly<{ tile: number; offset: number; before: MixCell | null; after: MixCell | null }>
export type MixSnapshot = { version: 1; width: number; height: number; cells: [number, number, MixCell][] }
const integer = (n: number, max: number) => Number.isInteger(n) && n >= 0 && n <= max
function triple(f: (i: number) => number): RGB { return [f(0), f(1), f(2)] }
function checkRGB(value: RGB, max: number) {
  if (!Array.isArray(value) || value.length !== 3 || ![0, 1, 2].every(i => integer(value[i], max))) throw new RangeError('mix channels')
}
function cell(mass: number, scattering: RGB): MixCell {
  if (!integer(mass, Q) || !mass) throw new RangeError('mix mass')
  checkRGB(scattering, mass)
  return Object.freeze({ mass, scattering: Object.freeze(triple(i => scattering[i])) })
}
function linear(b: number) { const s = b / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
function srgb(s: number) { return Math.round(255 * (s <= 0.0031308 ? 12.92 * s : 1.055 * s ** (1 / 2.4) - 0.055)) }

/** Prepare once per brush; weight is normalized offered mass per impression. */
export function mixingBrush(color: MixingColor, weight: number) {
  const rgb = typeof color === 'string' ? palette[color] : color
  checkRGB(rgb, 255)
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError('mix weight')
  const offered = Math.round(Q * weight), reflectance = triple(i => linear(rgb[i]))
  return (before: MixCell | null) => {
    const old = before?.mass ?? 0
    // Incoming paint displaces the same fraction of the existing layer as its footprint.
    const displaced = Math.round(old * offered / Q), retained = old - displaced
    const after = !offered ? before : cell(retained + offered, triple(i =>
      (before ? Math.round(before.scattering[i] * retained / old) : 0) + Math.round(reflectance[i] * offered)))
    return { after, offered, displaced }
  }
}
export function mixingOptics(c: MixCell) {
  return { coverage: c.mass / Q, scattering: c.scattering, absorption: triple(i => c.mass - c.scattering[i]) }
}
export function projectMix(base: RGB, c: MixCell | null, mode: 'pigment' | 'stencil'): RGB {
  if (mode === 'stencil' || !c) return base
  return triple(i => srgb((linear(base[i]) * (Q - c.mass) + c.scattering[i]) / Q))
}

/** Host groups these local deltas into gestures; applying before in reverse order undoes one. */
export class MixingField {
  private readonly tiles = new Map<number, Map<number, MixCell>>()
  readonly width: number
  readonly height: number
  constructor(width: number, height: number) {
    if (![width, height].every(n => integer(n, 2048) && n > 0)) throw new RangeError('mix dimensions')
    this.width = width; this.height = height
  }
  private check(tile: number, offset: number) {
    const cols = Math.ceil(this.width / 32)
    if (!integer(tile, cols * Math.ceil(this.height / 32) - 1) || !integer(offset, 1023) ||
        tile % cols * 32 + offset % 32 >= this.width || Math.floor(tile / cols) * 32 + Math.floor(offset / 32) >= this.height) throw new RangeError('mix address')
  }
  get(tile: number, offset: number) { this.check(tile, offset); return this.tiles.get(tile)?.get(offset) ?? null }
  deposit(tile: number, offset: number, brush: ReturnType<typeof mixingBrush>): MixDelta {
    const before = this.get(tile, offset), { after } = brush(before)
    this.put(tile, offset, after)
    return { tile, offset, before, after }
  }
  private put(tile: number, offset: number, value: MixCell | null) {
    let cells = this.tiles.get(tile)
    if (value) {
      if (!cells) { cells = new Map(); this.tiles.set(tile, cells) }
      cells.set(offset, value)
    } else if (cells) { cells.delete(offset); if (!cells.size) this.tiles.delete(tile) }
  }
  apply(delta: MixDelta, side: 'before' | 'after') {
    this.check(delta.tile, delta.offset)
    const c = delta[side]
    this.put(delta.tile, delta.offset, c === null ? null : cell(c.mass, c.scattering))
  }
  snapshot(): MixSnapshot {
    const cells: MixSnapshot['cells'] = []
    for (const [tile, entries] of this.tiles) for (const [offset, c] of entries) cells.push([tile, offset, c])
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    return { version: 1, width: this.width, height: this.height, cells }
  }
  static restore(snapshot: MixSnapshot) {
    const f = new MixingField(snapshot.width, snapshot.height)
    if (snapshot.version !== 1 || !Array.isArray(snapshot.cells) || snapshot.cells.length > f.width * f.height) throw new RangeError('mix snapshot')
    for (const [tile, offset, c] of snapshot.cells) {
      if (f.get(tile, offset)) throw new RangeError('duplicate mix cell')
      f.put(tile, offset, cell(c.mass, c.scattering))
    }
    return f
  }
}
