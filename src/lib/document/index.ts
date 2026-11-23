import type { MigrationResult, TrafaretDocumentV2 } from './contract'
export type * from './contract'

type RecordValue = Record<string, unknown>
type Reader<T> = (value: unknown, path: string) => T
function fail(path: string, reason: string): never { throw new Error(`${path}: ${reason}`) }
function record(value: unknown, path: string): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object')
  return value as RecordValue
}
const text: Reader<string> = (v, p) => typeof v === 'string' ? v : fail(p, 'expected string')
const id: Reader<string> = (v, p) => text(v, p).trim() ? String(v) : fail(p, 'empty id')
const bool: Reader<boolean> = (v, p) => typeof v === 'boolean' ? v : fail(p, 'expected boolean')
const num: Reader<number> = (v, p) => typeof v === 'number' && Number.isFinite(v) ? v : fail(p, 'expected finite number')
const bounded = (min: number, max = Infinity, integer = false): Reader<number> => (v, p) => {
  const n = num(v, p)
  return n >= min && n <= max && (!integer || Number.isSafeInteger(n)) ? n : fail(p, 'out of range')
}
const unit = bounded(0, 1), positiveInt = bounded(1, Infinity, true)
const choice = <const T extends readonly string[]>(...items: T): Reader<T[number]> => (v, p) =>
  typeof v === 'string' && items.includes(v) ? v : fail(p, `expected ${items.join('/')}`)
const opt = <T>(read: Reader<T>): Reader<T | undefined> => (v, p) => v === undefined ? undefined : read(v, p)
const list = <T>(read: Reader<T>): Reader<T[]> => (v, p) => Array.isArray(v)
  ? Array.from(v, (item, i) => read(item, `${p}[${i}]`)) : fail(p, 'expected array')
function fields<S extends Record<string, Reader<unknown>>>(schema: S): Reader<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (v, p) => {
    const obj = record(v, p)
    const pairs = Object.entries(schema).map(([k, read]) => [k, read(obj[k], `${p}.${k}`)])
    return Object.fromEntries(pairs.filter(([, val]) => val !== undefined)) as { [K in keyof S]: ReturnType<S[K]> }
  }
}
const pair: Reader<[number, number]> = (v, p) => Array.isArray(v) && v.length === 2 ? [num(v[0], p), num(v[1], p)] : fail(p, 'expected coordinate pair')
const indexed = <T>(read: Reader<T>): Reader<Record<string, T>> => (v, p) => Object.fromEntries(Object.entries(record(v, p)).map(([k, item]) => {
  if (!/^(0|[1-9]\d*)$/.test(k)) fail(p, 'expected point index')
  return [k, read(item, `${p}.${k}`)]
}))
const brush = fields({ id, name: text, family: text, size: bounded(0), opacity: unit, thinning: num, streamline: unit, smoothing: unit,
  taperStart: bounded(0), taperEnd: bounded(0), pressureCurve: choice('soft','linear','firm'), passes: positiveInt, jitter: bounded(0),
  strokeMode: opt(choice('outline','dotwork')), distributeOpacity: opt(bool), blurScale: opt(bounded(0)) })
const energy = fields({ source: choice('fixed','measured-pressure','velocity-only'), confidence: choice('fixed','measured','modelled'), energy: bounded(0), power: bounded(0), speed: bounded(0) })
const clip = fields({ kind: choice('rectangle','ellipse','lasso'), points: list(pair), inverse: opt(bool) })
const pointFields = fields({ x: num, y: num, pressure: unit, time: opt(num) })
const committedPoint: typeof pointFields = (v, p) => {
  const point = record(v, p)
  if (point.predicted === true || point.isPredicted === true || point.source === 'prediction') fail(p, 'expected committed sample')
  return pointFields(point, p)
}
const stroke = fields({ id, kind: choice('stroke','shape','path'), points: list(committedPoint), brush,
  energy: opt(energy), color: text, pen: bool, eraser: opt(bool), shape: opt(choice('rectangle','ellipse','arc')), closed: opt(bool), fill: opt(bool),
  angles: opt(pair), origin: opt(fields({ x: num, y: num })), handles: opt(indexed(fields({ in: opt(pair), out: opt(pair) }))),
  clips: opt(list(clip)), widthProfile: opt(indexed(num)), transform: fields({ x: num, y: num, rotation: num, scale: num }) })
