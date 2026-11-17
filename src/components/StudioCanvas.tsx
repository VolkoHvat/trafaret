import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import type { BrushConfig, DocModel, LayerModel, ToolId, ViewState } from '../types'
import { renderStroke, type StrokePoint } from '../lib/brushes'
import { getLayerRenderCanvas, makeCanvas } from '../lib/project'

export interface StudioHandle {
  undo: () => void
  redo: () => void
  clearActive: () => void
  fitView: () => void
  exportImage: (transparent: boolean, stencil: boolean) => Promise<Blob>
  historyPixels: () => number
}

interface Props {
  doc: DocModel
  layers: LayerModel[]
  activeLayerId: string
  tool: ToolId
  brush: BrushConfig
  color: string
  symmetry: boolean
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
}

interface CurrentStroke {
  pointerId: number
  points: StrokePoint[]
  pen: boolean
  brush: BrushConfig
  color: string
  eraser: boolean
  line: boolean
}

interface Rect { x: number; y: number; width: number; height: number }
interface HistoryEntry { layerId: string; rect: Rect; before: ImageData; after: ImageData }

const MAX_HISTORY_PIXELS = 24_000_000
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const StudioCanvas = forwardRef<StudioHandle, Props>(function StudioCanvas(props, ref) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const strokeRef = useRef<HTMLCanvasElement | null>(null)
  const beforeRef = useRef<HTMLCanvasElement | null>(null)
  const previewRef = useRef<HTMLCanvasElement | null>(null)
  const composeRef = useRef<HTMLCanvasElement | null>(null)
  const currentRef = useRef<CurrentStroke | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ distance: number; zoom: number; docX: number; docY: number } | null>(null)
  const panRef = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null)
  const historyRef = useRef<HistoryEntry[]>([])
  const redoRef = useRef<HistoryEntry[]>([])
  const historySizeRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const propsRef = useRef(props)
  useLayoutEffect(() => {
    propsRef.current = props
  })

  const ensureBuffers = useCallback(() => {
    const { width, height } = propsRef.current.doc
    canvasRef.current?.getContext('2d', { willReadFrequently: true })
    for (const key of [strokeRef, beforeRef, previewRef, composeRef]) {
      if (!key.current) key.current = makeCanvas(width, height)
      if (key.current.width !== width || key.current.height !== height) {
        key.current.width = width
        key.current.height = height
      }
    }
  }, [])

  const updateHistoryState = useCallback(() => {
    propsRef.current.onHistoryChange(historyRef.current.length > 0, redoRef.current.length > 0)
  }, [])

  const composeTo = useCallback((target: HTMLCanvasElement, background: boolean, stencilMode: boolean) => {
    ensureBuffers()
    const { doc, layers, activeLayerId, symmetry } = propsRef.current
    const ctx = target.getContext('2d')!
    ctx.clearRect(0, 0, target.width, target.height)
    if (background) {
      ctx.fillStyle = stencilMode ? '#f7f6f0' : '#f3f1e9'
      ctx.fillRect(0, 0, target.width, target.height)
    }
    const current = currentRef.current
    for (const layer of layers) {
      if (!layer.visible) continue
      let source = getLayerRenderCanvas(layer)
      if (current && layer.id === activeLayerId) {
        const preview = previewRef.current!
        const pctx = preview.getContext('2d')!
        pctx.clearRect(0, 0, doc.width, doc.height)
        pctx.drawImage(source, 0, 0)
        pctx.save()
        pctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
        pctx.drawImage(strokeRef.current!, 0, 0)
        pctx.restore()
        source = preview
      }
      ctx.save()
      ctx.globalAlpha = layer.opacity
      ctx.globalCompositeOperation = layer.blend
      if (stencilMode) ctx.filter = 'grayscale(1) contrast(1.55)'
      ctx.drawImage(source, 0, 0)
      ctx.restore()
    }
    void symmetry
  }, [ensureBuffers])

  const renderNow = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const canvas = canvasRef.current
    if (!canvas) return
    composeTo(canvas, true, propsRef.current.stencil)
  }, [composeTo])

  const scheduleRender = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(renderNow)
  }, [renderNow])

  useEffect(() => {
    ensureBuffers()
    scheduleRender()
  }, [props.layers, props.doc, props.stencil, props.renderToken, ensureBuffers, scheduleRender])

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  const pushHistory = useCallback((entry: HistoryEntry) => {
    historyRef.current.push(entry)
    historySizeRef.current += entry.rect.width * entry.rect.height
    while (historySizeRef.current > MAX_HISTORY_PIXELS && historyRef.current.length > 1) {
      const removed = historyRef.current.shift()!
      historySizeRef.current -= removed.rect.width * removed.rect.height
    }
    redoRef.current = []
    updateHistoryState()
  }, [updateHistoryState])

  const restoreHistory = useCallback((entry: HistoryEntry, side: 'before' | 'after') => {
    const layer = propsRef.current.layers.find((item) => item.id === entry.layerId)
    if (!layer) return
    const { rect } = entry
    layer.canvas.getContext('2d')!.putImageData(entry[side], rect.x, rect.y)
    layer.filterKey = undefined
    propsRef.current.onMutated()
    scheduleRender()
  }, [scheduleRender])

  useImperativeHandle(ref, () => ({
    undo: () => {
      const entry = historyRef.current.pop()
      if (!entry) return
      historySizeRef.current -= entry.rect.width * entry.rect.height
      redoRef.current.push(entry)
      restoreHistory(entry, 'before')
      updateHistoryState()
    },
    redo: () => {
      const entry = redoRef.current.pop()
      if (!entry) return
      historyRef.current.push(entry)
      historySizeRef.current += entry.rect.width * entry.rect.height
      restoreHistory(entry, 'after')
      updateHistoryState()
    },
    clearActive: () => {
      const layer = propsRef.current.layers.find((item) => item.id === propsRef.current.activeLayerId)
      if (!layer || layer.locked) {
        propsRef.current.onNotice('Выберите незаблокированный слой')
        return
      }
      const { width, height } = propsRef.current.doc
      const ctx = layer.canvas.getContext('2d')!
      const before = ctx.getImageData(0, 0, width, height)
      ctx.clearRect(0, 0, width, height)
      const after = ctx.getImageData(0, 0, width, height)
      pushHistory({ layerId: layer.id, rect: { x: 0, y: 0, width, height }, before, after })
      propsRef.current.onMutated()
      scheduleRender()
    },
    fitView: () => {
      const viewport = viewportRef.current
      if (!viewport) return
      const { doc, view } = propsRef.current
      const zoom = clamp(Math.min((viewport.clientWidth - 72) / doc.width, (viewport.clientHeight - 72) / doc.height), 0.03, 1.5)
      propsRef.current.onViewChange({
        zoom,
        panX: (viewport.clientWidth - doc.width * zoom) / 2,
        panY: (viewport.clientHeight - doc.height * zoom) / 2,
      })
      void view
    },
    exportImage: async (transparent: boolean, stencilMode: boolean) => {
      const { doc } = propsRef.current
      const output = makeCanvas(doc.width, doc.height)
      composeTo(output, !transparent, stencilMode)
      if (stencilMode) {
        const ctx = output.getContext('2d')!
        const image = ctx.getImageData(0, 0, output.width, output.height)
        for (let i = 0; i < image.data.length; i += 4) {
          const gray = image.data[i] * 0.2126 + image.data[i + 1] * 0.7152 + image.data[i + 2] * 0.0722
          const value = gray >= 185 ? 255 : 0
          image.data[i] = value
          image.data[i + 1] = value
          image.data[i + 2] = value
        }
        ctx.putImageData(image, 0, 0)
      }
      return new Promise<Blob>((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Экспорт не удался')), 'image/png'))
    },
    historyPixels: () => historySizeRef.current,
  }), [composeTo, pushHistory, restoreHistory, scheduleRender, updateHistoryState])

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
    const { doc, symmetry } = propsRef.current
    const canvas = strokeRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, doc.width, doc.height)
    renderStroke(ctx, current.points, current.brush, current.color, complete, current.pen)
    if (symmetry) {
      const mirrored = current.points.map(([x, y, p]) => [doc.width - x, y, p] as StrokePoint)
      renderStroke(ctx, mirrored, current.brush, current.color, complete, current.pen)
    }
  }, [])

  const finishStroke = useCallback(() => {
    const current = currentRef.current
    if (!current) return
    const { doc, layers, activeLayerId, symmetry } = propsRef.current
    const layer = layers.find((item) => item.id === activeLayerId)
    if (!layer) return
    redrawCurrent(true)
    const ctx = layer.canvas.getContext('2d')!
    ctx.save()
    ctx.globalCompositeOperation = current.eraser ? 'destination-out' : 'source-over'
    ctx.drawImage(strokeRef.current!, 0, 0)
    ctx.restore()
    layer.filterKey = undefined

    const allPoints = symmetry
      ? [...current.points, ...current.points.map(([x, y, p]) => [doc.width - x, y, p] as StrokePoint)]
      : current.points
    const pad = current.brush.size * 2 + 20
    const minX = clamp(Math.floor(Math.min(...allPoints.map((p) => p[0])) - pad), 0, doc.width - 1)
    const minY = clamp(Math.floor(Math.min(...allPoints.map((p) => p[1])) - pad), 0, doc.height - 1)
    const maxX = clamp(Math.ceil(Math.max(...allPoints.map((p) => p[0])) + pad), minX + 1, doc.width)
    const maxY = clamp(Math.ceil(Math.max(...allPoints.map((p) => p[1])) + pad), minY + 1, doc.height)
    const rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    const before = beforeRef.current!.getContext('2d')!.getImageData(rect.x, rect.y, rect.width, rect.height)
    const after = ctx.getImageData(rect.x, rect.y, rect.width, rect.height)
    pushHistory({ layerId: layer.id, rect, before, after })
    currentRef.current = null
    strokeRef.current!.getContext('2d')!.clearRect(0, 0, doc.width, doc.height)
    propsRef.current.onMutated()
    scheduleRender()
  }, [pushHistory, redrawCurrent, scheduleRender])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const { tool, stylusOnly, layers, activeLayerId, brush, color, view, flipped, doc } = propsRef.current
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    canvasRef.current?.setPointerCapture(event.pointerId)

    if (pointersRef.current.size === 2) {
      currentRef.current = null
      strokeRef.current?.getContext('2d')?.clearRect(0, 0, propsRef.current.doc.width, propsRef.current.doc.height)
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
      const ctx = canvasRef.current!.getContext('2d')!
      const pixel = ctx.getImageData(Math.floor(point[0]), Math.floor(point[1]), 1, 1).data
      propsRef.current.onPickColor(`#${[pixel[0], pixel[1], pixel[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`)
      return
    }
    if (!['brush', 'eraser', 'line'].includes(tool)) return
    const layer = layers.find((item) => item.id === activeLayerId)
    if (!layer || layer.locked || !layer.visible) {
      propsRef.current.onNotice('Выберите видимый незаблокированный слой')
      return
    }
    const before = beforeRef.current!
    before.getContext('2d')!.clearRect(0, 0, before.width, before.height)
    before.getContext('2d')!.drawImage(layer.canvas, 0, 0)
    const pen = event.pointerType === 'pen'
    point[2] = pen ? event.pressure || 0.5 : 0.5
    const eraser = tool === 'eraser'
    currentRef.current = {
      pointerId: event.pointerId, points: [point], pen, color, eraser, line: tool === 'line',
      brush: eraser ? { ...brush, id: 'traditional', opacity: 1, passes: 1, jitter: 0, size: brush.size * 1.35 } : brush,
    }
    redrawCurrent(false)
    scheduleRender()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const cursor = cursorRef.current
    if (cursor && event.pointerType !== 'touch') {
      const bounds = viewportRef.current!.getBoundingClientRect()
      const size = clamp(propsRef.current.brush.size * propsRef.current.view.zoom, 8, 320)
      cursor.style.display = ['brush', 'eraser', 'line'].includes(propsRef.current.tool) ? 'block' : 'none'
      cursor.style.width = `${size}px`
      cursor.style.height = `${size}px`
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
    const current = currentRef.current
    if (!current || current.pointerId !== event.pointerId) return
    event.preventDefault()
    const events = event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]
    for (const sample of events) {
      const point = clientToDoc(sample.clientX, sample.clientY)
      point[2] = current.pen ? sample.pressure || 0.5 : 0.5
      if (current.line) {
        if (current.points.length === 1) current.points.push(point)
        else current.points[1] = point
      } else {
        const last = current.points[current.points.length - 1]
        if (Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.25) current.points.push(point)
      }
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
    if (currentRef.current?.pointerId === event.pointerId) finishStroke()
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

  const { doc, view, tool, symmetry, flipped } = props
  return (
    <div
      ref={viewportRef}
      className={`studio-viewport tool-${tool}`}
      onContextMenu={(event) => event.preventDefault()}
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
          aria-label="Холст для рисования tattoo-эскиза"
        />
        {symmetry && <div className="symmetry-guide" style={{ left: doc.width * view.zoom / 2, height: doc.height * view.zoom }} />}
      </div>
      <div ref={cursorRef} className="brush-cursor" />
      <div className="canvas-document-label">{doc.width} × {doc.height} px</div>
    </div>
  )
})
