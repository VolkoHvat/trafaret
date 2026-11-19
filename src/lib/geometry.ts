import type { VectorObject, VectorTransform } from '../types'

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Point { x: number; y: number }
export type GeometryPoint = readonly [number, number, ...number[]]

export const defaultVectorTransform = (): VectorTransform => ({ x: 0, y: 0, scale: 1, rotation: 0 })

export function pointsBounds(points: readonly GeometryPoint[], pad = 0): Bounds {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of points) {
    if (point[0] < minX) minX = point[0]
    if (point[1] < minY) minY = point[1]
    if (point[0] > maxX) maxX = point[0]
    if (point[1] > maxY) maxY = point[1]
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

export function boundsCenter(bounds: Bounds): Point {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

export function transformPoint(x: number, y: number, transform: VectorTransform, origin: Point): [number, number] {
  const angle = transform.rotation * Math.PI / 180
  const dx = (x - origin.x) * transform.scale
  const dy = (y - origin.y) * transform.scale
  return [
    origin.x + transform.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    origin.y + transform.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  ]
}

export function inverseTransformPoint(x: number, y: number, transform: VectorTransform, origin: Point): [number, number] {
  const angle = -transform.rotation * Math.PI / 180
  const dx = x - origin.x - transform.x, dy = y - origin.y - transform.y
  return [
    origin.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) / transform.scale,
    origin.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) / transform.scale,
  ]
}

export function transformBounds(bounds: Bounds, transform: VectorTransform, origin: Point): Bounds {
  const points = [
    transformPoint(bounds.minX, bounds.minY, transform, origin),
    transformPoint(bounds.maxX, bounds.minY, transform, origin),
    transformPoint(bounds.maxX, bounds.maxY, transform, origin),
    transformPoint(bounds.minX, bounds.maxY, transform, origin),
  ]
  return pointsBounds(points)
}

export function controlHandlePoints(object: { handles?: VectorObject['handles'] }): [number, number][] {
  return Object.values(object.handles ?? {}).flatMap(handles => [handles.in, handles.out].filter(Boolean) as [number, number][])
}

export function baseObjectBounds(object: VectorObject): Bounds {
  const pad = object.kind === 'shape'
    ? object.brush.size / 2
    : Math.max(2, object.brush.size) + Math.max(object.brush.taperStart, object.brush.taperEnd)
  if (object.kind === 'shape' && object.shape === 'arc') {
    const [a, b] = object.points
    if (a && b) {
      const { cx, cy, rx, ry } = ellipseGeometry(a, b, true, object.angles)
      return { minX: cx - rx - pad, minY: cy - ry - pad, maxX: cx + rx + pad, maxY: cy + ry + pad }
    }
  }
  return pointsBounds([...object.points, ...controlHandlePoints(object)], pad)
}

export function objectOrigin(object: VectorObject): Point {
  return object.origin ?? boundsCenter(baseObjectBounds(object))
}

export function ensureObjectOrigin(object: VectorObject) {
  if (!object.origin) object.origin = objectOrigin(object)
  return object
}

export function objectBounds(object: VectorObject): Bounds {
  return transformBounds(baseObjectBounds(object), object.transform, objectOrigin(object))
}

export function worldPoint(point: VectorObject['points'][number], object: VectorObject): VectorObject['points'][number] {
  const [x, y] = transformPoint(point[0], point[1], object.transform, objectOrigin(object))
  return [x, y, point[2]]
}

export function localPoint(point: VectorObject['points'][number], object: VectorObject): VectorObject['points'][number] {
  const [x, y] = inverseTransformPoint(point[0], point[1], object.transform, objectOrigin(object))
  return [x, y, point[2]]
}

export function supportsControlPoints(object: VectorObject): boolean {
  return object.kind === 'path' || object.kind === 'stroke'
}

export function moveControlPoint(object: VectorObject, index: number, point: VectorObject['points'][number]): boolean {
  if (!supportsControlPoints(object) || !object.points[index]) return false
  const previous = object.points[index]
  const local = localPoint(point, object)
  object.points[index] = [local[0], local[1], previous[2]]
  const handles = object.handles?.[index]
  if (handles) {
    const dx = local[0] - previous[0], dy = local[1] - previous[1]
    if (handles.in) handles.in = [handles.in[0] + dx, handles.in[1] + dy]
    if (handles.out) handles.out = [handles.out[0] + dx, handles.out[1] + dy]
  }
  return true
}

export function moveControlHandle(object: VectorObject, index: number, side: 'in' | 'out', point: VectorObject['points'][number]): boolean {
  if (object.kind !== 'path' || !object.points[index]) return false
  const local = localPoint(point, object)
  object.handles ??= {}
  object.handles[index] ??= {}
  object.handles[index][side] = [local[0], local[1]]
  return true
}

