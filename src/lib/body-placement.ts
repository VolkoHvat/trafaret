import { transformBounds } from './geometry'

// Width and height describe a schematic patch, not a measurement of a person.
export const bodyPresets = {
  back: { label: 'Спина', widthMm: 320, heightMm: 420, orientation: 'back', side: 'center' },
  chest: { label: 'Грудь', widthMm: 300, heightMm: 220, orientation: 'front', side: 'center' },
  shoulder: { label: 'Плечо', widthMm: 120, heightMm: 180, orientation: 'front', side: 'left' },
  forearm: { label: 'Предплечье', widthMm: 90, heightMm: 220, orientation: 'front', side: 'left' },
  hand: { label: 'Кисть', widthMm: 80, heightMm: 95, orientation: 'front', side: 'left' },
  thigh: { label: 'Бедро', widthMm: 180, heightMm: 320, orientation: 'front', side: 'left' },
  shin: { label: 'Голень', widthMm: 115, heightMm: 300, orientation: 'front', side: 'left' },
  neck: { label: 'Шея', widthMm: 95, heightMm: 80, orientation: 'back', side: 'center' },
  ribs: { label: 'Рёбра', widthMm: 150, heightMm: 250, orientation: 'front', side: 'left' },
} as const
export type BodyRegion = keyof typeof bodyPresets
export type Side = 'left' | 'right' | 'center'
export type Orientation = 'front' | 'back'
export interface BodyPlacement {
  version: 1
  bodyRegion: BodyRegion
  side: Side
  orientation: Orientation
  placement: { x: number; y: number } // Region-local center, from top left in the selected view.
  widthMm: number
  heightMm: number
  rotation: number // Clockwise degrees.
  wrap: 'flat' | 'contour-preview'
  safeMarginMm: number
}

export const bodyRegions = Object.keys(bodyPresets) as BodyRegion[]

export interface BodySilhouetteMarker {
  bodyRegion: BodyRegion
  side: Side
  x: number
  y: number
}

export interface BodySilhouette {
  version: 1
  orientation: Orientation
  viewBox: { width: 100; height: 220 }
  head: { cx: 50; cy: 18; r: 13 }
  outlinePath: string
  markers: BodySilhouetteMarker[]
}

const silhouetteSites: Record<BodyRegion, [number, number]> = {
  back: [50, 59], chest: [50, 59], neck: [50, 35], ribs: [60, 78],
  shoulder: [71, 49], forearm: [80, 82], hand: [86, 104], thigh: [61, 133], shin: [63, 181],
}
const silhouetteOutline = 'M44 29h12l2 9 17 5 14 55 2 12-9 3-14-50-2 36 4 105-11 3-9-94-9 94-11-3 4-105-2-36-14 50-9-3 2-12 14-55 17-5Z'

/** A schematic, metadata-free 2D guide. It is not a body model or printable geometry. */
export function bodySilhouette(orientation: Orientation = 'front'): BodySilhouette {
  choice(orientation, ['front', 'back'], 'orientation')
  const markers = bodyRegions.filter(region => !(region === 'back' && orientation === 'front' || region === 'chest' && orientation === 'back'))
    .flatMap(bodyRegion => {
      const [x, y] = silhouetteSites[bodyRegion]
      const sides: Side[] = x === 50 ? ['center'] : ['left', 'right']
      return sides.map(side => ({ bodyRegion, side, x: side === 'center' || (side === 'left') === (orientation === 'front') ? x : 100 - x, y }))
    })
  return { version: 1, orientation, viewBox: { width: 100, height: 220 }, head: { cx: 50, cy: 18, r: 13 }, outlinePath: silhouetteOutline, markers }
}

export function createBodyPlacement(bodyRegion: BodyRegion = 'back'): BodyPlacement {
  const p = bodyPresets[bodyRegion]
  return { version: 1, bodyRegion, orientation: p.orientation, side: p.side, placement: { x: 0.5, y: 0.5 },
    widthMm: p.widthMm / 2, heightMm: p.heightMm / 2, rotation: 0, wrap: 'flat', safeMarginMm: 5 }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидается объект размещения')
  return value as Record<string, unknown>
}
function numberIn(value: unknown, min: number, max: number, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Недопустимое значение: ${field}`)
  return value
}
function choice<T extends string>(value: unknown, options: readonly T[], field: string): T {
  const match = options.find(v => v === value)
  if (!match) throw new Error(`Недопустимое значение: ${field}`)
  return match
}

// Allowlist on both load and save: never carry paths, images or preview geometry into metadata.
export function parseBodyPlacement(input: unknown): BodyPlacement {
  const v = record(input)
  if (v.version !== 1) throw new Error('Неизвестная версия размещения')
  const bodyRegion = choice(v.bodyRegion, bodyRegions, 'bodyRegion')
  const p = record(v.placement), region = bodyPresets[bodyRegion]
  return { version: 1, bodyRegion, side: choice(v.side, ['left', 'right', 'center'], 'side'),
    orientation: choice(v.orientation, ['front', 'back'], 'orientation'),
    placement: { x: numberIn(p.x, 0, 1, 'x'), y: numberIn(p.y, 0, 1, 'y') },
    widthMm: numberIn(v.widthMm, 0.1, 2000, 'widthMm'), heightMm: numberIn(v.heightMm, 0.1, 2000, 'heightMm'),
    rotation: numberIn(v.rotation, -180, 180, 'rotation'), wrap: choice(v.wrap, ['flat', 'contour-preview'], 'wrap'),
    safeMarginMm: numberIn(v.safeMarginMm, 0, Math.min(region.widthMm, region.heightMm) / 2, 'safeMarginMm') }
}
export function serializeBodyPlacement(value: BodyPlacement) { return JSON.stringify(parseBodyPlacement(value)) }
export function deserializeBodyPlacement(json: string) { return parseBodyPlacement(JSON.parse(json)) }

export function bodyPlacementLayout(input: BodyPlacement) {
  const v = parseBodyPlacement(input), region = bodyPresets[v.bodyRegion]
  const center = { x: v.placement.x * region.widthMm, y: v.placement.y * region.heightMm }
  const bounds = transformBounds({ minX: center.x - v.widthMm / 2, maxX: center.x + v.widthMm / 2,
    minY: center.y - v.heightMm / 2, maxY: center.y + v.heightMm / 2 },
  { x: 0, y: 0, rotation: v.rotation, scale: 1 }, center)
  const clearance = Math.min(bounds.minX, bounds.minY, region.widthMm - bounds.maxX, region.heightMm - bounds.maxY)
  const warnings: ('crop' | 'safe-margin')[] = []
  if (clearance < -1e-9) warnings.push('crop')
  if (clearance < v.safeMarginMm - 1e-9) warnings.push('safe-margin')
  return { center, bounds, warnings }
}
