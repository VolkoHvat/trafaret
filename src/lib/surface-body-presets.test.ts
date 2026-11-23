import { expect, it } from 'vitest'
import { body, defaults, parts, perimeter, presets } from './surface-body'
import { fromUV, front, scene } from './surface-model'
import { surfaceFrame } from './surface-projection'
import { decodeSurfaceProject, encodeSurfaceProject, measurements } from './customer-surface-profile'
import { defaults as workspaceDefaults, pack, unpack } from './field-workspace'
import { SMALL,LARGE } from './field-size'

it('changes relative shoulders, rib cage, waist, pelvis and thighs',()=>{
 const m=body(presets.male), f=body(presets.female)
 expect(m.upperArmLeft.cx-m.upperArmLeft.lean*-m.upperArmLeft.ry).toBeGreaterThan(f.upperArmLeft.cx+f.upperArmLeft.lean*f.upperArmLeft.ry)
 expect(m.torso.rx*m.torso.upper).toBeGreaterThan(f.torso.rx*f.torso.upper)
 expect(m.torso.lower*m.torso.rx).toBeGreaterThan(f.torso.lower*f.torso.rx)
 expect(f.pelvis.rx).toBeGreaterThan(m.pelvis.rx);expect(f.thigh.rx*f.thigh.upper).toBeGreaterThan(m.thigh.rx*m.thigh.upper)
})
for (const profile of Object.values(presets)) {
 it(`${profile.preset}: all existing islands remain pickable with unchanged UVs`,()=>{
  for(const atlas of [SMALL,LARGE]){
   const hits=new Set<string>()
   for(const yaw of [0,Math.PI/2,Math.PI]){
    const v=scene(180,260,profile,{...front,yaw,pitch:.18},undefined,atlas)
    for(let i=0;i<v.ids.length;i+=13){const hit=v.hit(i%180,Math.floor(i/180));if(!hit)continue
     hits.add(hit.part);const p=fromUV(hit.part,hit.u,hit.v,defaults,atlas);if(p.x!==hit.x||p.y!==hit.y)throw Error('UV moved')
    }
   }
   expect([...hits].sort()).toEqual(parts.slice().sort())
  }
  for(const part of ['torso','thigh','pelvis'] as const){const a=surfaceFrame(part,.44,.42,profile), b=surfaceFrame(part,.44,.420001,profile);expect(Math.hypot(a.positionMm.x-b.positionMm.x,a.positionMm.y-b.positionMm.y,a.positionMm.z-b.positionMm.z)*1e6).toBeCloseTo(a.mmPerUnitUV.v,4)}
 })
 it(`${profile.preset}: both formats retain custom measures and field`,async()=>{
  const field=new Float64Array(SMALL.width*SMALL.height).fill(1);field[5]=0;field[7]=2
  const body={...profile,chest:92.5}, meta={...workspaceDefaults(),surfaceBody:body}
  expect(decodeSurfaceProject(encodeSurfaceProject(field,body))).toEqual({field,body});expect(await unpack(pack(field,meta),field.length)).toEqual({field,meta})
 })
}
for (const part of ['upperArm','forearm','shin'] as const) {
 it(`${part}: the same painted texel is picked on both fitted shapes`,()=>{
  const atlas=LARGE, field=new Uint8Array(atlas.width*atlas.height)
  const uv=fromUV(part,.54,.66,defaults,atlas), painted=Math.round(uv.x)+atlas.width*Math.round(uv.y)
  field[painted]=1
  for(const preset of ['male','female'] as const){
   const settings={...defaults,preset}, shapes=body(settings), c=shapes[part]
   const girth={upperArm:settings.armGirth,forearm:settings.forearmGirth,shin:settings.calfGirth}[part]
   expect(perimeter(c.rx,c.rz)*c.upper).toBeCloseTo(10*girth,8)
   expect(c.lower/c.upper).toBeLessThan(.75)
   const p=surfaceFrame(part,uv.u,uv.v,settings).positionMm
   // Project the physical point onto an exact pixel centre; a different front
   // intersection or a wrong inverse UV cannot read the one marked atlas cell.
   const h=281,w=801,zoom=2,yaw=.14,pitch=.11,scale=h/((shapes.head.cy+shapes.head.ry)*1.06)*zoom
   const x=p.x-c.cx,y=p.y-c.cy,z=p.z-c.cz
   const panX=-(x*Math.cos(yaw)-z*Math.sin(yaw))*scale/w
   const panY=(y*Math.cos(pitch)-(x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch))*scale/h
   const view=scene(w,h,settings,{...front,focus:part,zoom,yaw,pitch,panX,panY},undefined,atlas)
   const hit=view.hit(w/2,h/2)
   expect(hit?.part).toBe(part);expect(hit?.u).toBeCloseTo(uv.u,6);expect(hit?.v).toBeCloseTo(uv.v,6)
   expect(field[view.indices[Math.floor(h/2)*w+Math.floor(w/2)]]).toBe(1)
  }
 })
}
it('does not reinterpret legacy settings or accept unknown shapes',()=>{expect(measurements(defaults)).toEqual(defaults);expect(()=>measurements({...defaults,preset:'other'})).toThrow()})