export function nearestControlHandle(object: VectorObject, point: VectorObject['points'][number], tolerance: number): { index: number; side: 'in' | 'out' } | undefined {
  if (object.kind !== 'path') return undefined
  let nearest = tolerance
  let result: { index: number; side: 'in' | 'out' } | undefined
  for (const [key, handles] of Object.entries(object.handles ?? {})) {
    const index = Number(key)
    for (const side of ['in', 'out'] as const) {
      const handle = handles[side]
      if (!handle) continue
      const world = worldPoint([handle[0], handle[1], 0], object)
      const distance = Math.hypot(point[0] - world[0], point[1] - world[1])
      if (distance <= nearest) {
        nearest = distance
        result = { index, side }
      }
    }
  }
  return result
}

export function nearestControlPoint(object: VectorObject, point: VectorObject['points'][number], tolerance: number): number | undefined {
  if (!supportsControlPoints(object)) return undefined
  let nearest = tolerance
  let index: number | undefined
  object.points.forEach((candidate, candidateIndex) => {
    const world = worldPoint(candidate, object)
    const distance = Math.hypot(point[0] - world[0], point[1] - world[1])
    if (distance <= nearest) {
      nearest = distance
      index = candidateIndex
    }
  })
  return index
}

function segmentProjection(a: GeometryPoint, b: GeometryPoint, point: GeometryPoint) {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0
  const x = a[0] + dx * t, y = a[1] + dy * t
  return { t, x, y, distance: Math.hypot(point[0] - x, point[1] - y) }
}

function splitCubic(a: GeometryPoint, out: GeometryPoint, incoming: GeometryPoint, b: GeometryPoint, t: number) {
  const mix = (p: GeometryPoint, q: GeometryPoint): [number, number] => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]
  const aOut = mix(a, out), outIn = mix(out, incoming), inB = mix(incoming, b)
  const leftIn = mix(aOut, outIn), rightOut = mix(outIn, inB)
  return { aOut, leftIn, rightOut, inB }
}

export function insertControlPoint(object: VectorObject, point: VectorObject['points'][number], tolerance: number): number | undefined {
  if (object.kind !== 'path' || object.points.length < 2) return undefined
  const local = localPoint(point, object)
  let nearest: { index: number; t: number; x: number; y: number; distance: number } | undefined
  for (const [a, b, index] of pathSegments(object)) {
    const projection = segmentProjection(a, b, local)
    if (!nearest || projection.distance < nearest.distance) nearest = { index, ...projection }
  }
  if (!nearest || nearest.distance > tolerance / Math.abs(object.transform.scale)) return undefined
  const index = nearest.index
  const nextIndex = index + 1
  const oldHandles = object.handles ?? {}
  const out = oldHandles[index]?.out
  const incoming = oldHandles[nextIndex]?.in
  const a = object.points[index], b = object.points[nextIndex]
  const remapped: VectorObject['handles'] = {}
  for (const [key, handles] of Object.entries(oldHandles)) {
    const oldIndex = Number(key)
    if (oldIndex < index) remapped[oldIndex] = handles
    else if (oldIndex > nextIndex) remapped[oldIndex + 1] = handles
  }
  if (out || incoming) {
    const split = splitCubic(a, out ?? a, incoming ?? b, b, nearest.t)
    remapped[index] = { ...remapped[index], out: split.aOut }
    remapped[nextIndex] = { ...remapped[nextIndex], in: split.leftIn, out: split.rightOut }
    remapped[nextIndex + 1] = { ...remapped[nextIndex + 1], in: split.inB }
  }
  const oldWidths = object.widthProfile ?? {}
  const widths: Record<number, number> = {}
  for (const [key, width] of Object.entries(oldWidths)) {
    const oldIndex = Number(key)
    widths[oldIndex > index ? oldIndex + 1 : oldIndex] = width
  }
  if (Object.keys(oldWidths).length) widths[nextIndex] = ((oldWidths[index] ?? 1) + (oldWidths[nextIndex] ?? 1)) / 2
  object.points.splice(nextIndex, 0, [nearest.x, nearest.y, a[2] + (b[2] - a[2]) * nearest.t])
  object.handles = remapped
  object.widthProfile = widths
  return nextIndex
}

