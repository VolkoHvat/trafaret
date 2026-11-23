import { describe, expect, it } from 'vitest'
import { legacyProjectFixture } from './fixtures/legacy-project'
import { migrateToV2, parseV2, serializeV2, validateV2 } from './index'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('Trafaret document v2 contract', () => {
  it('migrates a v1 snapshot idempotently', () => {
    const first = migrateToV2(clone(legacyProjectFixture))
    const second = migrateToV2(clone(first.document))

    expect(first.migrated).toBe(true)
    expect(first.sourceVersion).toBe(1)
    expect(second.migrated).toBe(false)
    expect(second.sourceVersion).toBe(2)
    expect(second.document).toEqual(first.document)
  })

  it('preserves layers, masks, clip metadata, and stroke records', () => {
    const document = migrateToV2(clone(legacyProjectFixture)).document
    const ink = document.layers.find(layer => layer.id === 'ink')

    expect(document.layers.map(layer => layer.id)).toEqual(['ink', 'paper'])
    expect(ink?.mask).toEqual({ data: 'data:image/png;base64,mask', enabled: true })
    expect(ink?.clipToBelow).toBe(true)
    expect(ink?.strokes[0].clips?.[0]).toEqual({ kind: 'lasso', points: [[0, 0], [100, 0], [100, 100]], inverse: true })
    expect(ink?.strokes[0].points).toEqual([{ x: 10, y: 20, pressure: 0.4 }, { x: 30, y: 40, pressure: 0.8 }])
  })

  it('roundtrips deterministically and excludes prediction data', () => {
    const document = migrateToV2(clone(legacyProjectFixture)).document
    Object.assign(document.layers[0].strokes[0], { prediction: [[999, 999, 1]], previewPointSets: [[[999, 999, 1]]] })
    const serialized = serializeV2(document)
    const parsed = parseV2(serialized)

    expect(serializeV2(parsed)).toBe(serialized)
    expect(parsed.layers.find(layer => layer.id === 'ink')?.mask).toEqual({ data: 'data:image/png;base64,mask', enabled: true })
    expect(parsed.layers.find(layer => layer.id === 'ink')?.clipToBelow).toBe(true)
    expect(serialized).not.toContain('prediction')
    expect(serialized).not.toContain('previewPointSets')
    expect(validateV2(parsed)).toEqual([])
  })

  it('retains a nested disabled mask when the legacy envelope has no maskData', () => {
    const mask = { data: 'data:image/png;base64,disabled', enabled: false }
    const input = { ...legacyProjectFixture, activeLayerId: 'ink', layers: [{ id: 'ink', mask, clipToBelow: true }] }
    const migrated = migrateToV2(input).document
    const parsed = parseV2(serializeV2(migrated))
    expect(parsed.layers[0].mask).toEqual(mask)
    expect(parsed.layers[0].clipToBelow).toBe(true)
    expect(migrateToV2(parsed).document).toEqual(migrated)
  })

  it('rejects invalid documents before serialization', () => {
    const document = migrateToV2(clone(legacyProjectFixture)).document
    document.activeLayerId = 'missing'
    expect(validateV2(document)).toContain('activeLayerId must reference a layer')
    expect(() => serializeV2(document)).toThrow('activeLayerId must reference a layer')
  })
})
