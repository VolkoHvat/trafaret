import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DocModel, LayerModel } from '../types'
import { Compositor } from './compositor'

class FakeContext {
  clearRect = vi.fn()
  fillRect = vi.fn()
  save = vi.fn()
  restore = vi.fn()
  scale = vi.fn()
  drawImage = vi.fn()
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  fillStyle = ''
  filter = 'none'
}

class FakeCanvas {
  width: number
  height: number
  context = new FakeContext()
  constructor(width = 100, height = 100) {
    this.width = width
    this.height = height
  }
  getContext() { return this.context as unknown as CanvasRenderingContext2D }
}

const doc: DocModel = { width: 100, height: 100, title: 'Test', dpi: 300 }
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

function layer(id: string, partial: Partial<LayerModel> = {}): LayerModel {
  return {
    id, name: id, kind: 'paint', visible: true, locked: false, opacity: 1,
    blend: 'source-over', canvas: asCanvas(new FakeCanvas()), pixelVersion: 1,
    ...partial,
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('Compositor', () => {
  it('draws visible layers in order with document scale and background', () => {
    const first = layer('first')
    const second = layer('second', { opacity: 0.5, blend: 'multiply' })
    const hidden = layer('hidden', { visible: false })
    const target = new FakeCanvas(50, 50)

    new Compositor().compose({
      target: asCanvas(target), doc, layers: [first, second, hidden], activeLayerId: 'first',
      background: true, stencilMode: false, scale: 0.5,
    })

    expect(target.context.fillRect).toHaveBeenCalledWith(0, 0, 50, 50)
    expect(target.context.scale).toHaveBeenCalledWith(0.5, 0.5)
    expect(target.context.drawImage.mock.calls.map(call => call[0])).toEqual([first.canvas, second.canvas])
  })

  it('composites a live preview even on a pristine layer', () => {
    stubDocument()
    const pristine = layer('pristine', { pixelVersion: 0 })
    const stroke = new FakeCanvas()
    const target = new FakeCanvas()

    new Compositor().compose({
      target: asCanvas(target), doc, layers: [pristine], activeLayerId: 'pristine',
      background: false, stencilMode: false,
      current: { layerId: 'pristine', channel: 'content', eraser: false, canvas: asCanvas(stroke) },
    })

    expect(created).toHaveLength(0)
    expect(target.context.drawImage.mock.calls).toEqual([[asCanvas(stroke), 0, 0]])
  })

  it('keeps the preview grouped before applying the layer mask', () => {
    stubDocument()
    const masked = layer('masked', { mask: asCanvas(new FakeCanvas()) })
    const target = new FakeCanvas(), stroke = asCanvas(new FakeCanvas())
    new Compositor().compose({
      target: asCanvas(target), doc, layers: [masked], activeLayerId: masked.id,
      background: true, stencilMode: false,
      current: { layerId: masked.id, channel: 'content', eraser: false, canvas: stroke },
    })
    expect(created).toHaveLength(2)
    expect(created[0].context.drawImage.mock.calls.map(call => call[0])).toEqual([masked.canvas, stroke])
    expect(created[1].context.drawImage.mock.calls.map(call => call[0])).toEqual([created[0], masked.mask])
    expect(target.context.drawImage).toHaveBeenCalledWith(created[1], 0, 0)
  })

  it('owns and releases clip-to-below buffers', () => {
    stubDocument()
    const lower = layer('lower')
    const upper = layer('upper', { clipToBelow: true })
    const compositor = new Compositor()

    compositor.compose({
      target: asCanvas(new FakeCanvas()), doc, layers: [lower, upper], activeLayerId: 'upper',
      background: false, stencilMode: false,
    })

    expect(created.length).toBeGreaterThan(0)
    expect(created.every(canvas => canvas.width === 100 && canvas.height === 100)).toBe(true)
    compositor.release()
    expect(created.every(canvas => canvas.width === 1 && canvas.height === 1)).toBe(true)
  })
})