export function removeControlPoint(object: VectorObject, index: number): boolean {
  const minimum = object.closed ? 3 : 2
  if (object.kind !== 'path' || object.points.length <= minimum || !object.points[index]) return false
  object.points.splice(index, 1)
  const remapped: VectorObject['handles'] = {}
  for (const [key, handles] of Object.entries(object.handles ?? {})) {
    const oldIndex = Number(key)
    if (oldIndex < index) remapped[oldIndex] = handles
    else if (oldIndex > index) remapped[oldIndex - 1] = handles
  }
  object.handles = remapped
  object.widthProfile = Object.fromEntries(Object.entries(object.widthProfile ?? {})
    .filter(([key]) => Number(key) !== index)
    .map(([key, width]) => [Number(key) > index ? Number(key) - 1 : Number(key), width]))
  return true
}

function perpendicularDistance(point: GeometryPoint, start: GeometryPoint, end: GeometryPoint) {
  const dx = end[0] - start[0], dy = end[1] - start[1]
  const length = Math.hypot(dx, dy)
  return length ? Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / length
    : Math.hypot(point[0] - start[0], point[1] - start[1])
}

export function simplifyVectorPath(object: VectorObject, epsilon: number): { before: number; after: number } {
  if (!supportsControlPoints(object) || object.points.length < 3 || !(epsilon > 0)) {
    return { before: object.points.length, after: object.points.length }
  }
  const source = object.points
  const keep = new Uint8Array(source.length)
  keep[0] = 1
  keep[source.length - 1] = 1
  const stack: [number, number][] = [[0, source.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()!
    let farthest = -1, maxDistance = epsilon
    for (let index = start + 1; index < end; index++) {
      const distance = perpendicularDistance(source[index], source[start], source[end])
      if (distance > maxDistance) { farthest = index; maxDistance = distance }
    }
    if (farthest >= 0) {
      keep[farthest] = 1
      stack.push([start, farthest], [farthest, end])
    }
  }
  const indices = source.map((_, index) => index).filter(index => keep[index])
  const handles: VectorObject['handles'] = {}
  const widths: Record<number, number> = {}
  indices.forEach((oldIndex, newIndex) => {
    if (object.handles?.[oldIndex]) handles[newIndex] = object.handles[oldIndex]
    if (object.widthProfile?.[oldIndex] !== undefined) widths[newIndex] = object.widthProfile[oldIndex]
  })
  object.points = indices.map(index => [...source[index]] as VectorObject['points'][number])
  object.handles = handles
  object.widthProfile = widths
  return { before: source.length, after: object.points.length }
}

export function adjustWidthProfile(object: VectorObject, index: number, delta: number): number | undefined {
  if (!supportsControlPoints(object) || !object.points[index]) return undefined
  const current = object.widthProfile?.[index] ?? 1
  const value = Math.round(Math.max(0.1, Math.min(4, current + delta)) * 100) / 100
  object.widthProfile ??= {}
  object.widthProfile[index] = value
  return value
}

export function unionBounds(items: Bounds[]): Bounds {
  return {
    minX: Math.min(...items.map(item => item.minX)),
    minY: Math.min(...items.map(item => item.minY)),
    maxX: Math.max(...items.map(item => item.maxX)),
    maxY: Math.max(...items.map(item => item.maxY)),
  }
}

export function transformVectorGroup(
  objects: VectorObject[],
  original: Record<string, VectorTransform>,
  center: Point,
  mode: 'move' | 'scale' | 'rotate',
  value: { x: number; y: number } | number,
) {
  for (const object of objects) {
    const transform = original[object.id]
    if (!transform) continue
    const origin = objectOrigin(object)
    const x = origin.x + transform.x, y = origin.y + transform.y
    if (mode === 'move' && typeof value === 'object') {
      object.transform.x = transform.x + value.x
      object.transform.y = transform.y + value.y
    } else if (mode === 'scale' && typeof value === 'number') {
      object.transform.x = center.x + (x - center.x) * value - origin.x
      object.transform.y = center.y + (y - center.y) * value - origin.y
      object.transform.scale = transform.scale * value
    } else if (mode === 'rotate' && typeof value === 'number') {
      const angle = value * Math.PI / 180
      const dx = x - center.x, dy = y - center.y
      object.transform.x = center.x + dx * Math.cos(angle) - dy * Math.sin(angle) - origin.x
      object.transform.y = center.y + dx * Math.sin(angle) + dy * Math.cos(angle) - origin.y
      object.transform.rotation = transform.rotation + value
    }
  }
}

export function applyObjectTransform(ctx: CanvasRenderingContext2D, object: VectorObject) {
  const { x: cx, y: cy } = objectOrigin(object)
  ctx.translate(cx + object.transform.x, cy + object.transform.y)
  ctx.rotate(object.transform.rotation * Math.PI / 180)
  ctx.scale(object.transform.scale, object.transform.scale)
  ctx.translate(-cx, -cy)
}

export function objectSvgTransform(object: VectorObject): string {
  const { x: cx, y: cy } = objectOrigin(object)
  return `translate(${(cx + object.transform.x).toFixed(2)} ${(cy + object.transform.y).toFixed(2)}) rotate(${object.transform.rotation.toFixed(2)}) scale(${object.transform.scale.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`
}

export function ellipseGeometry(
  a: GeometryPoint,
  b: GeometryPoint,
  isArc: boolean,
  angles?: [number, number],
) {
  const [start, end] = isArc ? angles ?? [-90, 200] : [0, 360]
  return {
    cx: isArc ? a[0] : (a[0] + b[0]) / 2,
    cy: isArc ? a[1] : (a[1] + b[1]) / 2,
    rx: Math.abs(b[0] - a[0]) / (isArc ? 1 : 2),
    ry: Math.abs(b[1] - a[1]) / (isArc ? 1 : 2),
    start,
    end,
  }
}

export function shapePath(object: VectorObject): Path2D {
  const path = new Path2D()
  const [a, b] = object.points
  if (!a || !b) return path
  if (object.shape === 'rectangle') {
    path.rect(a[0], a[1], b[0] - a[0], b[1] - a[1])
  } else {
    const { cx, cy, rx, ry, start, end } = ellipseGeometry(a, b, object.shape === 'arc', object.angles)
    path.ellipse(cx, cy, rx, ry, 0, start * Math.PI / 180, end * Math.PI / 180)
  }
  return path
}

function pathSegments(object: VectorObject) {
  const points = object.points
  const segments: [VectorObject['points'][number], VectorObject['points'][number], number][] = []
  for (let index = 0; index + 1 < points.length; index++) segments.push([points[index], points[index + 1], index])
  if (object.closed && points.length > 2) segments.push([points[points.length - 1], points[0], points.length - 1])
  return segments
}

export function vectorPath(object: VectorObject, segmentIndex?: number): Path2D {
  const path = new Path2D()
  const start = segmentIndex === undefined ? object.points[0] : object.points[segmentIndex]
  if (!start) return path
  path.moveTo(start[0], start[1])
  const segments = segmentIndex === undefined ? pathSegments(object) : pathSegments(object).filter(([, , index]) => index === segmentIndex)
  for (const [a, b, index] of segments) {
    const nextIndex = index + 1 === object.points.length ? 0 : index + 1
    const out = object.handles?.[index]?.out
    const incoming = object.handles?.[nextIndex]?.in
    if (out || incoming) {
      const c1 = out ?? a, c2 = incoming ?? b
      path.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1])
    } else path.lineTo(b[0], b[1])
  }
  if (object.closed) path.closePath()
  return path
}

