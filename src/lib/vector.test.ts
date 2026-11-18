import { describe, expect, it } from 'vitest'
import type { VectorObject } from '../types'
import { baseObjectBounds, objectOrigin } from './vector'

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

describe('arc bounds', () => {
  it('uses the center Y coordinate for the lower bound and origin', () => {
    const object = arcObject()

    expect(baseObjectBounds(object)).toEqual({
      minX: 335, minY: 55, maxX: 465, maxY: 185,
    })
    expect(objectOrigin(object)).toEqual({ x: 400, y: 120 })
  })
})
