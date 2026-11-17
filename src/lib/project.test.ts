import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayerModel } from '../types'
import { disposeLayerCanvases, makeCanvas } from './project'

// Node environment has no DOM: use a minimal canvas stub so laziness is
// verified by counting real getContext calls, not by assuming jsdom behavior.
class FakeCanvas {
  width: number
  height: number
  contextCalls = 0
  constructor(width = 0, height = 0) {
    this.width = width
    this.height = height
  }

  getContext() {
    this.contextCalls += 1
    return null
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
