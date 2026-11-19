import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VectorObject } from '../types'
import {
  adjustWidthProfile, applyObjectTransform, baseObjectBounds, insertControlPoint, localPoint, moveControlHandle, moveControlPoint,
  nearestControlHandle, nearestControlPoint, objectOrigin, objectSvgTransform, removeControlPoint, shapePath,
  shapeSvgPath, supportsControlPoints, vectorPath, vectorSvgPath, worldPoint,
} from './geometry'
import { renderVectorObject, vectorObjectToSvg } from './vector'

function arcObject(): VectorObject {
  return {
    id: 'arc-1', kind: 'shape', shape: 'arc',
    points: [[400, 120, 0.5], [460, 180, 0.5]],
    brush: {
      id: 'fineline', name: 'Fineline', family: 'f', size: 10, opacity: 1, thinning: 0,
      streamline: 0, smoothing: 0, taperStart: 0, taperEnd: 0, pressureCurve: 'linear',
      passes: 1, jitter: 0,
    },
    color: '#000000', pen: false, transform: { x: 0, y: 0, scale: 1, rotation: 0 },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('arc bounds', () => {
  it('uses the center Y coordinate for the lower bound and origin', () => {
    const object = arcObject()

    expect(baseObjectBounds(object)).toEqual({
      minX: 335, minY: 55, maxX: 465, maxY: 185,
    })
    expect(objectOrigin(object)).toEqual({ x: 400, y: 120 })
  })
})

describe('object geometry', () => {
  it('round-trips a point through world and local transforms', () => {
    const object = arcObject()
    object.transform = { x: 20, y: -10, scale: 1.5, rotation: 30 }
    const point: [number, number, number] = [450, 140, 0.7]

    const world = worldPoint(point, object)
    const local = localPoint(world, object)

    expect(world[2]).toBe(0.7)
    expect(local[0]).toBeCloseTo(point[0], 10)
    expect(local[1]).toBeCloseTo(point[1], 10)
    expect(local[2]).toBe(point[2])
  })

  it('uses the same origin and transform for Canvas and SVG', () => {
    const object = arcObject()
    object.transform = { x: 20, y: -10, scale: 1.5, rotation: 30 }
    const ctx = {
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
    } as unknown as CanvasRenderingContext2D

    applyObjectTransform(ctx, object)

    expect(ctx.translate).toHaveBeenNthCalledWith(1, 420, 110)
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 6)
    expect(ctx.scale).toHaveBeenCalledWith(1.5, 1.5)
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -400, -120)
    expect(objectSvgTransform(object)).toBe(
      'translate(420.00 110.00) rotate(30.00) scale(1.5000) translate(-400.00 -120.00)',
    )
  })

  it('uses identical ellipse parameters for Canvas and SVG arc paths', () => {
    class FakePath2D {
      ellipse = vi.fn()
      rect = vi.fn()
    }
    vi.stubGlobal('Path2D', FakePath2D)
    const object = arcObject()

    const path = shapePath(object) as unknown as FakePath2D
    const svg = shapeSvgPath(object)

    expect(path.ellipse).toHaveBeenCalledWith(
      400, 120, 60, 60, 0, -Math.PI / 2, 200 * Math.PI / 180,
    )
    expect(svg.startsWith('M400.00,60.00')).toBe(true)
    expect(svg.endsWith('L343.62,99.48')).toBe(true)
  })

  it('moves freehand stroke control points and preserves their pressure', () => {
    const object = arcObject()
    object.kind = 'stroke'
    object.shape = undefined
    object.points = [[390, 100, 0.3], [450, 140, 0.7], [470, 160, 0.4]]
    object.transform = { x: 20, y: -10, scale: 1.5, rotation: 30 }
    const target: [number, number, number] = [500, 200, 0.1]
    const expected = localPoint(target, object)

    expect(supportsControlPoints(object)).toBe(true)
    expect(moveControlPoint(object, 1, target)).toBe(true)
    expect(object.points[1][0]).toBeCloseTo(expected[0], 10)
    expect(object.points[1][1]).toBeCloseTo(expected[1], 10)
    expect(object.points[1][2]).toBe(0.7)

    const crowded = arcObject()
    crowded.kind = 'stroke'
    crowded.shape = undefined
    crowded.points = [[500, 500, 0.5], [525, 500, 0.5], [650, 500, 0.5], [675, 500, 0.5]]
    expect(nearestControlPoint(crowded, [650, 500, 0.5], 37)).toBe(2)
    expect(nearestControlPoint(crowded, [100, 100, 0.5], 37)).toBeUndefined()

    object.kind = 'shape'
    object.shape = 'arc'
    expect(supportsControlPoints(object)).toBe(false)
    expect(moveControlPoint(object, 1, target)).toBe(false)
  })
})