const layer = fields({ id, name: text, kind: choice('paint','image','vector'), visible: bool, locked: bool, opacity: unit, blend: text, data: text,
  source: opt(text), transform: opt(fields({ scale: num, rotation: num, x: opt(num), y: opt(num) })),
  filters: opt(fields({ grayscale: bool, contrast: num, threshold: num, invert: bool })), strokes: list(stroke),
  mask: opt(fields({ data: text, enabled: bool })), clipToBelow: bool })
const body = fields({ projectId: opt(id), savedAt: opt(text), revision: bounded(0, Infinity, true),
  doc: fields({ width: positiveInt, height: positiveInt, title: text, dpi: positiveInt }), layers: list(layer), activeLayerId: id })

// Decoding projects only schema fields; preview buffers and runtime caches have no wire representation.
function decode(input: unknown): TrafaretDocumentV2 {
  const s = record(input, '$')
  if (s.format !== 'trafaret-document' || s.version !== 2) fail('$', 'unsupported document format/version')
  const doc = body(s, '$')
  const ids = new Set<string>()
  for (const l of doc.layers) {
    if (ids.has(l.id)) fail('layers', `duplicate id ${l.id}`)
    ids.add(l.id)
    const strokes = new Set<string>()
    for (const s of l.strokes) {
      if (strokes.has(s.id) || !s.points.length) fail(l.id, `duplicate or empty stroke ${s.id}`)
      strokes.add(s.id)
    }
  }
  if (!ids.has(doc.activeLayerId)) throw new Error('activeLayerId must reference a layer')
  return { format: 'trafaret-document', version: 2, ...doc }
}

function readMask(layer: RecordValue, path: string) {
  const nested = layer.mask
  if (nested !== undefined) {
    const mask = record(nested, `${path}.mask`)
    return { data: text(mask.data, `${path}.mask.data`), enabled: mask.enabled === undefined ? true : bool(mask.enabled, `${path}.mask.enabled`) }
  }
  if (layer.maskData === undefined) return undefined
  return { data: text(layer.maskData, `${path}.maskData`), enabled: layer.maskEnabled === undefined ? true : bool(layer.maskEnabled, `${path}.maskEnabled`) }
}

function legacyStroke(value: unknown, path: string) {
  const s = record(value, path)
  const points = list((v, p) => {
    if (!Array.isArray(v) || v.length !== 3) fail(p, 'expected [x,y,pressure]')
    return { x: v[0], y: v[1], pressure: v[2] }
  })(s.points, `${path}.points`)
  return { ...s, points }
}

export function migrateToV2(input: unknown): MigrationResult {
  const s = record(input, '$')
  if (s.format === 'trafaret-document') return { document: decode(s), migrated: false, sourceVersion: 2 }
  if (s.format !== 'trafaret-project' || (s.version !== 1 && s.version !== 2)) fail('$', 'unsupported project format/version')
  const layers = list((value, path) => {
    const l = record(value, path)
    return { kind: 'paint', name: 'Слой', visible: true, locked: false, opacity: 1, data: '', blend: 'source-over', clipToBelow: false, ...l,
      mask: readMask(l, path),
      strokes: list(legacyStroke)(l.objects ?? [], `${path}.objects`) }
  })(s.layers, '$.layers')
  return { document: decode({ ...s, format: 'trafaret-document', version: 2, revision: s.revision ?? 0, layers }), migrated: true, sourceVersion: s.version }
}

export function validateV2(value: unknown): string[] {
  try { decode(value); return [] } catch (error) { return [String(error instanceof Error ? error.message : error)] }
}

export function serializeV2(document: TrafaretDocumentV2): string {
  return JSON.stringify(decode(document), (_, v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v)
}

export function parseV2(serialized: string): TrafaretDocumentV2 { return decode(JSON.parse(serialized)) }
