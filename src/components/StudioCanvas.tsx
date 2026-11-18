import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type {
  BrushConfig, DocModel, GuideMode, LayerModel, SelectionModel, ShapeKind,
  SymmetryMode, ToolId, VectorObject, ViewState,
} from '../types'
import { renderStroke, type StrokePoint } from '../lib/brushes'
import { floodFill } from '../lib/fill'
import { clipToSelection, drawSelectionOutline, selectionBounds } from '../lib/selection'
import { analyzeArtwork, type ArtworkLayer, type ArtworkReport } from '../lib/artwork-analysis'
import { getLayerRenderCanvas, makeCanvas } from '../lib/project'
import { HistoryStore } from '../lib/history'
import { decodeRasterImage, makeRasterHistoryEntry, type RasterHistoryEntry } from '../lib/raster-history'
import { copyPoints, StrokeSession, symmetricObjects } from '../lib/stroke-session'
import {
  defaultVectorTransform, ensureObjectOrigin, localPoint, objectBounds, objectOrigin, worldPoint,
} from '../lib/geometry'
import {
  cloneObjects, hitVectorObject, isPristineEmptyLayer, renderVectorLayer, renderVectorObject, vectorId,
} from '../lib/vector'

export interface StudioHandle {
  undo: () => void
  redo: () => void
  clearActive: () => void
  deleteSelectedObject: () => void
  commitPen: (closed?: boolean) => void
  cancelDraft: () => void
  fitView: () => void
  exportImage: (transparent: boolean, stencil: boolean, onlyActive?: boolean) => Promise<Blob>
  analyzeArtwork: () => ArtworkReport
  dropHistoryFor: (layerId: string) => void
  historyPixels: () => number
}

interface Props {
  doc: DocModel
  layers: LayerModel[]
  activeLayerId: string
  projectSession: number
  tool: ToolId
  brush: BrushConfig
  color: string
  symmetry: SymmetryMode
  radialCount: number
  guide: GuideMode
  shapeKind: ShapeKind
  areaShape: 'rectangle' | 'ellipse'
  selection: SelectionModel | null
  maskEditing: boolean
  selectedObjectId: string | null
  stencil: boolean
  stylusOnly: boolean
  flipped: boolean
  view: ViewState
  renderToken: number
  onViewChange: (view: ViewState) => void
  onMutated: () => void
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void
  onPickColor: (color: string) => void
  onNotice: (message: string) => void
  onSelectionChange: (selection: SelectionModel | null) => void
  onSelectObject: (id: string | null) => void
}

interface Rect { x: number; y: number; width: number; height: number }
interface ObjectHistory {
  kind: 'objects'
  layerId: string
  before: VectorObject[]
  after: VectorObject[]
  cost: number
}
type HistoryEntry = RasterHistoryEntry | ObjectHistory
interface RasterHistoryInput {
  kind: 'raster'
  layerId: string
  channel: 'content' | 'mask'
  rect: Rect
  before: ImageData
  after: ImageData
}
type HistoryInput = RasterHistoryInput | ObjectHistory

type ObjectDragMode = 'move' | 'scale' | 'rotate' | 'node'
interface ObjectDrag {
  pointerId: number
  layerId: string
  objectId: string
  mode: ObjectDragMode
  nodeIndex?: number
  start: StrokePoint
  before: VectorObject[]
  original: VectorObject
  centerX: number
  centerY: number
  startDistance: number
  startAngle: number
}

interface RasterMove {
  pointerId: number
  layerId: string
  channel: 'content' | 'mask'
  selection: SelectionModel
  cut: HTMLCanvasElement
  bounds: Rect
  start: StrokePoint
  dx: number
  dy: number
}

interface SelectionDraft {
  pointerId: number
  selection: SelectionModel
}

const MAX_HISTORY_PIXELS = 32_000_000
const ANALYSIS_SAMPLE_MAX = 512
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
const selectionClips = (selection: SelectionModel | null) => selection
  ? [JSON.parse(JSON.stringify(selection)) as SelectionModel]
  : undefined

