import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocModel, LayerModel, VectorObject } from '../types'
import { disposeLayerCanvases, makeCanvas, snapshotProject } from './project'
import { isPristineEmptyLayer, renderVectorLayer } from './vector'

// Node environment has no DOM: use a minimal canvas stub so laziness is
// verified by counting real getContext calls, not by assuming jsdom behavior.
class FakeContext {
  clearRect = vi.fn()
}

class FakeCanvas {
  width: number
  height: number
  contextCalls = 0
  contexts: FakeContext[] = []
  toDataURL = vi.fn(() => 'data:image/png;base64,fake')
  constructor(width = 0, height = 0) {
    this.width = width
    this.height = height
  }

  getContext() {
    this.contextCalls += 1
    const context = new FakeContext()
    this.contexts.push(context)
    return context as unknown as CanvasRenderingContext2D
  }

  get lastContext() {
    return this.contexts[this.contexts.length - 1]
  }
}

const created: FakeCanvas[] = []

function stubDocument() {
  created.length = 0
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`)
      const canvas = new FakeCanvas()
      created.push(canvas)
      return canvas
    },
  })
}

function asCanvas(canvas: FakeCanvas) {
  return canvas as unknown as HTMLCanvasElement
}

function fakeLayer(partial: Partial<LayerModel> = {}): LayerModel {
  return {
    id: 'layer', name: 'L', kind: 'paint', visible: true, locked: false, opacity: 1,
    blend: 'source-over', canvas: asCanvas(new FakeCanvas(2048, 2048)), pixelVersion: 0,
    ...partial,
  }
}

const doc: DocModel = { width: 2048, height: 2048, title: 'Проект', dpi: 300 }

const vectorObject: VectorObject = {
  id: 'v-1', kind: 'stroke', points: [[10, 10, 0.5], [20, 20, 0.5]],
  brush: {
    id: 'fineline', name: 'Fineline', family: 'f', size: 3, opacity: 1, thinning: 0,
    streamline: 0, smoothing: 0, taperStart: 0, taperEnd: 0, pressureCurve: 'linear',
    passes: 1, jitter: 0,
  },
  color: '#000000', pen: false, transform: { x: 0, y: 0, scale: 1, rotation: 0 },
}

afterEach(() => { vi.unstubAllGlobals() })

describe('makeCanvas', () => {
  it('sets dimensions without eagerly creating a 2d context', () => {
    stubDocument()
    const canvas = makeCanvas(4096, 4096) as unknown as FakeCanvas
    expect(canvas.width).toBe(4096)
    expect(canvas.height).toBe(4096)
    expect(canvas.contextCalls).toBe(0)
  })
})

describe('disposeLayerCanvases', () => {
  it('shrinks canvas/mask/filterCache to 1x1, keeps references, clears PNG caches', () => {
    const canvas = new FakeCanvas(4096, 4096)
    const mask = new FakeCanvas(4096, 4096)
    const filterCache = new FakeCanvas(4096, 4096)
    const layer = fakeLayer({
      canvas: asCanvas(canvas), mask: asCanvas(mask), filterCache: asCanvas(filterCache),
      dataCache: { version: 3, data: 'data:image/png;base64,a' },
      maskCache: { version: 1, data: 'data:image/png;base64,b' },
    })
    disposeLayerCanvases([layer])
    expect(canvas.width).toBe(1)
    expect(canvas.height).toBe(1)
    expect(mask.width).toBe(1)
    expect(mask.height).toBe(1)
    expect(filterCache.width).toBe(1)
    expect(filterCache.height).toBe(1)
    // LayerModel requires canvas: the reference stays, only the backing store shrinks.
    expect(layer.canvas).toBe(asCanvas(canvas))
    expect(layer.dataCache).toBeUndefined()
    expect(layer.maskCache).toBeUndefined()
  })

  it('accepts a single layer and leaves layers outside the call untouched', () => {
    const disposed = fakeLayer()
    const kept = fakeLayer()
    disposeLayerCanvases(disposed)
    expect((disposed.canvas as unknown as FakeCanvas).width).toBe(1)
    expect((kept.canvas as unknown as FakeCanvas).width).toBe(2048)
    expect(kept.dataCache).toBeUndefined()
  })

  it('tolerates layers without mask, filter cache or PNG caches', () => {
    const layer = fakeLayer()
    expect(() => disposeLayerCanvases([layer])).not.toThrow()
    expect((layer.canvas as unknown as FakeCanvas).width).toBe(1)
  })
})

describe('isPristineEmptyLayer', () => {
  it('treats a fresh blank paint layer as pristine', () => {
    expect(isPristineEmptyLayer(fakeLayer())).toBe(true)
  })

  it('rejects paint layers with pixels, data cache or source', () => {
    expect(isPristineEmptyLayer(fakeLayer({ pixelVersion: 1 }))).toBe(false)
    expect(isPristineEmptyLayer(fakeLayer({
      dataCache: { version: 0, data: 'data:image/png;base64,fake' },
    }))).toBe(false)
    expect(isPristineEmptyLayer(fakeLayer({ source: 'data:image/png;base64,src' }))).toBe(false)
  })

  it('treats a fresh empty vector layer as pristine but not one with objects', () => {
    expect(isPristineEmptyLayer(fakeLayer({ kind: 'vector', objects: [] }))).toBe(true)
    expect(isPristineEmptyLayer(fakeLayer({ kind: 'vector', objects: [vectorObject] }))).toBe(false)
    expect(isPristineEmptyLayer(fakeLayer({
      kind: 'vector', objects: [], pixelVersion: 2,
    }))).toBe(false)
  })

  it('never treats image layers as pristine', () => {
    expect(isPristineEmptyLayer(fakeLayer({ kind: 'image' }))).toBe(false)
  })
})

describe('snapshotProject pristine blank handling', () => {
  it('writes data "" for a blank layer without calling toDataURL and drops dataCache', () => {
    stubDocument()
    const canvas = new FakeCanvas(2048, 2048)
    const layer = fakeLayer({ canvas: asCanvas(canvas) })
    const snapshot = snapshotProject(doc, [layer], layer.id)
    expect(snapshot.layers[0].data).toBe('')
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    expect(layer.dataCache).toBeUndefined()
    expect(layer.pixelVersion).toBe(0)
  })

  it('serializes a content layer via toDataURL and caches it', () => {
    stubDocument()
    const canvas = new FakeCanvas(2048, 2048)
    const layer = fakeLayer({ canvas: asCanvas(canvas), pixelVersion: 2 })
    const snapshot = snapshotProject(doc, [layer], layer.id)
    expect(canvas.toDataURL).toHaveBeenCalledTimes(1)
    expect(snapshot.layers[0].data).toBe('data:image/png;base64,fake')
    expect(layer.dataCache).toEqual({ version: 2, data: 'data:image/png;base64,fake' })
  })

  it('keeps the blank serialization stable on repeated snapshots', () => {
    stubDocument()
    const layer = fakeLayer()
    const first = snapshotProject(doc, [layer], layer.id)
    const second = snapshotProject(doc, [layer], layer.id)
    expect(first.layers[0].data).toBe('')
    expect(second.layers[0].data).toBe('')
    expect((layer.canvas as unknown as FakeCanvas).toDataURL).not.toHaveBeenCalled()
  })
})

describe('renderVectorLayer lazy clear', () => {
  it('does not touch the canvas for a fresh empty vector layer', () => {
    const canvas = new FakeCanvas(2048, 2048)
    const layer = fakeLayer({ kind: 'vector', canvas: asCanvas(canvas), objects: [] })
    renderVectorLayer(layer)
    expect(canvas.contextCalls).toBe(0)
    expect(layer.pixelVersion).toBe(0)
  })

  it('clears the canvas when objects were removed after content existed', () => {
    const canvas = new FakeCanvas(2048, 2048)
    const layer = fakeLayer({ kind: 'vector', canvas: asCanvas(canvas), objects: [], pixelVersion: 1 })
    renderVectorLayer(layer)
    expect(canvas.contextCalls).toBe(1)
    expect(canvas.lastContext.clearRect).toHaveBeenCalledTimes(1)
    expect(layer.pixelVersion).toBe(2)
  })
})
