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
  return pointsBounds(object.points, pad)
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
  const local = localPoint(point, object)
  object.points[index] = [local[0], local[1], object.points[index][2]]
  return true
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

export function pointsToPath(points: readonly GeometryPoint[], closed = false): string {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ') + (closed ? ' Z' : '')
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
