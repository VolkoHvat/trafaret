import { describe, expect, it } from 'vitest'
import type { SelectionModel } from '../types'
import { DEFAULT_BRUSHES } from './brushes'
import { StrokeSession, type StrokeSessionOptions } from './stroke-session'

function makeSession(partial: Partial<StrokeSessionOptions> = {}) {
  return new StrokeSession({
    pointerId: 1, layerId: 'layer-1', channel: 'content', point: [10, 20, 0.2], pen: true,
    brush: DEFAULT_BRUSHES.fineline, color: '#000000', eraser: false, line: false,
    vector: false, symmetry: 'off', radialCount: 1,
    doc: { width: 100, height: 100, title: 'Test', dpi: 300 },
    ...partial,
  })
}

describe('StrokeSession', () => {
  it('keeps pressure and ignores freehand segments below the distance threshold', () => {
    const session = makeSession()
    session.addPoint([10.1, 20.1, 0.3])
    expect(session.pointSets()[0]).toEqual([[10, 20, 0.2]])

    session.addPoint([11, 21, 0.4])
    expect(session.pointSets()[0]).toEqual([[10, 20, 0.2], [11, 21, 0.4]])
  })

  it('replaces the endpoint for line and shape previews', () => {
    for (const options of [{ line: true }, { line: false, shape: 'arc' as const }]) {
      const session = makeSession(options)
      session.addPoint([30, 40, 0.5])
      session.addPoint([50, 60, 0.7])

      expect(session.pointSets()[0]).toEqual([[10, 20, 0.2], [50, 60, 0.7]])
    }
  })

  it('creates vertical and radial point sets without losing pressure', () => {
    const vertical = makeSession({ symmetry: 'vertical' })
    expect(vertical.pointSets()).toEqual([
      [[10, 20, 0.2]], [[90, 20, 0.2]],
    ])

    const radial = makeSession({ point: [60, 40, 0.6], symmetry: 'radial', radialCount: 4 })
    const sets = radial.pointSets()
    expect(sets).toHaveLength(4)
    expect(sets[1][0][0]).toBeCloseTo(60)
    expect(sets[1][0][1]).toBeCloseTo(60)
    expect(sets.every(set => set[0][2] === 0.6)).toBe(true)
  })

  it('computes a padded raster rect clamped to the document', () => {
    const session = makeSession()
    expect(session.rasterRect()).toEqual({ x: 0, y: 0, width: 42, height: 52 })
  })

  it('commits independent vector objects with symmetry, clips and unique ids', () => {
    const session = makeSession({ shape: 'arc', vector: true, symmetry: 'vertical' })
    session.addPoint([30, 50, 0.8])
    const clips: SelectionModel[] = [{ kind: 'rectangle', points: [[0, 0], [50, 50]] }]
    let id = 0
    const objects = session.vectorObjects(clips, () => `object-${++id}`)

    expect(objects.map(object => object.id)).toEqual(['object-1', 'object-2'])
    expect(objects[0].kind).toBe('shape')
    expect(objects[0].closed).toBe(true)
    expect(objects[0].clips).toBe(clips)
    expect(objects[0].origin).toBeDefined()
    expect(objects[1].points[0][0]).toBe(90)
    session.addPoint([40, 70, 0.9])
    expect(objects[0].points[1]).toEqual([30, 50, 0.8])
  })
})
