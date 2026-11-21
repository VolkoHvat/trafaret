import type { DocModel, LayerModel, SelectionModel } from '../types'
import { getLayerRenderCanvas, makeCanvas } from './project'
import { clipToSelection } from './selection'
import { isPristineEmptyLayer } from './vector'

export interface StrokePreview {
  layerId: string
  channel: 'content' | 'mask'
  eraser: boolean
  canvas: HTMLCanvasElement
  // Conservative extent of the entire freehand stroke, not just its newest samples.
  extent?: { x: number; y: number; width: number; height: number }
}

export interface RasterMovePreview {
  layerId: string
  channel: 'content' | 'mask'
  selection: SelectionModel
  cut: HTMLCanvasElement
  bounds: { x: number; y: number; width: number; height: number }
  dx: number
  dy: number
}

export interface ComposeInput {
  target: HTMLCanvasElement
  doc: DocModel
  layers: LayerModel[]
  activeLayerId: string
  background: boolean
  stencilMode: boolean
  onlyActive?: boolean
  scale?: number
  current?: StrokePreview | null
  rasterMove?: RasterMovePreview | null
  dirty?: { x: number; y: number; width: number; height: number } | null
}

type BufferName = 'preview' | 'maskPreview' | 'masked' | 'clipped' | 'below'

export class Compositor {
  private buffers: Partial<Record<BufferName, HTMLCanvasElement>> = {}

  private regionBase?: { source: HTMLCanvasElement; version: number; width: number; height: number; extent: NonNullable<StrokePreview['extent']> }

  private obtain(name: BufferName, doc: DocModel) {
    const existing = this.buffers[name]
    if (existing) {
      if (existing.width !== doc.width || existing.height !== doc.height) {
        existing.width = doc.width
        existing.height = doc.height
      }
      return existing
    }
    const created = makeCanvas(doc.width, doc.height)
    this.buffers[name] = created
    return created
  }

  release() {
    this.regionBase = undefined
    for (const name of Object.keys(this.buffers) as BufferName[]) {
      const canvas = this.buffers[name]
      if (canvas) {
        canvas.width = 1
        canvas.height = 1
      }
      delete this.buffers[name]
    }
  }

