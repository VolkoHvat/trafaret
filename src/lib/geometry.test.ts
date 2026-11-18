import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VectorObject } from '../types'
import {
  applyObjectTransform, baseObjectBounds, localPoint, moveControlPoint, nearestControlPoint,
  objectOrigin, objectSvgTransform, shapePath, shapeSvgPath, supportsControlPoints, worldPoint,
} from './geometry'

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
