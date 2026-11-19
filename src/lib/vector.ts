import { brushRendering, getStrokePathData, renderStroke, widthAt } from './brushes'
import type { LayerModel, VectorObject } from '../types'
import { clipToSelection, selectionSvgPath } from './selection'
import {
  applyObjectTransform, ensureObjectOrigin, objectBounds, objectSvgTransform,
  shapePath, shapeSvgPath, vectorPath, vectorSvgPath,
} from './geometry'

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

export function duplicateVectorObjects(
  objects: VectorObject[],
  selectedIds: string[],
  offset = 20,
  idFactory: () => string = vectorId,
): VectorObject[] {
  const selected = new Set(selectedIds)
  return objects.filter(object => selected.has(object.id)).map(object => {
    const copy = cloneObjects([object])[0]
    copy.id = idFactory()
    copy.transform.x += offset
    copy.transform.y += offset
    return copy
  })
}

function linearPath(object: VectorObject) {
  return vectorPath(object)
}

export function renderVectorObject(ctx: CanvasRenderingContext2D, object: VectorObject) {
  ctx.save()
  for (const selection of object.clips ?? []) {
    clipToSelection(ctx, selection, ctx.canvas.width, ctx.canvas.height)
  }
  applyObjectTransform(ctx, object)
  if (object.kind === 'stroke') {
    renderStroke(ctx, object.points, object.brush, object.color, true, object.pen, false, object.widthProfile)
  } else {
    const path = object.kind === 'shape' ? shapePath(object) : linearPath(object)
    ctx.globalAlpha = object.brush.opacity
    ctx.fillStyle = object.color
    ctx.strokeStyle = object.color
    ctx.lineWidth = object.brush.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (brushRendering(object.brush).dotwork) ctx.setLineDash([0.1, Math.max(3, object.brush.size * 2.2)])
    if (object.fill && (object.closed || object.kind === 'shape')) ctx.fill(path)
    else if (object.kind === 'path' && Object.keys(object.widthProfile ?? {}).length) {
      const count = object.closed ? object.points.length : object.points.length - 1
      for (let index = 0; index < count; index++) {
        const nextIndex = index + 1 === object.points.length ? 0 : index + 1
        ctx.lineWidth = object.brush.size * (widthAt(object.widthProfile, index) + widthAt(object.widthProfile, nextIndex)) / 2
        ctx.stroke(vectorPath(object, index))
      }
    } else ctx.stroke(path)
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
  const transform = objectSvgTransform(object)
  const opacity = object.brush.opacity
  let markup: string
  if (object.kind === 'stroke' && !brushRendering(object.brush).dotwork) {
    const d = getStrokePathData(object.points, object.brush, true, object.pen, object.widthProfile)
    markup = `<path d="${d}" fill="${object.color}" fill-opacity="${opacity}" transform="${transform}"/>`
  } else {
    const fill = object.fill && (object.closed || object.kind === 'shape') ? object.color : 'none'
    const dash = brushRendering(object.brush).dotwork ? ` stroke-dasharray="0.1 ${Math.max(3, object.brush.size * 2.2)}"` : ''
    if (object.kind === 'path' && Object.keys(object.widthProfile ?? {}).length) {
      const count = object.closed ? object.points.length : object.points.length - 1
      const base = object.fill ? `<path d="${vectorSvgPath(object)}" fill="${fill}" stroke="none" transform="${transform}"/>` : ''
      markup = base + Array.from({ length: count }, (_, index) => {
        const nextIndex = index + 1 === object.points.length ? 0 : index + 1
        const width = object.brush.size * (widthAt(object.widthProfile, index) + widthAt(object.widthProfile, nextIndex)) / 2
        return `<path d="${vectorSvgPath(object, index)}" fill="none" stroke="${object.color}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${dash} transform="${transform}"/>`
      }).join('')
    } else {
      const d = object.kind === 'shape' ? shapeSvgPath(object) : vectorSvgPath(object)
      markup = `<path d="${d}" fill="${fill}" stroke="${object.color}" stroke-opacity="${opacity}" stroke-width="${object.brush.size}" stroke-linecap="round" stroke-linejoin="round"${dash} transform="${transform}"/>`
    }
  }
  return wrapVectorClips(markup, object)
}
