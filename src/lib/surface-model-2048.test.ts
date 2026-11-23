import { expect, it } from 'vitest'
import { SMALL, LARGE } from './field-size'
import { chart, defaults, flatHit, front, fromUV, parts, scene, texelBounds } from './surface-model'
import { surfaceFrame, surfaceStroke } from './surface-projection'
import { SurfaceBrush } from './customer-surface-profile'
import { SurfaceZone } from './surface-zone'
import { freshField } from './density-transfer'
import { TileHistory, type Patch } from './field-tiles'

it('retains normalized island corners, poles and seam endpoints including rounded edge texels', () => {
  for (const part of parts) for (const u of [0,.33,1]) for (const v of [0,.67,1]) {
    const hit = fromUV(part,u,v,defaults,LARGE), old = fromUV(part,u,v,defaults)
    expect(hit.x/LARGE.width).toBeCloseTo(old.x/SMALL.width,14)
    expect(hit.y/LARGE.height).toBeCloseTo(old.y/SMALL.height,14)
    const pick = flatHit(hit.x,hit.y,defaults,LARGE)!
    expect(pick.part).toBe(part); expect(pick.u).toBeCloseTo(u,14); expect(pick.v).toBeCloseTo(v,14)
    expect(flatHit(Math.round(hit.x),Math.round(hit.y),defaults,LARGE)?.part).toBe(part)
  }
  expect(()=>chart('torso',defaults,{width:1024,height:4096})).toThrow()
})

it('measures a 50 mm cylinder arc on the native atlas without changing its physical size', () => {
  const s = {...defaults,forearmGirth:20}, part = 'forearm'
  const metric = surfaceFrame(part,.5,.5,s,LARGE), old = surfaceFrame(part,.5,.5,s)
  expect(metric.mmPerUnitUV).toEqual(old.mmPerUnitUV)
  const a = fromUV(part,.375,.5,s,LARGE), b = fromUV(part,.625,.5,s,LARGE)
  expect((b.x-a.x)*metric.mmPerAtlasCell.x).toBeCloseTo(50,12)
  expect(metric.mmPerAtlasCell.y/old.mmPerAtlasCell.y).toBeCloseTo(SMALL.height/LARGE.height,12)
})

it('indexes native 2048-wide rows, not a magnified small atlas', () => {
  const view = scene(211,211,defaults,{...front,focus:'hand',zoom:7},undefined,LARGE)
  const hit = view.hit(105,105)!
  expect(hit.part).toBe('hand')
  const index = view.indices[105*view.w+105]
  expect(index).toBe(Math.round(hit.y)*2048+Math.round(hit.x))
  expect(index).toBeGreaterThan(SMALL.width*SMALL.height)
  const field = freshField(LARGE)
  expect(field.length).toBe(2048*2048)
  surfaceStroke(field,new SurfaceBrush(2,hit.part,defaults,undefined,undefined,LARGE),LARGE)(hit)
  expect(field[index]).toBeLessThan(1)
})

it('clips both sides of the seam to native zone texels, conserves mass and restores captured tiles', () => {
  const part='footRight', field=freshField(LARGE), zone=new SurfaceZone(LARGE)
  const edges=[0,1].map(u=>fromUV(part,u,1,defaults,LARGE)), bounds=texelBounds(chart(part,defaults,LARGE))
  for(const hit of edges) zone.dab(hit,8,defaults)
  const frozen=zone.clone(); zone.clear()
  const patch:Patch=new Map(), brush=new SurfaceBrush(3,part,defaults,frozen.contains,patch,LARGE)
  const stroke=surfaceStroke(field,brush,LARGE)
  for(const hit of edges){stroke(hit);expect(field[Math.round(hit.y)*2048+Math.round(hit.x)]).toBeLessThan(1)}
  let mass=0, changes=0
  for(let i=0;i<field.length;i++) if(field[i]!==1){
    const x=i%2048,y=Math.floor(i/2048)
    expect(frozen.contains(x,y)).toBe(true)
    expect(x>=bounds.left && x<=bounds.right && y>=bounds.top && y<=bounds.bottom).toBe(true)
    mass+=field[i]-1;changes++
  }
  expect(changes).toBeGreaterThan(2);expect(mass).toBeCloseTo(0,12)
  expect(patch.size).toBeLessThanOrEqual(8)
  const history=new TileHistory();history.commit(patch);history.travel(field,false)
  expect(field.every(m=>m===1)).toBe(true)
})
