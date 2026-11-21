import { describe, expect, it } from 'vitest'
import { bodyPlacementLayout, bodyPresets, bodyRegions, bodySilhouette, createBodyPlacement, deserializeBodyPlacement, parseBodyPlacement, serializeBodyPlacement } from './body-placement'

const back = createBodyPlacement('back')
describe('body placement v1', () => {
  it('provides each promised region', () => {
    expect(bodyRegions).toEqual(['back', 'chest', 'shoulder', 'forearm', 'hand', 'thigh', 'shin', 'neck', 'ribs'])
  })
  it('provides a deterministic front/back schematic without printable geometry', () => {
    const front = bodySilhouette('front'), backView = bodySilhouette('back')
    expect(front).toEqual(bodySilhouette('front'))
    expect(front.version).toBe(1)
    expect(front.viewBox).toEqual({ width: 100, height: 220 })
    expect(front.outlinePath).toContain('M44 29')
    expect(front.markers.some(marker => marker.bodyRegion === 'back')).toBe(false)
    expect(backView.markers.some(marker => marker.bodyRegion === 'chest')).toBe(false)
    expect(front.markers.filter(marker => marker.bodyRegion === 'shoulder').map(marker => marker.x)).toEqual([71, 29])
    expect(front.markers.every(marker => marker.x >= 0 && marker.x <= 100 && marker.y >= 0 && marker.y <= 220)).toBe(true)
    expect(front.markers.every(marker => marker.bodyRegion in bodyPresets)).toBe(true)
    expect(front.markers).toHaveLength(14)
    expect(backView.markers).toHaveLength(14)
    for (const marker of front.markers.filter(marker => marker.side !== 'center')) {
      expect(backView.markers).toContainEqual({ ...marker, x: 100 - marker.x })
      const v = { ...createBodyPlacement(marker.bodyRegion), side: marker.side, orientation: front.orientation }
      expect(deserializeBodyPlacement(serializeBodyPlacement({ ...v, ...{ silhouette: front } }))).toEqual(v)
    }
    expect(() => bodySilhouette('top' as never)).toThrow()
  })

  it.each(bodyRegions)('creates a valid centered %s preset inside its safe margin', id => {
    const v = createBodyPlacement(id)
    expect(v.bodyRegion).toBe(id)
    expect(v.placement).toEqual({ x: 0.5, y: 0.5 })
    expect(bodyPlacementLayout(v).warnings).toEqual([])
    expect(deserializeBodyPlacement(serializeBodyPlacement(v))).toEqual(v)
  })
  it('calculates rotated bounds in region-local mm, including off-patch extents', () => {
    const v = { ...back, placement: { x: 0, y: 1 }, widthMm: 20, heightMm: 40, rotation: 90 }
    const layout = bodyPlacementLayout(v)
    expect(layout.bounds).toEqual({ minX: -20, maxX: 20, minY: 410, maxY: 430 })
    expect(layout.warnings).toEqual(['crop', 'safe-margin'])
    expect(bodyPlacementLayout({ ...v, wrap: 'contour-preview' })).toEqual(layout)
  })
  it('distinguishes safety and crop limits and accepts exact contact', () => {
    expect(bodyPlacementLayout({ ...back, widthMm: 310 }).warnings).toEqual([])
    expect(bodyPlacementLayout({ ...back, widthMm: 320 }).warnings).toEqual(['safe-margin'])
    expect(bodyPlacementLayout({ ...back, widthMm: 321 }).warnings).toContain('crop')
  })
  it.each([{ version: 2 }, { placement: null }, { placement: { x: 1.01, y: 0 } }, { placement: { x: 0, y: -1 } },
    { widthMm: NaN }, { heightMm: Infinity }, { widthMm: 0 }, { rotation: -181 }, { safeMarginMm: -1 },
    { safeMarginMm: 200 }, { side: 'up' }, { bodyRegion: '__proto__' }, { orientation: 'top' }, { wrap: '3d' }, { widthMm: '12' }])('rejects invalid %j', patch => {
    expect(() => parseBodyPlacement({ ...back, ...patch })).toThrow()
  })
  it('persists only metadata and rejects malformed documents', () => {
    const changed = { ...back, wrap: 'contour-preview' as const, rotation: 17, side: 'right' as const, placement: { x: .22, y: .71 } }
    const withPreview = { ...changed, silhouette: '<svg/>', warnings: [] }
    expect(deserializeBodyPlacement(serializeBodyPlacement(withPreview))).toEqual(changed)
    for (const json of ['{', 'null', '[]', '{}']) expect(() => deserializeBodyPlacement(json)).toThrow()
  })
})