export const StudioCanvas = forwardRef<StudioHandle, Props>(function StudioCanvas(props, ref) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const strokeRef = useRef<HTMLCanvasElement | null>(null)
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const maskPreviewRef = useRef<HTMLCanvasElement | null>(null)
  const maskedRef = useRef<HTMLCanvasElement | null>(null)
  const clippedRef = useRef<HTMLCanvasElement | null>(null)
  const belowRef = useRef<HTMLCanvasElement | null>(null)
  const analysisRef = useRef<HTMLCanvasElement | null>(null)
  const currentRef = useRef<StrokeSession | null>(null)
  const objectDragRef = useRef<ObjectDrag | null>(null)
  const rasterMoveRef = useRef<RasterMove | null>(null)
  const selectionDraftRef = useRef<SelectionDraft | null>(null)
  const penDraftRef = useRef<StrokePoint[]>([])
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number; docX: number; docY: number } | null>(null)
  const panRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null)
  const historyRef = useRef(new HistoryStore<HistoryEntry>(MAX_HISTORY_PIXELS))
  const frameRef = useRef<number | null>(null)
  const propsRef = useRef(props)
  useLayoutEffect(() => { propsRef.current = props })

  const ensureBuffers = useCallback(() => {
    const { width, height } = propsRef.current.doc
    const visible = canvasRef.current
    if (visible && (visible.width !== width || visible.height !== height)) {
      visible.width = width
      visible.height = height
    }
    visible?.getContext('2d', { willReadFrequently: true })
    for (const bufferRef of [strokeRef, beforeRef, previewRef, maskPreviewRef, maskedRef, clippedRef, belowRef]) {
      const buffer = bufferRef.current
      if (buffer && (buffer.width !== width || buffer.height !== height)) {
        buffer.width = width
        buffer.height = height
      }
    }
  }, [])

  const obtainBuffer = useCallback((bufferRef: { current: HTMLCanvasElement | null }) => {
    const { width, height } = propsRef.current.doc
    const existing = bufferRef.current
    if (existing) {
      if (existing.width !== width || existing.height !== height) {
        existing.width = width
        existing.height = height
      }
      return existing
    }
    const created = makeCanvas(width, height)
    bufferRef.current = created
    return created
  }, [])

  const releaseBuffer = useCallback((bufferRef: { current: HTMLCanvasElement | null }) => {
    const buffer = bufferRef.current
    if (buffer instanceof HTMLCanvasElement) {
      buffer.width = 1
      buffer.height = 1
    }
    bufferRef.current = null
  }, [])

  const updateHistoryState = useCallback(() => {
    propsRef.current.onHistoryChange(historyRef.current.canUndo, historyRef.current.canRedo)
  }, [])

  useEffect(() => {
    updateHistoryState()
    return () => { propsRef.current.onHistoryChange(false, false) }
  }, [updateHistoryState])

  const channelCanvas = (layer: LayerModel, channel: 'content' | 'mask') => channel === 'mask' ? layer.mask! : layer.canvas

  const composeTo = useCallback((target: HTMLCanvasElement, background: boolean, stencilMode: boolean, onlyActive = false, scale = 1) => {
    ensureBuffers()
    const { doc, layers, activeLayerId, maskEditing } = propsRef.current
    const ctx = target.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, target.width, target.height)
    if (background) {
      ctx.fillStyle = stencilMode ? '#f7f6f0' : '#f3f1e9'
      ctx.fillRect(0, 0, target.width, target.height)
    }
    const current = currentRef.current
    const rasterMove = rasterMoveRef.current
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
      // A pristine blank layer draws nothing; skip it unless a live preview
      // (current stroke / raster move) must be composited for it. canvas
      // dimensions stay doc-sized either way.
      let source: HTMLCanvasElement | null = isPristineEmptyLayer(layer) && !contentPreview && !movePreview
        ? null
        : getLayerRenderCanvas(layer)
      if (contentPreview || movePreview) {
        const preview = obtainBuffer(previewRef)
        const pctx = preview.getContext('2d', { willReadFrequently: true })!
        pctx.clearRect(0, 0, doc.width, doc.height)
        // Non-null: a preview forces getLayerRenderCanvas above.
        pctx.drawImage(source!, 0, 0)
        if (contentPreview && current) {
          pctx.save()
          pctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
          pctx.drawImage(obtainBuffer(strokeRef), 0, 0)
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
        const maskPreview = obtainBuffer(maskPreviewRef)
        const mctx = maskPreview.getContext('2d', { willReadFrequently: true })!
        mctx.clearRect(0, 0, doc.width, doc.height)
        mctx.drawImage(layer.mask, 0, 0)
        mctx.save()
        mctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
        mctx.drawImage(obtainBuffer(strokeRef), 0, 0)
        mctx.restore()
        activeMask = maskPreview
      }
      if (rasterMove && rasterMove.layerId === layer.id && rasterMove.channel === 'mask' && layer.mask) {
        const maskPreview = obtainBuffer(maskPreviewRef)
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
        const masked = obtainBuffer(maskedRef)
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
        const clipped = obtainBuffer(clippedRef)
        const cctx = clipped.getContext('2d', { willReadFrequently: true })!
        cctx.clearRect(0, 0, doc.width, doc.height)
        cctx.globalCompositeOperation = 'source-over'
        cctx.drawImage(source, 0, 0)
        cctx.globalCompositeOperation = 'destination-in'
        cctx.drawImage(obtainBuffer(belowRef), 0, 0)
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
        const below = obtainBuffer(belowRef)
        const bctx = below.getContext('2d', { willReadFrequently: true })!
        bctx.clearRect(0, 0, doc.width, doc.height)
        if (source) {
          bctx.globalCompositeOperation = 'source-over'
          bctx.drawImage(source, 0, 0)
        }
        // A skipped pristine layer leaves a transparent below, so a clipped
        // layer above it stays hidden instead of seeing stale buffer pixels.
      }
      hasBelow = true
    })
    ctx.restore()
    void maskEditing
  }, [ensureBuffers, obtainBuffer])

  const drawOverlay = useCallback((ctx: CanvasRenderingContext2D) => {
    const {
      doc, view, symmetry, radialCount, guide, selection, layers, activeLayerId,
      selectedObjectId, maskEditing,
    } = propsRef.current
    const unit = 1 / Math.max(0.03, view.zoom)
    ctx.save()
    ctx.lineWidth = unit
    ctx.strokeStyle = 'rgba(115, 105, 42, .58)'
    ctx.setLineDash([8 * unit, 7 * unit])
    if (guide !== 'none') {
      ctx.beginPath()
      if (guide === 'circle') {
        const radius = Math.min(doc.width, doc.height) * 0.42
        ctx.ellipse(doc.width / 2, doc.height / 2, radius, radius, 0, 0, Math.PI * 2)
      } else {
        ctx.ellipse(doc.width / 2, doc.height / 2, doc.width * 0.42, doc.height * 0.34, 0, 0, Math.PI * 2)
      }
      ctx.stroke()
    }
    if (symmetry === 'vertical') {
      ctx.beginPath(); ctx.moveTo(doc.width / 2, 0); ctx.lineTo(doc.width / 2, doc.height); ctx.stroke()
    } else if (symmetry === 'radial') {
      for (let index = 0; index < radialCount; index++) {
        const angle = index * Math.PI * 2 / radialCount
        const radius = Math.hypot(doc.width, doc.height)
        ctx.beginPath()
        ctx.moveTo(doc.width / 2, doc.height / 2)
        ctx.lineTo(doc.width / 2 + Math.cos(angle) * radius, doc.height / 2 + Math.sin(angle) * radius)
        ctx.stroke()
      }
    }
    ctx.restore()

    const draftSelection = selectionDraftRef.current?.selection
    const rasterMove = rasterMoveRef.current
    if (draftSelection) drawSelectionOutline(ctx, draftSelection, view.zoom)
    else if (rasterMove) {
      const moved: SelectionModel = {
        ...rasterMove.selection,
        points: rasterMove.selection.points.map(([x, y]) => [x + rasterMove.dx, y + rasterMove.dy]),
      }
      drawSelectionOutline(ctx, moved, view.zoom)
    } else if (selection) drawSelectionOutline(ctx, selection, view.zoom)

    const active = layers.find(layer => layer.id === activeLayerId)
    const selected = active?.objects?.find(object => object.id === selectedObjectId)
    if (selected && !maskEditing) {
      const bounds = objectBounds(selected)
      ctx.save()
      ctx.strokeStyle = '#8b7d25'
      ctx.fillStyle = '#fbfda4'
      ctx.lineWidth = 1.4 * unit
      ctx.setLineDash([5 * unit, 4 * unit])
      ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
      ctx.setLineDash([])
      const handle = 9 * unit
      const scaleX = bounds.maxX, scaleY = bounds.maxY
      const rotateX = (bounds.minX + bounds.maxX) / 2, rotateY = bounds.minY - 22 * unit
      ctx.beginPath(); ctx.moveTo(rotateX, bounds.minY); ctx.lineTo(rotateX, rotateY); ctx.stroke()
      ctx.fillRect(scaleX - handle / 2, scaleY - handle / 2, handle, handle)
      ctx.beginPath(); ctx.arc(rotateX, rotateY, handle / 2, 0, Math.PI * 2); ctx.fill()
      if (selected.kind === 'path') {
        for (const point of selected.points) {
          const [x, y] = worldPoint(point, selected)
          ctx.beginPath(); ctx.arc(x, y, 4.5 * unit, 0, Math.PI * 2); ctx.fill()
          ctx.stroke()
        }
      }
      ctx.restore()
    }

    const penPoints = penDraftRef.current
    if (penPoints.length) {
      ctx.save()
      ctx.strokeStyle = '#8b7d25'
      ctx.fillStyle = '#fbfda4'
      ctx.lineWidth = Math.max(1, propsRef.current.brush.size * 0.35)
      ctx.setLineDash([6 * unit, 4 * unit])
      ctx.beginPath()
      penPoints.forEach((point, index) => index ? ctx.lineTo(point[0], point[1]) : ctx.moveTo(point[0], point[1]))
      ctx.stroke()
      ctx.setLineDash([])
      for (const point of penPoints) {
        ctx.beginPath(); ctx.arc(point[0], point[1], 5 * unit, 0, Math.PI * 2); ctx.fill()
      }
      ctx.restore()
    }
  }, [])

  const renderNow = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const canvas = canvasRef.current
    if (!canvas) return
    composeTo(canvas, true, propsRef.current.stencil)
    drawOverlay(canvas.getContext('2d', { willReadFrequently: true })!)
  }, [composeTo, drawOverlay])

  const scheduleRender = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(renderNow)
  }, [renderNow])

  useEffect(() => {
    ensureBuffers()
    scheduleRender()
  }, [
    props.layers, props.doc, props.stencil, props.renderToken, props.selection,
    props.selectedObjectId, props.symmetry, props.radialCount, props.guide,
    props.maskEditing, ensureBuffers, scheduleRender,
  ])

  useLayoutEffect(() => () => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    // Unmount only: free the old document's visible backing store before the
    // refs are dropped. Regular renders never shrink the visible canvas.
    const visible = canvasRef.current
    if (visible) {
      visible.width = 1
      visible.height = 1
    }
    releaseBuffer(strokeRef)
    releaseBuffer(beforeRef)
    releaseBuffer(previewRef)
    releaseBuffer(maskPreviewRef)
    releaseBuffer(maskedRef)
    releaseBuffer(clippedRef)
    releaseBuffer(belowRef)
    releaseBuffer(analysisRef)
  }, [releaseBuffer])

  // Document identity changed (create/load): drop the old document's undo/redo
  // history and transient buffers so Undo cannot cross documents and the old
  // entries are not retained. Plain title/DPI edits do not bump the session.
  const lastSessionRef = useRef(props.projectSession)
  useEffect(() => {
    if (lastSessionRef.current === props.projectSession) return
    lastSessionRef.current = props.projectSession
    historyRef.current.clear()
    updateHistoryState()
    releaseBuffer(strokeRef)
    releaseBuffer(beforeRef)
    releaseBuffer(previewRef)
    releaseBuffer(maskPreviewRef)
  }, [props.projectSession, releaseBuffer, updateHistoryState])

  const pushHistory = useCallback((input: HistoryInput) => {
    const entry: HistoryEntry = input.kind === 'objects' ? input : makeRasterHistoryEntry(input)
    historyRef.current.push(entry)
    updateHistoryState()
  }, [updateHistoryState])

  const pushObjectHistory = useCallback((layer: LayerModel, before: VectorObject[], after: VectorObject[]) => {
    layer.objects = cloneObjects(after)
    renderVectorLayer(layer)
    const cost = clamp(JSON.stringify(after).length * 12, 16_384, 4_000_000)
    pushHistory({ kind: 'objects', layerId: layer.id, before: cloneObjects(before), after: cloneObjects(after), cost })
  }, [pushHistory])

  const restoreHistory = useCallback((entry: HistoryEntry, side: 'before' | 'after') => {
    const layer = propsRef.current.layers.find(item => item.id === entry.layerId)
    if (!layer) return
    if (entry.kind === 'objects') {
      layer.objects = cloneObjects(entry[side])
      renderVectorLayer(layer)
    } else {
      const canvas = entry.channel === 'mask' ? layer.mask : layer.canvas
      if (!canvas) return
      canvas.getContext('2d', { willReadFrequently: true })!.putImageData(decodeRasterImage(entry[side]), entry.rect.x, entry.rect.y)
      if (entry.channel === 'mask') layer.maskVersion = (layer.maskVersion ?? 0) + 1
      else {
        layer.pixelVersion += 1
        layer.filterKey = undefined
      }
    }
    propsRef.current.onMutated()
    scheduleRender()
  }, [scheduleRender])

  const busy = () => Boolean(currentRef.current || objectDragRef.current || rasterMoveRef.current)

  const clearActive = useCallback(() => {
    const { layers, activeLayerId, doc, selection, maskEditing } = propsRef.current
    const layer = layers.find(item => item.id === activeLayerId)
    if (!layer || layer.locked) {
      propsRef.current.onNotice('Выберите незаблокированный слой')
      return
    }
    if (layer.kind === 'vector' && !maskEditing) {
      const before = cloneObjects(layer.objects)
      if (!before.length) return
      const after = selection
        ? before.map(object => ({
            ...object,
            clips: [...(object.clips ?? []), { ...JSON.parse(JSON.stringify(selection)) as SelectionModel, inverse: !selection.inverse }],
          }))
        : []
      pushObjectHistory(layer, before, after)
      propsRef.current.onSelectObject(null)
    } else {
      const canvas = maskEditing ? layer.mask : layer.canvas
      if (!canvas) return
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      const full = { x: 0, y: 0, width: doc.width, height: doc.height }
      let rect = full
      if (selection && !selection.inverse) {
        const bounds = selectionBounds(selection)
        const x = clamp(Math.floor(bounds.minX), 0, doc.width - 1)
        const y = clamp(Math.floor(bounds.minY), 0, doc.height - 1)
        rect = {
          x, y,
          width: clamp(Math.ceil(bounds.maxX) - x, 1, doc.width - x),
          height: clamp(Math.ceil(bounds.maxY) - y, 1, doc.height - y),
        }
      }
      const before = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
      ctx.save()
      clipToSelection(ctx, selection, doc.width, doc.height)
      ctx.clearRect(0, 0, doc.width, doc.height)
      ctx.restore()
      const after = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
      if (maskEditing) layer.maskVersion = (layer.maskVersion ?? 0) + 1
      else { layer.pixelVersion += 1; layer.filterKey = undefined }
      pushHistory({ kind: 'raster', layerId: layer.id, channel: maskEditing ? 'mask' : 'content', rect, before, after })
    }
    propsRef.current.onMutated()
    scheduleRender()
  }, [pushHistory, pushObjectHistory, scheduleRender])

  const deleteSelectedObject = useCallback(() => {
    const { layers, activeLayerId, selectedObjectId } = propsRef.current
    const layer = layers.find(item => item.id === activeLayerId)
    if (!layer || layer.kind !== 'vector' || layer.locked || !selectedObjectId) return
    const before = cloneObjects(layer.objects)
    const after = before.filter(object => object.id !== selectedObjectId)
    if (after.length === before.length) return
    pushObjectHistory(layer, before, after)
    propsRef.current.onSelectObject(null)
    propsRef.current.onMutated()
    scheduleRender()
  }, [pushObjectHistory, scheduleRender])

  const commitPen = useCallback((closed = false) => {
    const points = penDraftRef.current
    const { layers, activeLayerId, brush, color, doc, symmetry, radialCount, selection } = propsRef.current
    const layer = layers.find(item => item.id === activeLayerId)
    if (points.length < 2 || !layer || layer.kind !== 'vector' || layer.locked) return
    const object: VectorObject = {
      id: vectorId(), kind: 'path', points: copyPoints(points), brush: { ...brush }, color,
      pen: false, closed, clips: selectionClips(selection), transform: defaultVectorTransform(),
    }
    const before = cloneObjects(layer.objects)
    const additions = symmetricObjects(object, doc, symmetry, radialCount, vectorId)
    pushObjectHistory(layer, before, [...before, ...additions])
    penDraftRef.current = []
    propsRef.current.onSelectObject(object.id)
    propsRef.current.onMutated()
    scheduleRender()
  }, [pushObjectHistory, scheduleRender])

  useImperativeHandle(ref, () => ({
    undo: () => {
      if (busy()) return
      const entry = historyRef.current.undo()
      if (!entry) return
      restoreHistory(entry, 'before')
      updateHistoryState()
    },
    redo: () => {
      if (busy()) return
      const entry = historyRef.current.redo()
      if (!entry) return
      restoreHistory(entry, 'after')
      updateHistoryState()
    },
    clearActive,
    deleteSelectedObject,
    commitPen,
    cancelDraft: () => {
      currentRef.current = null
      objectDragRef.current = null
      rasterMoveRef.current = null
      selectionDraftRef.current = null
      penDraftRef.current = []
      releaseBuffer(strokeRef)
      releaseBuffer(beforeRef)
      releaseBuffer(previewRef)
      releaseBuffer(maskPreviewRef)
      scheduleRender()
    },
    fitView: () => {
      const viewport = viewportRef.current
      if (!viewport) return
      const { doc } = propsRef.current
      const zoom = clamp(Math.min((viewport.clientWidth - 72) / doc.width, (viewport.clientHeight - 72) / doc.height), 0.03, 1.5)
      propsRef.current.onViewChange({
        zoom,
        panX: (viewport.clientWidth - doc.width * zoom) / 2,
        panY: (viewport.clientHeight - doc.height * zoom) / 2,
      })
    },
    exportImage: async (transparent: boolean, stencilMode: boolean, onlyActive = false) => {
      const { doc } = propsRef.current
      const output = makeCanvas(doc.width, doc.height)
      composeTo(output, !transparent, stencilMode, onlyActive)
      if (stencilMode) {
        const ctx = output.getContext('2d', { willReadFrequently: true })!
        const image = ctx.getImageData(0, 0, output.width, output.height)
        for (let i = 0; i < image.data.length; i += 4) {
          const gray = image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722
          const value = gray >= 185 ? 255 : 0
          image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value
        }
        ctx.putImageData(image, 0, 0)
      }
      return new Promise<Blob>((resolve, reject) => output.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Экспорт не удался')), 'image/png',
      ))
    },
    dropHistoryFor: (layerId: string) => {
      historyRef.current.dropLayer(layerId)
      updateHistoryState()
    },
    analyzeArtwork: () => {
      const { doc, layers } = propsRef.current
      const scale = Math.min(1, ANALYSIS_SAMPLE_MAX / doc.width, ANALYSIS_SAMPLE_MAX / doc.height)
      const sampleWidth = Math.max(1, Math.ceil(doc.width * scale))
      const sampleHeight = Math.max(1, Math.ceil(doc.height * scale))
      const sample = analysisRef.current ?? makeCanvas(sampleWidth, sampleHeight)
      analysisRef.current = sample
      if (sample.width !== sampleWidth || sample.height !== sampleHeight) {
        sample.width = sampleWidth
        sample.height = sampleHeight
      }
      let image: ImageData | null = null
      try {
        // Чистый видимый composite: без фона, трафаретного фильтра и overlay.
        composeTo(sample, false, false, false, scale)
        image = sample.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sampleWidth, sampleHeight)
      } finally {
        // Сразу отпускаем backing store, чтобы не держать полноразмерный анализ.
        sample.width = 1
        sample.height = 1
      }
      const artworkLayers: ArtworkLayer[] = layers.map(layer => ({
        id: layer.id, name: layer.name, kind: layer.kind,
        visible: layer.visible, opacity: layer.opacity, objects: layer.objects,
      }))
      return analyzeArtwork(doc, artworkLayers, image)
    },
    historyPixels: () => historyRef.current.size,
  }), [clearActive, commitPen, composeTo, deleteSelectedObject, releaseBuffer, restoreHistory, scheduleRender, updateHistoryState])

  const clientToDoc = useCallback((clientX: number, clientY: number): StrokePoint => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const { doc } = propsRef.current
    let x = (clientX - rect.left) * doc.width / rect.width
    const y = (clientY - rect.top) * doc.height / rect.height
    if (propsRef.current.flipped) x = doc.width - x
    return [clamp(x, 0, doc.width), clamp(y, 0, doc.height), 0.5]
  }, [])

  const redrawCurrent = useCallback((complete: boolean) => {
    const current = currentRef.current
    if (!current) return
    const { doc, selection } = propsRef.current
    const canvas = obtainBuffer(strokeRef)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, doc.width, doc.height)
    ctx.save()
    clipToSelection(ctx, selection, doc.width, doc.height)
    const sets = current.pointSets()
    for (const points of sets) {
      if (current.shape) {
        renderVectorObject(ctx, {
          id: 'preview', kind: 'shape', shape: current.shape, points: copyPoints(points),
          brush: current.brush, color: current.color, pen: current.pen, closed: true,
          transform: defaultVectorTransform(),
        })
      } else {
        renderStroke(ctx, points, current.brush, current.color, complete, current.pen)
      }
    }
    ctx.restore()
  }, [obtainBuffer])

  const finishStroke = useCallback(() => {
    const current = currentRef.current
    if (!current) return
    const { doc, layers, selection } = propsRef.current
    const layer = layers.find(item => item.id === current.layerId)
    if (!layer) {
      currentRef.current = null
      releaseBuffer(strokeRef)
      releaseBuffer(beforeRef)
      releaseBuffer(previewRef)
      releaseBuffer(maskPreviewRef)
      scheduleRender()
      return
    }
    redrawCurrent(true)
    if (current.vector) {
      const before = cloneObjects(layer.objects)
      const additions = current.vectorObjects(selectionClips(selection), vectorId)
      pushObjectHistory(layer, before, [...before, ...additions])
      propsRef.current.onSelectObject(additions[0].id)
    } else {
      const canvas = channelCanvas(layer, current.channel)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.save()
      clipToSelection(ctx, propsRef.current.selection, doc.width, doc.height)
      ctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
      ctx.drawImage(strokeRef.current!, 0, 0)
      ctx.restore()
      if (current.channel === 'mask') layer.maskVersion = (layer.maskVersion ?? 0) + 1
      else { layer.pixelVersion += 1; layer.filterKey = undefined }

      const rect = current.rasterRect()
      const before = obtainBuffer(beforeRef).getContext('2d', { willReadFrequently: true })!.getImageData(rect.x, rect.y, rect.width, rect.height)
      const after = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
      pushHistory({
        kind: 'raster', layerId: layer.id, channel: current.channel, rect,
        before, after,
      })
    }
    currentRef.current = null
    releaseBuffer(strokeRef)
    releaseBuffer(beforeRef)
    releaseBuffer(previewRef)
    releaseBuffer(maskPreviewRef)
    propsRef.current.onMutated()
    scheduleRender()
  }, [pushHistory, pushObjectHistory, obtainBuffer, redrawCurrent, releaseBuffer, scheduleRender])

  const startObjectDrag = (event: React.PointerEvent<HTMLCanvasElement>, point: StrokePoint) => {
    const { layers, activeLayerId, selectedObjectId, view } = propsRef.current
    const layer = layers.find(item => item.id === activeLayerId)
    if (!layer || layer.kind !== 'vector' || layer.locked) return
    const objects = layer.objects ?? []
    objects.forEach(ensureObjectOrigin)
    const selected = objects.find(object => object.id === selectedObjectId)
    let object = selected
    let mode: ObjectDragMode = 'move'
    let nodeIndex: number | undefined
    const tolerance = 13 / Math.max(0.03, view.zoom)
    if (selected) {
      const bounds = objectBounds(selected)
      const rotateX = (bounds.minX + bounds.maxX) / 2, rotateY = bounds.minY - 22 / view.zoom
      if (Math.hypot(point[0] - bounds.maxX, point[1] - bounds.maxY) <= tolerance) mode = 'scale'
      else if (Math.hypot(point[0] - rotateX, point[1] - rotateY) <= tolerance) mode = 'rotate'
      else if (selected.kind === 'path') {
        selected.points.forEach((item, index) => {
          const world = worldPoint(item, selected)
          if (Math.hypot(point[0] - world[0], point[1] - world[1]) <= tolerance) {
            mode = 'node'; nodeIndex = index
          }
        })
      }
    }
    if (mode === 'move') {
      const hit = hitVectorObject(objects, point[0], point[1], tolerance)
      if (!hit) {
        propsRef.current.onSelectObject(null)
        return
      }
      object = hit
      propsRef.current.onSelectObject(hit.id)
    }
    if (!object) return
    const origin = objectOrigin(object)
    const centerX = origin.x + object.transform.x
    const centerY = origin.y + object.transform.y
    objectDragRef.current = {
      pointerId: event.pointerId, layerId: layer.id, objectId: object.id, mode, nodeIndex,
      start: point, before: cloneObjects(objects), original: JSON.parse(JSON.stringify(object)) as VectorObject,
      centerX, centerY,
      startDistance: Math.max(1, Math.hypot(point[0] - centerX, point[1] - centerY)),
      startAngle: Math.atan2(point[1] - centerY, point[0] - centerX),
    }
  }

  const moveObjectDrag = (point: StrokePoint) => {
    const drag = objectDragRef.current
    if (!drag) return
    const layer = propsRef.current.layers.find(item => item.id === drag.layerId)
    const object = layer?.objects?.find(item => item.id === drag.objectId)
    if (!layer || !object) return
    if (drag.mode === 'move') {
      object.transform.x = drag.original.transform.x + point[0] - drag.start[0]
      object.transform.y = drag.original.transform.y + point[1] - drag.start[1]
    } else if (drag.mode === 'scale') {
      const distance = Math.hypot(point[0] - drag.centerX, point[1] - drag.centerY)
      object.transform.scale = clamp(drag.original.transform.scale * distance / drag.startDistance, 0.05, 20)
    } else if (drag.mode === 'rotate') {
      const angle = Math.atan2(point[1] - drag.centerY, point[0] - drag.centerX)
      object.transform.rotation = drag.original.transform.rotation + (angle - drag.startAngle) * 180 / Math.PI
    } else if (drag.mode === 'node' && drag.nodeIndex !== undefined) {
      const local = localPoint(point, object)
      object.points[drag.nodeIndex] = [local[0], local[1], object.points[drag.nodeIndex][2]]
    }
    renderVectorLayer(layer)
    scheduleRender()
  }

  const finishObjectDrag = () => {
    const drag = objectDragRef.current
    if (!drag) return
    const layer = propsRef.current.layers.find(item => item.id === drag.layerId)
    objectDragRef.current = null
    if (!layer) return
    const after = cloneObjects(layer.objects)
    if (JSON.stringify(after) !== JSON.stringify(drag.before)) {
      pushObjectHistory(layer, drag.before, after)
      propsRef.current.onMutated()
    }
    scheduleRender()
  }

  const startRasterMove = (event: React.PointerEvent<HTMLCanvasElement>, point: StrokePoint) => {
    const { layers, activeLayerId, selection, maskEditing, doc } = propsRef.current
    const layer = layers.find(item => item.id === activeLayerId)
    if (!selection || !layer || layer.locked || (layer.kind === 'vector' && !maskEditing)) return
    const channel = maskEditing ? 'mask' : 'content'
    const canvas = channelCanvas(layer, channel)
    if (!canvas) return
    const before = obtainBuffer(beforeRef)
    const beforeCtx = before.getContext('2d', { willReadFrequently: true })!
    beforeCtx.clearRect(0, 0, doc.width, doc.height)
    beforeCtx.drawImage(canvas, 0, 0)
    let rect: Rect = { x: 0, y: 0, width: doc.width, height: doc.height }
    if (!selection.inverse) {
      const bounds = selectionBounds(selection)
      const x = clamp(Math.floor(bounds.minX), 0, doc.width - 1)
      const y = clamp(Math.floor(bounds.minY), 0, doc.height - 1)
      rect = {
        x, y,
        width: clamp(Math.ceil(bounds.maxX) - x, 1, doc.width - x),
        height: clamp(Math.ceil(bounds.maxY) - y, 1, doc.height - y),
      }
    }
    const cut = makeCanvas(rect.width, rect.height)
    const cctx = cut.getContext('2d', { willReadFrequently: true })!
    cctx.save()
    cctx.translate(-rect.x, -rect.y)
    clipToSelection(cctx, selection, doc.width, doc.height)
    cctx.drawImage(canvas, 0, 0)
    cctx.restore()
    rasterMoveRef.current = {
      pointerId: event.pointerId, layerId: layer.id, channel, selection,
      cut, bounds: rect, start: point, dx: 0, dy: 0,
    }
  }

  const finishRasterMove = () => {
    const move = rasterMoveRef.current
    if (!move) return
    rasterMoveRef.current = null
    const { layers, doc } = propsRef.current
    const layer = layers.find(item => item.id === move.layerId)
    if (!layer) {
      releaseBuffer(beforeRef)
      releaseBuffer(previewRef)
      releaseBuffer(maskPreviewRef)
      return
    }
    if (Math.abs(move.dx) < 0.001 && Math.abs(move.dy) < 0.001) {
      releaseBuffer(beforeRef)
      releaseBuffer(previewRef)
      releaseBuffer(maskPreviewRef)
      scheduleRender()
      return
    }
    const canvas = channelCanvas(layer, move.channel)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.save()
    clipToSelection(ctx, move.selection, doc.width, doc.height)
    ctx.clearRect(0, 0, doc.width, doc.height)
    ctx.restore()
    ctx.drawImage(move.cut, move.bounds.x + move.dx, move.bounds.y + move.dy)
    const minX = clamp(Math.floor(Math.min(move.bounds.x, move.bounds.x + move.dx)), 0, doc.width - 1)
    const minY = clamp(Math.floor(Math.min(move.bounds.y, move.bounds.y + move.dy)), 0, doc.height - 1)
    const maxX = clamp(Math.ceil(Math.max(move.bounds.x + move.bounds.width, move.bounds.x + move.dx + move.bounds.width)), minX + 1, doc.width)
    const maxY = clamp(Math.ceil(Math.max(move.bounds.y + move.bounds.height, move.bounds.y + move.dy + move.bounds.height)), minY + 1, doc.height)
    const rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    const before = obtainBuffer(beforeRef).getContext('2d', { willReadFrequently: true })!.getImageData(rect.x, rect.y, rect.width, rect.height)
    const after = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
    if (move.channel === 'mask') layer.maskVersion = (layer.maskVersion ?? 0) + 1
    else { layer.pixelVersion += 1; layer.filterKey = undefined }
    pushHistory({ kind: 'raster', layerId: layer.id, channel: move.channel, rect, before, after })
    releaseBuffer(beforeRef)
    releaseBuffer(previewRef)
    releaseBuffer(maskPreviewRef)
    propsRef.current.onSelectionChange({
      ...move.selection,
      points: move.selection.points.map(([x, y]) => [x + move.dx, y + move.dy]),
    })
    propsRef.current.onMutated()
    scheduleRender()
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    ensureBuffers()
    const {
      tool, stylusOnly, layers, activeLayerId, brush, color, view, flipped, doc,
      symmetry, radialCount, maskEditing, selection, areaShape, shapeKind,
    } = propsRef.current
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvasRef.current?.setPointerCapture(event.pointerId)

    if (pointersRef.current.size === 2) {
      if (objectDragRef.current) {
        const drag = objectDragRef.current
        const layer = layers.find(item => item.id === drag.layerId)
        if (layer) { layer.objects = cloneObjects(drag.before); renderVectorLayer(layer) }
        objectDragRef.current = null
      }
      currentRef.current = null
      rasterMoveRef.current = null
      selectionDraftRef.current = null
      releaseBuffer(strokeRef)
      releaseBuffer(beforeRef)
      releaseBuffer(previewRef)
      releaseBuffer(maskPreviewRef)
      const [a, b] = [...pointersRef.current.values()]
      const viewport = viewportRef.current!.getBoundingClientRect()
      const midX = (a.x + b.x) / 2 - viewport.left
      const midY = (a.y + b.y) / 2 - viewport.top
      const localX = (midX - view.panX) / view.zoom
      pinchRef.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom,
        docX: flipped ? doc.width - localX : localX, docY: (midY - view.panY) / view.zoom,
      }
      scheduleRender()
      return
    }
    if (pinchRef.current) return
    if (tool === 'pan' || event.button === 1 || event.button === 2) {
      panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY }
      return
    }
    if (stylusOnly && event.pointerType === 'touch') return
    const point = clientToDoc(event.clientX, event.clientY)
    if (tool === 'picker') {
      const ctx = canvasRef.current!.getContext('2d', { willReadFrequently: true })!
      const pixelX = clamp(Math.floor(point[0]), 0, doc.width - 1)
      const pixelY = clamp(Math.floor(point[1]), 0, doc.height - 1)
      const pixel = ctx.getImageData(pixelX, pixelY, 1, 1).data
      propsRef.current.onPickColor(`#${[pixel[0], pixel[1], pixel[2]].map(value => value.toString(16).padStart(2, '0')).join('')}`)
      return
    }
    if (tool === 'area' || tool === 'lasso') {
      const kind = tool === 'lasso' ? 'lasso' : areaShape
      selectionDraftRef.current = { pointerId: event.pointerId, selection: { kind, points: [[point[0], point[1]]] } }
      scheduleRender()
      return
    }
    const layer = layers.find(item => item.id === activeLayerId)
    if (!layer || layer.locked || !layer.visible) {
      propsRef.current.onNotice('Выберите видимый незаблокированный слой')
      return
    }
    if (tool === 'pen') {
      if (layer.kind !== 'vector' || maskEditing) {
        propsRef.current.onNotice('Перьевой контур создаётся на векторном слое')
        return
      }
      if (event.detail <= 1) {
        penDraftRef.current.push(point)
        scheduleRender()
      }
      return
    }
    if (tool === 'object') {
      if (layer.kind === 'vector' && !maskEditing) startObjectDrag(event, point)
      else if (selection) startRasterMove(event, point)
      else propsRef.current.onNotice('Создайте выделение или выберите векторный слой')
      return
    }
    if (tool === 'fill') {
      if (layer.kind === 'vector' && !maskEditing) {
        propsRef.current.onNotice('Заливка работает на растровом слое или маске')
        return
      }
      const channel = maskEditing ? 'mask' : 'content'
      const canvas = channelCanvas(layer, channel)
      if (!canvas) return
      const before = obtainBuffer(beforeRef)
      const beforeCtx = before.getContext('2d', { willReadFrequently: true })!
      beforeCtx.clearRect(0, 0, doc.width, doc.height)
      beforeCtx.drawImage(canvas, 0, 0)
      const rect = floodFill(canvas, point[0], point[1], maskEditing ? '#ffffff' : color, selection)
      if (rect) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!
        const beforeData = beforeCtx.getImageData(rect.x, rect.y, rect.width, rect.height)
        const afterData = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
        if (maskEditing) layer.maskVersion = (layer.maskVersion ?? 0) + 1
        else { layer.pixelVersion += 1; layer.filterKey = undefined }
        pushHistory({ kind: 'raster', layerId: layer.id, channel, rect, before: beforeData, after: afterData })
        releaseBuffer(beforeRef)
        propsRef.current.onMutated()
        scheduleRender()
      } else {
        releaseBuffer(beforeRef)
      }
      return
    }
    if (!['brush', 'eraser', 'line', 'shape'].includes(tool)) return
    if (maskEditing && !layer.mask) {
      propsRef.current.onNotice('Сначала добавьте маску слою')
      return
    }
    if (layer.kind === 'vector' && !maskEditing && tool === 'eraser') {
      propsRef.current.onNotice('На векторном слое удалите объект инструментом «Объект»')
      return
    }
    if (tool === 'shape' && (layer.kind !== 'vector' || maskEditing)) {
      propsRef.current.onNotice('Фигуры создаются на векторном слое')
      return
    }
    const channel = maskEditing ? 'mask' : 'content'
    const source = channelCanvas(layer, channel)
    const before = obtainBuffer(beforeRef)
    const beforeCtx = before.getContext('2d', { willReadFrequently: true })!
    beforeCtx.clearRect(0, 0, before.width, before.height)
    beforeCtx.drawImage(source, 0, 0)
    const pen = event.pointerType === 'pen'
    point[2] = pen ? event.pressure || 0.5 : 0.5
    const eraser = tool === 'eraser'
    currentRef.current = new StrokeSession({
      pointerId: event.pointerId, layerId: layer.id, channel, point, pen, doc,
      color: maskEditing ? '#ffffff' : color, eraser, line: tool === 'line',
      shape: tool === 'shape' ? shapeKind : undefined,
      vector: layer.kind === 'vector' && !maskEditing,
      symmetry, radialCount,
      brush: eraser ? {
        ...brush, id: 'traditional', opacity: 1, passes: 1, jitter: 0, size: brush.size * 1.35,
        thinning: 0, taperStart: 0, taperEnd: 0, pressureCurve: 'linear',
      } : { ...brush },
    })
    redrawCurrent(false)
    scheduleRender()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cursor = cursorRef.current
    if (cursor && event.pointerType !== 'touch') {
      const bounds = viewportRef.current!.getBoundingClientRect()
      const size = clamp(propsRef.current.brush.size * propsRef.current.view.zoom, 8, 320)
      cursor.style.display = ['brush', 'eraser', 'line', 'fill'].includes(propsRef.current.tool) ? 'block' : 'none'
      cursor.style.width = `${size}px`; cursor.style.height = `${size}px`
      cursor.style.transform = `translate(${event.clientX - bounds.left - size / 2}px, ${event.clientY - bounds.top - size / 2}px)`
    }
    if (pointersRef.current.has(event.pointerId)) pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()]
      const pinch = pinchRef.current
      const viewport = viewportRef.current!.getBoundingClientRect()
      const midX = (a.x + b.x) / 2 - viewport.left
      const midY = (a.y + b.y) / 2 - viewport.top
      const distance = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y))
      const zoom = clamp(pinch.zoom * distance / Math.max(10, pinch.distance), 0.03, 8)
      const { flipped, doc } = propsRef.current
      const visualDocX = flipped ? doc.width - pinch.docX : pinch.docX
      propsRef.current.onViewChange({ zoom, panX: midX - visualDocX * zoom, panY: midY - pinch.docY * zoom })
      return
    }
    if (panRef.current?.pointerId === event.pointerId) {
      const pan = panRef.current
      propsRef.current.onViewChange({ ...propsRef.current.view, panX: pan.panX + event.clientX - pan.x, panY: pan.panY + event.clientY - pan.y })
      return
    }
    const point = clientToDoc(event.clientX, event.clientY)
    if (objectDragRef.current?.pointerId === event.pointerId) {
      moveObjectDrag(point)
      return
    }
    if (rasterMoveRef.current?.pointerId === event.pointerId) {
      const move = rasterMoveRef.current
      move.dx = point[0] - move.start[0]
      move.dy = point[1] - move.start[1]
      scheduleRender()
      return
    }
    if (selectionDraftRef.current?.pointerId === event.pointerId) {
      const selection = selectionDraftRef.current.selection
      if (selection.kind === 'lasso') {
        const last = selection.points[selection.points.length - 1]
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 1) selection.points.push([point[0], point[1]])
      } else {
        if (selection.points.length === 1) selection.points.push([point[0], point[1]])
        else selection.points[1] = [point[0], point[1]]
      }
      scheduleRender()
      return
    }
    const current = currentRef.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
    for (const sample of events) {
      const samplePoint = clientToDoc(sample.clientX, sample.clientY)
      samplePoint[2] = current.pen ? sample.pressure || 0.5 : 0.5
      current.addPoint(samplePoint)
    }
    redrawCurrent(false)
    scheduleRender()
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) pinchRef.current = null
      return
    }
    if (panRef.current?.pointerId === event.pointerId) {
      panRef.current = null
      return
    }
    if (objectDragRef.current?.pointerId === event.pointerId) finishObjectDrag()
    if (rasterMoveRef.current?.pointerId === event.pointerId) finishRasterMove()
    if (selectionDraftRef.current?.pointerId === event.pointerId) {
      const draft = selectionDraftRef.current.selection
      selectionDraftRef.current = null
      const valid = draft.kind === 'lasso'
        ? draft.points.length >= 3
        : draft.points.length >= 2 && Math.hypot(draft.points[1][0] - draft.points[0][0], draft.points[1][1] - draft.points[0][1]) > 2
      propsRef.current.onSelectionChange(valid ? draft : null)
    }
    if (currentRef.current?.pointerId === event.pointerId) finishStroke()
    scheduleRender()
  }

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    const { view, flipped, doc } = propsRef.current
    const bounds = viewportRef.current!.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const localX = (x - view.panX) / view.zoom
    const docX = flipped ? doc.width - localX : localX
    const docY = (y - view.panY) / view.zoom
    const zoom = clamp(view.zoom * Math.exp(-event.deltaY * 0.0012), 0.03, 8)
    const visualDocX = flipped ? doc.width - docX : docX
    propsRef.current.onViewChange({ zoom, panX: x - visualDocX * zoom, panY: y - docY * zoom })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  const { doc, view, tool, flipped } = props
  return (
    <div
      ref={viewportRef}
      className={`studio-viewport tool-${tool}`}
      onContextMenu={event => event.preventDefault()}
      onPointerLeave={() => { if (cursorRef.current) cursorRef.current.style.display = 'none' }}
    >
      <div className="document-transform" style={{ transform: `translate3d(${view.panX}px, ${view.panY}px, 0)` }}>
        <canvas
          ref={canvasRef}
          width={doc.width}
          height={doc.height}
          className={`drawing-canvas ${flipped ? 'is-flipped' : ''}`}
          style={{ width: doc.width * view.zoom, height: doc.height * view.zoom }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={event => { if (propsRef.current.tool === 'pen') { event.preventDefault(); commitPen(false) } }}
          aria-label="Холст профессионального tattoo-линворка"
          tabIndex={0}
        />
      </div>
      <div ref={cursorRef} className="brush-cursor" />
      <div className="canvas-document-label">
        {doc.width} × {doc.height} px · {(doc.width / doc.dpi * 25.4).toFixed(1)} × {(doc.height / doc.dpi * 25.4).toFixed(1)} мм · {doc.dpi} dpi
      </div>
    </div>
  )
})
