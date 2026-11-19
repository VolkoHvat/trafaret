import { describe, expect, it, vi } from 'vitest'
import type { VectorObject } from '../types'
import { duplicateVectorObjects } from './vector'

function pathObject(id: string): VectorObject {
  return {
    id, kind: 'path', points: [[100, 100, 0.4], [200, 120, 0.8]],
    brush: {
      id: 'fineline', name: 'Fineline', family: 'f', size: 10, opacity: 1, thinning: 0,
      streamline: 0, smoothing: 0, taperStart: 0, taperEnd: 0, pressureCurve: 'linear', passes: 1, jitter: 0,
    },
    color: '#171914', pen: false, handles: { 0: { out: [140, 80] } }, widthProfile: { 1: 2 },
    transform: { x: 5, y: -5, scale: 1.5, rotation: 30 },
  }
}

describe('vector object duplication', () => {
  it('deep-copies only selected objects with fresh ids and an offset', () => {
    const objects = [pathObject('a'), pathObject('b'), pathObject('c')]
    const ids = ['copy-a', 'copy-c']
    const idFactory = vi.fn(() => ids.shift()!)

    const copies = duplicateVectorObjects(objects, ['a', 'c'], 20, idFactory)

    expect(copies.map(object => object.id)).toEqual(['copy-a', 'copy-c'])
    expect(copies.map(object => object.transform)).toEqual([
      { x: 25, y: 15, scale: 1.5, rotation: 30 },
      { x: 25, y: 15, scale: 1.5, rotation: 30 },
    ])
    expect(copies[0].handles).toEqual(objects[0].handles)
    expect(copies[0].widthProfile).toEqual(objects[0].widthProfile)
    expect(copies[0].points).not.toBe(objects[0].points)
    expect(copies[0].handles).not.toBe(objects[0].handles)
    expect(objects.map(object => object.transform)).toEqual([
      { x: 5, y: -5, scale: 1.5, rotation: 30 },
      { x: 5, y: -5, scale: 1.5, rotation: 30 },
      { x: 5, y: -5, scale: 1.5, rotation: 30 },
    ])
    expect(idFactory).toHaveBeenCalledTimes(2)
  })

  it('does nothing without a selected id', () => {
    const idFactory = vi.fn(() => 'unused')
    expect(duplicateVectorObjects([pathObject('a')], [], 20, idFactory)).toEqual([])
    expect(idFactory).not.toHaveBeenCalled()
  })
})