  compose(input: ComposeInput) {
    const {
      target, doc, layers, activeLayerId, background, stencilMode,
      onlyActive = false, scale = 1, current, rasterMove, dirty,
    } = input
    const ctx = target.getContext('2d', { willReadFrequently: true })!
    const clip = dirty && dirty.width > 0 && dirty.height > 0
      ? {
          x: Math.max(0, Math.floor(dirty.x)),
          y: Math.max(0, Math.floor(dirty.y)),
          width: Math.min(doc.width, Math.ceil(dirty.x + dirty.width)) - Math.max(0, Math.floor(dirty.x)),
          height: Math.min(doc.height, Math.ceil(dirty.y + dirty.height)) - Math.max(0, Math.floor(dirty.y)),
        }
      : null
    if (!clip || clip.width <= 0 || clip.height <= 0) {
      ctx.clearRect(0, 0, target.width, target.height)
      if (background) {
        ctx.fillStyle = stencilMode ? '#f7f6f0' : '#15161a'
        ctx.fillRect(0, 0, target.width, target.height)
      }
    } else {
      ctx.clearRect(clip.x, clip.y, clip.width, clip.height)
      if (background) {
        ctx.fillStyle = stencilMode ? '#f7f6f0' : '#15161a'
        ctx.fillRect(clip.x, clip.y, clip.width, clip.height)
      }
      ctx.save()
      ctx.beginPath()
      ctx.rect(clip.x, clip.y, clip.width, clip.height)
      ctx.clip()
    }
    let belowNeeded = false
    if (!onlyActive) {
      let seenVisible = false
      for (const layer of layers) {
        if (!layer.visible) continue
        if (layer.clipToBelow && seenVisible) { belowNeeded = true; break }
        seenVisible = true
      }
    }
    let hasBelow = false
    ctx.save()
    ctx.scale(scale, scale)
    layers.forEach(layer => {
      if (!layer.visible || (onlyActive && layer.id !== activeLayerId)) return
      const contentPreview = current && current.layerId === layer.id && current.channel === 'content'
      const movePreview = rasterMove && rasterMove.layerId === layer.id && rasterMove.channel === 'content'
      let source: HTMLCanvasElement | null = isPristineEmptyLayer(layer) && !contentPreview && !movePreview
        ? null
        : getLayerRenderCanvas(layer)
      if (contentPreview && current && !current.eraser && !rasterMove && layers.length === 1 &&
          layer.kind === 'paint' && isPristineEmptyLayer(layer) && layer.opacity === 1 &&
          layer.blend === 'source-over' && !layer.filters && !layer.mask && !layer.clipToBelow && !stencilMode) {
        source = current.canvas
      } else if (contentPreview || movePreview) {
        const preview = this.obtain('preview', doc)
        const pctx = preview.getContext('2d', { willReadFrequently: true })!
        const extent = contentPreview && !current.eraser && !movePreview && layer.kind === 'paint' &&
          !layer.filters && !layer.mask && layers.length === 1 ? current.extent : undefined
        const base = this.regionBase
        if (extent && base && base.source === source && base.version === layer.pixelVersion &&
            base.width === doc.width && base.height === doc.height) {
          const { x, y, width, height } = base.extent
          pctx.clearRect(x, y, width, height)
          pctx.drawImage(source!, x, y, width, height, x, y, width, height)
        } else {
          pctx.clearRect(0, 0, doc.width, doc.height)
          pctx.drawImage(source!, 0, 0)
        }
        this.regionBase = extent ? { source: source!, version: layer.pixelVersion, width: doc.width, height: doc.height, extent } : undefined
        if (extent && current) {
          const { x, y, width, height } = extent
          pctx.drawImage(current.canvas, x, y, width, height, x, y, width, height)
        } else if (contentPreview && current) {
          pctx.save()
          pctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
          pctx.drawImage(current.canvas, 0, 0)
          pctx.restore()
        }
        if (movePreview && rasterMove) {
          pctx.save()
          clipToSelection(pctx, rasterMove.selection, doc.width, doc.height)
          pctx.clearRect(0, 0, doc.width, doc.height)
          pctx.restore()
          pctx.drawImage(rasterMove.cut, rasterMove.bounds.x + rasterMove.dx, rasterMove.bounds.y + rasterMove.dy)
        }
        source = preview
      }

      let activeMask = layer.mask
      if (current && current.layerId === layer.id && current.channel === 'mask' && layer.mask) {
        const maskPreview = this.obtain('maskPreview', doc)
        const mctx = maskPreview.getContext('2d', { willReadFrequently: true })!
        mctx.clearRect(0, 0, doc.width, doc.height)
        mctx.drawImage(layer.mask, 0, 0)
        mctx.save()
        mctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
        mctx.drawImage(current.canvas, 0, 0)
        mctx.restore()
        activeMask = maskPreview
      }
      if (rasterMove && rasterMove.layerId === layer.id && rasterMove.channel === 'mask' && layer.mask) {
        const maskPreview = this.obtain('maskPreview', doc)
        const mctx = maskPreview.getContext('2d', { willReadFrequently: true })!
        mctx.clearRect(0, 0, doc.width, doc.height)
        mctx.drawImage(layer.mask, 0, 0)
        mctx.save()
        clipToSelection(mctx, rasterMove.selection, doc.width, doc.height)
        mctx.clearRect(0, 0, doc.width, doc.height)
        mctx.restore()
        mctx.drawImage(rasterMove.cut, rasterMove.bounds.x + rasterMove.dx, rasterMove.bounds.y + rasterMove.dy)
        activeMask = maskPreview
      }
      if (source && activeMask && layer.maskEnabled !== false) {
        const masked = this.obtain('masked', doc)
        const mctx = masked.getContext('2d', { willReadFrequently: true })!
        mctx.clearRect(0, 0, doc.width, doc.height)
        mctx.globalCompositeOperation = 'source-over'
        mctx.drawImage(source, 0, 0)
        mctx.globalCompositeOperation = 'destination-in'
        mctx.drawImage(activeMask, 0, 0)
        mctx.globalCompositeOperation = 'source-over'
        source = masked
      }
      if (source && layer.clipToBelow && hasBelow && !onlyActive) {
        const clipped = this.obtain('clipped', doc)
        const cctx = clipped.getContext('2d', { willReadFrequently: true })!
        cctx.clearRect(0, 0, doc.width, doc.height)
        cctx.globalCompositeOperation = 'source-over'
        cctx.drawImage(source, 0, 0)
        cctx.globalCompositeOperation = 'destination-in'
        cctx.drawImage(this.obtain('below', doc), 0, 0)
        cctx.globalCompositeOperation = 'source-over'
        source = clipped
      }
      if (source) {
        ctx.save()
        ctx.globalAlpha = layer.opacity
        ctx.globalCompositeOperation = layer.blend
        if (stencilMode) ctx.filter = 'grayscale(1) contrast(1.55)'
        ctx.drawImage(source, 0, 0)
        ctx.restore()
      }
      if (belowNeeded) {
        const below = this.obtain('below', doc)
        const bctx = below.getContext('2d', { willReadFrequently: true })!
        bctx.clearRect(0, 0, doc.width, doc.height)
        if (source) {
          bctx.globalCompositeOperation = 'source-over'
          bctx.drawImage(source, 0, 0)
        }
      }
      hasBelow = true
    })
    ctx.restore()
    if (clip) ctx.restore()
  }
}
