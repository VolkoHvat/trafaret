import type { DocModel, LayerModel, ProjectSnapshot, ScanFilters } from '../types'
import { cloneObjects } from './vector'

export const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export function makeCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d', { willReadFrequently: true })
  return canvas
}

export function makePaintLayer(doc: DocModel, name = 'Линия'): LayerModel {
  return {
    id: uid(), name, kind: 'paint', visible: true, locked: false, opacity: 1,
    blend: 'source-over', canvas: makeCanvas(doc.width, doc.height), pixelVersion: 0,
  }
}

export function makeVectorLayer(doc: DocModel, name = 'Векторный контур'): LayerModel {
  return {
    id: uid(), name, kind: 'vector', visible: true, locked: false, opacity: 1,
    blend: 'source-over', canvas: makeCanvas(doc.width, doc.height), objects: [], pixelVersion: 0,
  }
}

export function createLayerMask(layer: LayerModel) {
  const mask = makeCanvas(layer.canvas.width, layer.canvas.height)
  const ctx = mask.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, mask.width, mask.height)
  layer.mask = mask
  layer.maskEnabled = true
  layer.maskVersion = 0
  return mask
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не удалось прочитать изображение'))
    image.src = src
  })
}

export function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function redrawImageLayer(layer: LayerModel) {
  if (!layer.sourceImage) return
  const { canvas, sourceImage: image } = layer
  const ctx = canvas.getContext('2d')!
  const scale = layer.transform?.scale ?? 1
  const rotation = (layer.transform?.rotation ?? 0) * Math.PI / 180
  const fit = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight) * 0.92
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.translate(canvas.width / 2 + (layer.transform?.x ?? 0), canvas.height / 2 + (layer.transform?.y ?? 0))
  ctx.rotate(rotation)
  ctx.scale(fit * scale, fit * scale)
  ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2)
  ctx.restore()
  layer.pixelVersion += 1
  layer.filterKey = undefined
}

function filterKey(filters: ScanFilters) {
  return JSON.stringify(filters)
}

export function getLayerRenderCanvas(layer: LayerModel) {
  if (!layer.filters) return layer.canvas
  const filters = layer.filters
  const key = filterKey(filters)
  if (layer.filterCache && layer.filterKey === key) return layer.filterCache
  const cache = layer.filterCache ?? makeCanvas(layer.canvas.width, layer.canvas.height)
  cache.width = layer.canvas.width
  cache.height = layer.canvas.height
  const ctx = cache.getContext('2d', { willReadFrequently: true })!
  ctx.clearRect(0, 0, cache.width, cache.height)
  ctx.drawImage(layer.canvas, 0, 0)
  const image = ctx.getImageData(0, 0, cache.width, cache.height)
  const data = image.data
  const contrast = filters.contrast / 100
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i]
    let g = data[i + 1]
    let b = data[i + 2]
    if (filters.grayscale || filters.threshold > 0) {
      const gray = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722)
      r = gray; g = gray; b = gray
    }
    r = (r - 128) * contrast + 128
    g = (g - 128) * contrast + 128
    b = (b - 128) * contrast + 128
    if (filters.threshold > 0) {
      const value = (r + g + b) / 3 >= filters.threshold ? 255 : 0
      r = value; g = value; b = value
    }
    if (filters.invert) {
      r = 255 - r; g = 255 - g; b = 255 - b
    }
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
  ctx.putImageData(image, 0, 0)
  layer.filterCache = cache
  layer.filterKey = key
  return cache
}

export function snapshotProject(doc: DocModel, layers: LayerModel[], activeLayerId: string): ProjectSnapshot {
  return {
    format: 'trafaret-project', version: 2, savedAt: new Date().toISOString(), doc: { ...doc },
    activeLayerId,
    layers: layers.map((layer) => {
      const data = layer.dataCache?.version === layer.pixelVersion
        ? layer.dataCache.data
        : layer.canvas.toDataURL('image/png')
      layer.dataCache = { version: layer.pixelVersion, data }
      let maskData: string | undefined
      if (layer.mask) {
        const version = layer.maskVersion ?? 0
        maskData = layer.maskCache?.version === version ? layer.maskCache.data : layer.mask.toDataURL('image/png')
        layer.maskCache = { version, data: maskData }
      }
      return {
        id: layer.id, name: layer.name, kind: layer.kind, visible: layer.visible, locked: layer.locked,
        opacity: layer.opacity, blend: layer.blend, data,
        source: layer.source, transform: layer.transform, filters: layer.filters,
        objects: layer.kind === 'vector' ? cloneObjects(layer.objects) : undefined,
        maskData, maskEnabled: layer.maskEnabled !== false, clipToBelow: Boolean(layer.clipToBelow),
      }
    }),
  }
}

export async function restoreProject(snapshot: ProjectSnapshot) {
  if (snapshot.format !== 'trafaret-project' || ![1, 2].includes(snapshot.version)) {
    throw new Error('Это не проект «Трафарета»')
  }
  const { doc } = snapshot
  if (!doc || doc.width < 64 || doc.height < 64 || doc.width > 8192 || doc.height > 8192 || !snapshot.layers?.length) {
    throw new Error('Повреждённые размеры или слои проекта')
  }
  const layers: LayerModel[] = []
  for (const saved of snapshot.layers) {
    const canvas = makeCanvas(doc.width, doc.height)
    if (saved.data) {
      const bitmap = await loadImage(saved.data)
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    }
    const kind = saved.kind === 'image' ? 'image' : saved.kind === 'vector' && snapshot.version >= 2 ? 'vector' : 'paint'
    const layer: LayerModel = {
      id: saved.id || uid(), name: saved.name || 'Слой', kind,
      visible: saved.visible !== false, locked: Boolean(saved.locked), opacity: saved.opacity ?? 1,
      blend: saved.blend || 'source-over', canvas, source: saved.source,
      transform: saved.transform, filters: saved.filters,
      objects: kind === 'vector' ? cloneObjects(saved.objects) : undefined,
      maskEnabled: saved.maskEnabled !== false, clipToBelow: Boolean(saved.clipToBelow),
      pixelVersion: 0, dataCache: saved.data ? { version: 0, data: saved.data } : undefined,
    }
    if (saved.source) layer.sourceImage = await loadImage(saved.source)
    if (saved.maskData) {
      const mask = makeCanvas(doc.width, doc.height)
      const bitmap = await loadImage(saved.maskData)
      mask.getContext('2d')!.drawImage(bitmap, 0, 0)
      layer.mask = mask
      layer.maskVersion = 0
      layer.maskCache = { version: 0, data: saved.maskData }
    }
    layers.push(layer)
  }
  return {
    doc: {
      width: Math.round(doc.width), height: Math.round(doc.height),
      title: String(doc.title || 'Проект'), dpi: Math.max(72, Math.min(1200, Number(doc.dpi) || 300)),
    },
    layers,
    activeLayerId: layers.some((layer) => layer.id === snapshot.activeLayerId) ? snapshot.activeLayerId : layers[layers.length - 1].id,
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function safeFilename(title: string) {
  return title.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'tattoo-project'
}
