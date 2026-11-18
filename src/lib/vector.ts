import { getStrokePathData, renderStroke, type StrokePoint } from './brushes'
import type { LayerModel, VectorObject } from '../types'
import { clipToSelection, selectionSvgPath } from './selection'

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export const vectorId = () => `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

// A fresh untouched layer (pixelVersion 0, no pixel data anywhere) renders as
// fully transparent, so compose/snapshot can skip materializing its backing
// store. Image layers always carry a source and are never considered empty.
export function isPristineEmptyLayer(layer: LayerModel): boolean {
  if (layer.pixelVersion !== 0) return false
  if (layer.kind === 'image') return false
  if (layer.kind === 'vector') return (layer.objects?.length ?? 0) === 0
  if (layer.source || layer.sourceImage) return false
  if (layer.dataCache?.data) return false
  return true
}
export const cloneObjects = (objects: VectorObject[] = []) => {
  const cloned = JSON.parse(JSON.stringify(objects)) as VectorObject[]
  cloned.forEach(ensureObjectOrigin)
  return cloned
}
export const defaultVectorTransform = () => ({ x: 0, y: 0, scale: 1, rotation: 0 })

export function baseObjectBounds(object: VectorObject): Bounds {
  if (!object.points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  const pad = object.kind === 'shape'
    ? object.brush.size / 2
    : Math.max(2, object.brush.size) + Math.max(object.brush.taperStart, object.brush.taperEnd)
  if (object.kind === 'shape' && object.shape === 'arc') {
    const [a, b] = object.points
    if (a && b) {
      const rx = Math.abs(b[0] - a[0]), ry = Math.abs(b[1] - a[1])
      return { minX: a[0] - rx - pad, minY: a[1] - ry - pad, maxX: a[0] + rx + pad, maxY: a[1] + ry + pad }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const point of object.points) {
    if (point[0] < minX) minX = point[0]
    if (point[1] < minY) minY = point[1]
    if (point[0] > maxX) maxX = point[0]
    if (point[1] > maxY) maxY = point[1]
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

export function objectOrigin(object: VectorObject) {
  if (object.origin) return object.origin
  const bounds = baseObjectBounds(object)
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
}

export function ensureObjectOrigin(object: VectorObject) {
  if (!object.origin) object.origin = objectOrigin(object)
  return object
}

function transformPoint(x: number, y: number, object: VectorObject, centerX: number, centerY: number): [number, number] {
  const angle = object.transform.rotation * Math.PI / 180
  const dx = (x - centerX) * object.transform.scale
  const dy = (y - centerY) * object.transform.scale
  return [
    centerX + object.transform.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    centerY + object.transform.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  ]
}

export function objectBounds(object: VectorObject): Bounds {
  const base = baseObjectBounds(object)
  const { x: cx, y: cy } = objectOrigin(object)
  const points = [
    transformPoint(base.minX, base.minY, object, cx, cy),
    transformPoint(base.maxX, base.minY, object, cx, cy),
    transformPoint(base.maxX, base.maxY, object, cx, cy),
    transformPoint(base.minX, base.maxY, object, cx, cy),
  ]
  return {
    minX: Math.min(...points.map(point => point[0])),
    minY: Math.min(...points.map(point => point[1])),
    maxX: Math.max(...points.map(point => point[0])),
    maxY: Math.max(...points.map(point => point[1])),
  }
}

function applyTransform(ctx: CanvasRenderingContext2D, object: VectorObject) {
  const { x: cx, y: cy } = objectOrigin(object)
  ctx.translate(cx + object.transform.x, cy + object.transform.y)
  ctx.rotate(object.transform.rotation * Math.PI / 180)
  ctx.scale(object.transform.scale, object.transform.scale)
  ctx.translate(-cx, -cy)
}

function shapePath(object: VectorObject) {
  const path = new Path2D()
  const [a, b] = object.points
  if (!a || !b) return path
  if (object.shape === 'rectangle') {
    path.rect(a[0], a[1], b[0] - a[0], b[1] - a[1])
  } else if (object.shape === 'ellipse') {
    path.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, Math.PI * 2)
  } else {
    const [start, end] = object.angles ?? [-90, 200]
    path.ellipse(a[0], a[1], Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 0, start * Math.PI / 180, end * Math.PI / 180)
  }
  return path
}

function linearPath(object: VectorObject) {
  const path = new Path2D()
  object.points.forEach((point, index) => {
    if (index === 0) path.moveTo(point[0], point[1])
    else path.lineTo(point[0], point[1])
  })
  if (object.closed) path.closePath()
  return path
}

export function renderVectorObject(ctx: CanvasRenderingContext2D, object: VectorObject) {
  ctx.save()
  for (const selection of object.clips ?? []) {
    clipToSelection(ctx, selection, ctx.canvas.width, ctx.canvas.height)
  }
  applyTransform(ctx, object)
  if (object.kind === 'stroke') {
    renderStroke(ctx, object.points, object.brush, object.color, true, object.pen)
  } else {
    const path = object.kind === 'shape' ? shapePath(object) : linearPath(object)
    ctx.globalAlpha = object.brush.opacity
    ctx.fillStyle = object.color
    ctx.strokeStyle = object.color
    ctx.lineWidth = object.brush.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (object.brush.id === 'dotwork') ctx.setLineDash([0.1, Math.max(3, object.brush.size * 2.2)])
    if (object.fill && (object.closed || object.kind === 'shape')) ctx.fill(path)
    else ctx.stroke(path)
  }
  ctx.restore()
}

export function renderVectorLayer(layer: LayerModel) {
  if (isPristineEmptyLayer(layer)) return
  const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  for (const object of layer.objects ?? []) renderVectorObject(ctx, object)
  layer.pixelVersion += 1
  layer.filterKey = undefined
}

export function hitVectorObject(objects: VectorObject[] = [], x: number, y: number, padding = 8) {
  return [...objects].reverse().find(object => {
    const bounds = objectBounds(object)
    return x >= bounds.minX - padding && x <= bounds.maxX + padding && y >= bounds.minY - padding && y <= bounds.maxY + padding
  })
}

function pointsToPath(points: StrokePoint[], closed = false) {
  return points.map((point, index) => `${index ? 'L' : 'M'}${point[0].toFixed(2)},${point[1].toFixed(2)}`).join(' ') + (closed ? ' Z' : '')
}

function shapeSvgPath(object: VectorObject) {
  const [a, b] = object.points
  if (object.shape === 'rectangle') return `M${a[0]},${a[1]} H${b[0]} V${b[1]} H${a[0]} Z`
  const samples: StrokePoint[] = []
  const isArc = object.shape === 'arc'
  const [start, end] = isArc ? object.angles ?? [-90, 200] : [0, 360]
  const cx = isArc ? a[0] : (a[0] + b[0]) / 2
  const cy = isArc ? a[1] : (a[1] + b[1]) / 2
  const rx = isArc ? Math.abs(b[0] - a[0]) : Math.abs(b[0] - a[0]) / 2
  const ry = isArc ? Math.abs(b[1] - a[1]) : Math.abs(b[1] - a[1]) / 2
  for (let i = 0; i <= 72; i++) {
    const angle = (start + (end - start) * i / 72) * Math.PI / 180
    samples.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, 0.5])
  }
  return pointsToPath(samples, !isArc)
}

function vectorClipId(object: VectorObject, index: number) {
  return `clip-${object.id.replace(/[^a-zA-Z0-9_-]/g, '-')}-${index}`
}

export function vectorObjectClipDefs(object: VectorObject, width: number, height: number) {
  return (object.clips ?? []).map((selection, index) => {
    const d = selectionSvgPath(selection, width, height)
    return `<clipPath id="${vectorClipId(object, index)}"><path d="${d}" clip-rule="evenodd"/></clipPath>`
  }).join('')
}

function wrapVectorClips(markup: string, object: VectorObject) {
  return (object.clips ?? []).reduce((content, _selection, index) => {
    return `<g clip-path="url(#${vectorClipId(object, index)})">${content}</g>`
  }, markup)
}

export function vectorObjectToSvg(object: VectorObject) {
  const { x: cx, y: cy } = objectOrigin(object)
  const transform = `translate(${(cx + object.transform.x).toFixed(2)} ${(cy + object.transform.y).toFixed(2)}) rotate(${object.transform.rotation.toFixed(2)}) scale(${object.transform.scale.toFixed(4)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`
  const opacity = object.brush.opacity
  let markup: string
  if (object.kind === 'stroke' && object.brush.id !== 'dotwork') {
    const d = getStrokePathData(object.points, object.brush, true, object.pen)
    markup = `<path d="${d}" fill="${object.color}" fill-opacity="${opacity}" transform="${transform}"/>`
  } else {
    const d = object.kind === 'shape' ? shapeSvgPath(object) : pointsToPath(object.points, object.closed)
    const fill = object.fill && (object.closed || object.kind === 'shape') ? object.color : 'none'
    const dash = object.brush.id === 'dotwork' ? ` stroke-dasharray="0.1 ${Math.max(3, object.brush.size * 2.2)}"` : ''
    markup = `<path d="${d}" fill="${fill}" stroke="${object.color}" stroke-opacity="${opacity}" stroke-width="${object.brush.size}" stroke-linecap="round" stroke-linejoin="round"${dash} transform="${transform}"/>`
  }
  return wrapVectorClips(markup, object)
}