describe('Bezier paths', () => {
  it('renders cubic segments identically and includes handles in bounds', () => {
    class FakePath2D {
      moveTo = vi.fn()
      lineTo = vi.fn()
      bezierCurveTo = vi.fn()
      closePath = vi.fn()
      rect = vi.fn()
      ellipse = vi.fn()
    }
    vi.stubGlobal('Path2D', FakePath2D)
    const object = arcObject()
    object.kind = 'path'
    object.shape = undefined
    object.points = [[100, 100, 0.5], [200, 100, 0.5], [300, 200, 0.5]]
    object.handles = { 0: { out: [150, 20] }, 1: { in: [180, 40] } }

    const path = vectorPath(object) as unknown as FakePath2D
    const svg = vectorSvgPath(object)

    expect(path.bezierCurveTo).toHaveBeenCalledWith(150, 20, 180, 40, 200, 100)
    expect(svg).toContain('C150.00,20.00 180.00,40.00 200.00,100.00')
    expect(baseObjectBounds(object).minY).toBe(10)

    expect(moveControlPoint(object, 0, [110, 120, 0.5])).toBe(true)
    expect(object.handles[0].out).toEqual([160, 40])
    expect(moveControlHandle(object, 0, 'out', [160, 50, 0.5])).toBe(true)
    expect(object.handles[0].out).toEqual([160, 50])
    expect(nearestControlHandle(object, [160, 50, 0.5], 5)).toEqual({ index: 0, side: 'out' })
  })
})

describe('path segments', () => {
  it('inserts a node with de Casteljau handles and removes nodes with remapping', () => {
    const object = arcObject()
    object.kind = 'path'
    object.shape = undefined
    object.points = [[100, 100, 0.5], [200, 100, 0.5], [300, 200, 0.5]]
    object.handles = { 0: { out: [150, 20] }, 1: { in: [180, 40] } }

    expect(insertControlPoint(object, [150, 60, 0.5], 50)).toBe(1)
    expect(object.points[1]).toEqual([150, 100, 0.5])
    expect(object.handles[0].out).toEqual([125, 60])
    expect(object.handles[1].in).toEqual([145, 45])
    expect(object.handles[1].out).toEqual([177.5, 50])
    expect(object.handles[2].in).toEqual([190, 70])
    expect(insertControlPoint(object, [1000, 1000, 0.5], 10)).toBeUndefined()

    expect(removeControlPoint(object, 1)).toBe(true)
    expect(object.points).toHaveLength(3)
    expect(removeControlPoint(object, 1)).toBe(true)
    expect(object.points).toHaveLength(2)
    expect(removeControlPoint(object, 0)).toBe(false)
  })
})

describe('width profile', () => {
  it('clamps multipliers and renders each path segment with its own width', () => {
    class FakePath2D {
      moveTo = vi.fn()
      lineTo = vi.fn()
      bezierCurveTo = vi.fn()
      closePath = vi.fn()
    }
    vi.stubGlobal('Path2D', FakePath2D)
    const object = arcObject()
    object.kind = 'path'
    object.shape = undefined
    object.points = [[100, 100, 0.5], [200, 100, 0.5], [300, 200, 0.5]]
    object.widthProfile = { 0: 1, 1: 2, 2: 3 }

    expect(adjustWidthProfile(object, 1, 0.5)).toBe(2.5)
    expect(adjustWidthProfile(object, 1, 10)).toBe(4)
    expect(adjustWidthProfile(object, 1, -10)).toBe(0.1)

    object.widthProfile = { 0: 1, 1: 2, 2: 3 }
    const ctx = {
      save: vi.fn(), restore: vi.fn(), stroke: vi.fn(), fill: vi.fn(), setLineDash: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      lineWidth: 0,
    } as unknown as CanvasRenderingContext2D
    renderVectorObject(ctx, object)
    expect(ctx.stroke).toHaveBeenCalledTimes(2)
    expect(ctx.lineWidth).toBe(25)

    const svg = vectorObjectToSvg(object)
    expect(svg).toContain('stroke-width="15"')
    expect(svg).toContain('stroke-width="25"')
  })
})
