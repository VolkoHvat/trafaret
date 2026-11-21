import { describe, expect, it } from 'vitest'
import { PigmentField, pigmentBoundary } from './pigment'

describe('pigment field', () => {
  it('keeps arbitrary sRGB and opacity separately in sparse tiles', () => {
    const field = new PigmentField(40, 40)
    const delta = field.paint('line', [0, 33 * 40 + 33], { r: 0, g: 0, b: 0, opacity: 255 })
    expect(delta.tiles).toHaveLength(2)
    expect(field.get('line', 0)).toEqual({ r: 0, g: 0, b: 0, opacity: 255 })
    expect(field.get('line', 33 * 40 + 33)).toEqual({ r: 0, g: 0, b: 0, opacity: 255 })
    field.apply(delta, 'before')
    expect(field.get('line', 0)).toBeNull()
  })

  it('keeps line and fill independent and stencil side-effect free', () => {
    const field = new PigmentField(4, 4)
    field.paint('line', [5], { r: 255, g: 255, b: 255, opacity: 128 })
    const delta = field.paint('fill', [5], { r: 12, g: 34, b: 56, opacity: 200 }, 'stencil')
    expect(delta.tiles).toHaveLength(0)
    expect(field.get('line', 5)).toEqual({ r: 255, g: 255, b: 255, opacity: 128 })
    expect(field.get('fill', 5)).toBeNull()
  })

  it('previews bounded flood fill, reaches edge, and cancels without mutation', () => {
    const field = new PigmentField(5, 5)
    const fill = field.previewFill(12, pigmentBoundary(new Float64Array(25).fill(1), 'stencil', 64), 25)
    expect(fill.count).toBe(25)
    expect(fill.reachedEdge).toBe(true)
    fill.cancel()
    expect(field.get('fill', 12)).toBeNull()
  })

  it('commits and restores reversible deltas', () => {
    const field = new PigmentField(3, 3)
    const fill = field.previewFill(4, () => false)
    const delta = fill.commit({ r: 1, g: 2, b: 3, opacity: 255 })
    expect(field.get('fill', 4)).toEqual({ r: 1, g: 2, b: 3, opacity: 255 })
    field.apply(delta, 'before')
    expect(field.get('fill', 4)).toBeNull()
    field.apply(delta, 'after')
    expect(PigmentField.restore(JSON.parse(JSON.stringify(field.snapshot()))).snapshot()).toEqual(field.snapshot())
  })

  it('honors a density wall, keeps corners disconnected and freezes the preview', () => {
    const field = new PigmentField(5, 5), rho = new Float64Array(25).fill(0.5)
    for (const i of [12, 13, 18, 24]) rho[i] = 1
    const preview = field.previewFill(12, pigmentBoundary(rho))
    const pixels: number[] = []
    preview.forEach(i => pixels.push(i))
    expect(pixels).toEqual([12, 13, 18])
    expect(preview.reachedEdge).toBe(false)
    rho.fill(1)
    const color = { r: 255, g: 255, b: 255, opacity: 93 }
    field.paint('line', [13], color)
    expect(() => preview.commit(color)).toThrow()
    const next = field.previewFill(12, i => !pixels.includes(i))
    next.commit(color)
    expect(field.get('line', 13)).toEqual(color)
    expect(field.get('fill', 13)).toEqual(color)
    expect(field.get('fill', 24)).toBeNull()
  })

  it('refuses partial and cancelled regions and leaves a stencil fill unchanged', () => {
    const field = new PigmentField(2048, 2048), color = { r: 255, g: 255, b: 255, opacity: 255 }
    const limited = field.previewFill(0, () => false, 8)
    expect(limited.count).toBe(8)
    expect(limited.truncated).toBe(true)
    expect(() => limited.commit(color)).toThrow()
    const cancelled = field.previewFill(0, i => i !== 0, 1)
    cancelled.cancel()
    expect(() => cancelled.commit(color)).toThrow()
    field.previewFill(0, i => i !== 0, 1).commit(color, 'stencil')
    expect(field.snapshot().tiles).toHaveLength(0)
  })
})
