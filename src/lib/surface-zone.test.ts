import { expect, it } from 'vitest'
import { atlasSize, chart, defaults, fromUV } from './surface-model'
import { SurfaceZone } from './surface-zone'

it('накапливает раздельные участки и снимает ограничение после clear', () => {
  const zone = new SurfaceZone(), a = fromUV('torso', .2, .5, defaults), b = fromUV('head', .5, .5, defaults)
  expect(zone.active).toBe(false); expect(zone.contains(b.x,b.y)).toBe(true)
  zone.dab(a, 2, defaults)
  expect(zone.active).toBe(true); expect(zone.contains(b.x,b.y)).toBe(false)
  const revision = zone.revision
  zone.dab(a, 2, defaults); expect(zone.revision).toBe(revision)
  zone.dab(b, 2, defaults)
  expect(zone.contains(a.x,a.y)).toBe(true); expect(zone.contains(b.x,b.y)).toBe(true)
  expect(zone.contains(a.x+3,a.y)).toBe(false); expect(zone.revision).toBeGreaterThan(revision)
  const beforeClear = zone.revision
  zone.clear(); expect(zone.active).toBe(false); expect(zone.contains(a.x+3,a.y)).toBe(true)
  expect(zone.revision).toBeGreaterThan(beforeClear)
})

it('даже большой отпечаток не захватывает другие развёртки и промежутки', () => {
  const zone = new SurfaceZone(), c = chart('head', defaults)
  zone.dab(fromUV('head', 1, 1, defaults), atlasSize.width, defaults)
  let mismatches = 0
  for (let y=0; y<atlasSize.height; y++) for (let x=0; x<atlasSize.width; x++) {
    if (zone.contains(x,y) !== (x>=c.x && x<=c.x+c.w && y>=c.y && y<=c.y+c.rows)) mismatches++
  }
  expect(mismatches).toBe(0)
})

it('черновик жеста можно отбросить без изменения исходной зоны', () => {
  const zone = new SurfaceZone(), a = fromUV('torso', .2, .5, defaults), b = fromUV('head', .5, .5, defaults)
  zone.dab(a, 2, defaults)
  const draft = zone.clone(), revision = zone.revision
  draft.dab(b, 2, defaults)
  expect(draft.contains(b.x,b.y)).toBe(true); expect(zone.contains(b.x,b.y)).toBe(false)
  draft.clear(); expect(zone.active).toBe(true); expect(zone.revision).toBe(revision)
})