export function pointsToPath(points: readonly GeometryPoint[], closed = false): string {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ') + (closed ? ' Z' : '')
}

export function vectorSvgPath(object: VectorObject, segmentIndex?: number): string {
  if (segmentIndex === undefined && !Object.keys(object.handles ?? {}).length) return pointsToPath(object.points, object.closed)
  const start = segmentIndex === undefined ? object.points[0] : object.points[segmentIndex]
  if (!start) return ''
  let d = `M${start[0].toFixed(2)},${start[1].toFixed(2)}`
  const segments = segmentIndex === undefined ? pathSegments(object) : pathSegments(object).filter(([, , index]) => index === segmentIndex)
  for (const [a, b, index] of segments) {
    const nextIndex = index + 1 === object.points.length ? 0 : index + 1
    const out = object.handles?.[index]?.out
    const incoming = object.handles?.[nextIndex]?.in
    if (out || incoming) {
      const c1 = out ?? a, c2 = incoming ?? b
      d += ` C${c1[0].toFixed(2)},${c1[1].toFixed(2)} ${c2[0].toFixed(2)},${c2[1].toFixed(2)} ${b[0].toFixed(2)},${b[1].toFixed(2)}`
    } else d += ` L${b[0].toFixed(2)},${b[1].toFixed(2)}`
  }
  return d + (object.closed && segmentIndex === undefined ? ' Z' : '')
}

export function shapeSvgPath(object: VectorObject): string {
  const [a, b] = object.points
  if (object.shape === 'rectangle') return `M${a[0]},${a[1]} H${b[0]} V${b[1]} H${a[0]} Z`
  const isArc = object.shape === 'arc'
  const { cx, cy, rx, ry, start, end } = ellipseGeometry(a, b, isArc, object.angles)
  const samples: [number, number][] = []
  for (let i = 0; i <= 72; i++) {
    const angle = (start + (end - start) * i / 72) * Math.PI / 180
    samples.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry])
  }
  return pointsToPath(samples, !isArc)
}
