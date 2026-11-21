import { describe, expect, it } from 'vitest'
import { atlasSize, chart, connected, defaults, front, flatHit, fromUV, measurementsDefs, parts, scene, sceneBuffers, type Part } from './surface-model'
import { Transfer, freshField } from './density-transfer'

const profile = (mode: 'min' | 'max' | 'mixed') => Object.assign({}, defaults, ...measurementsDefs.map((d,i)=>({[d.key]: d[mode==='mixed' ? i%2?'min':'max' : mode]}))) as typeof defaults

describe('closed surface ray picking and isolated atlas', () => {
  it('every foreground pixel has a finite, round-trippable atlas index, even looking straight down or up', () => {
    const buffers = sceneBuffers(101,151)
    for(const [yaw,pitch] of [[0,0],[Math.PI,0],[Math.PI/2,.4],[-Math.PI/2,-.3],[0,Math.PI/2],[0,-Math.PI/2]]) {
      const v=scene(101,151,defaults,{...front,yaw,pitch},buffers)
      const seen=new Set(v.ids)
      if(pitch===0) for(const [id] of parts.entries()) expect(seen.has(id)).toBe(true)
      expect(seen.has(-2)).toBe(false)
      let count=0
      for(let i=0;i<v.ids.length;i++) {
        const hit=v.hit(i%v.w,Math.floor(i/v.w))
        if (!Number.isFinite(buffers.depth[i])) { if(hit!==null) throw Error('background hit'); continue }
        if(!hit || flatHit(hit.x,hit.y,defaults)?.part!==hit.part || v.indices[i]!==Math.round(hit.x)+atlasSize.width*Math.round(hit.y)) throw Error(`invalid pick ${yaw},${pitch},${i}`)
        count++
      }
      expect(count).toBeGreaterThan(100)
    }
  })
  it('all islands stay separate from even the largest brushes; measurements never move ink', () => {
    const brush=new Transfer({radius:14,buffer:16,shape:'nib'}), field=freshField()
    for(const part of parts) {
      field.fill(1)
      for (const u of [0,.5,1]) for (const v of [0,.5,1]) {
        const hit=fromUV(part,u,v,defaults)
        expect(fromUV(part,u,v,profile('mixed'))).toEqual(hit)
        expect(hit.x).toBeLessThan(atlasSize.width); expect(hit.y).toBeLessThan(atlasSize.height)
        brush.stamp(field,hit)
      }
      for(const other of parts.filter(p=>p!==part)) {
        const c=chart(other,defaults)
        for(let y=c.y;y<=c.y+c.rows;y++) if(field.subarray(y*atlasSize.width+c.x,y*atlasSize.width+c.x+c.w+1).some(r=>r!==1)) throw Error(`bleed: ${part}/${other}`)
      }
    }
  })
  it('keeps bilateral segments mirrored in extreme measurement profiles and each visible in front', () => {
    for(const s of [profile('min'),profile('max'),profile('mixed')]) {
      const view=scene(301,401,s,front)
      for(const [i,part] of parts.entries()) expect(view.ids.indexOf(i),part).toBeGreaterThan(0)
      for(const [a,b] of [['upperArm','upperArmLeft'],['forearm','forearmLeft'],['hand','handLeft'],['thigh','thighRight'],['shin','shinRight'],['foot','footRight']] as [Part,Part][]) {
        const A=chart(a,s), B=chart(b,s); expect(A.cx).toBe(-B.cx); expect(A.cy).toBe(B.cy); expect(A.r).toBe(B.r)
      }
    }
  })
  it('cuts at seam, chart switch or miss, and front/back picks remain invariant with zoom', () => {
    const a=fromUV('torso',.99,.5,defaults)
    expect(connected(null,a)).toBe(false); expect(connected(a,fromUV('forearm',.99,.5,defaults))).toBe(false)
    expect(connected(a,fromUV('torso',.01,.5,defaults))).toBe(false); expect(connected(a,fromUV('torso',.97,.5,defaults))).toBe(true)
    const center=(zoom:number,yaw:number)=>scene(241,301,defaults,{...front,focus:'torso',zoom,yaw}).hit(120,150)!
    expect(center(1,0)).toEqual(center(3,0)); expect(center(1,0).u).toBe(.5); expect(Math.abs(center(1,Math.PI).u-.5)).toBeCloseTo(.5)
  })
  it('rejects invalid dimensions, UV, camera, buffers and out-of-range measurements', () => {
    expect(Object.keys(defaults).sort()).toEqual(measurementsDefs.map(d=>d.key).sort())
    for(const d of measurementsDefs) for(const value of [NaN,Infinity,-Infinity,d.min-1,d.max+1]) expect(()=>scene(32,32,{...defaults,[d.key]:value},front)).toThrow(RangeError)
    expect(()=>sceneBuffers(-2,3)).toThrow(); expect(()=>sceneBuffers(1.5,3)).toThrow(); expect(()=>scene(2,2,defaults,front,sceneBuffers(1,1))).toThrow()
    for(const cam of [{pitch:NaN},{yaw:Infinity},{zoom:0},{zoom:Infinity}]) expect(()=>scene(3,3,defaults,{...front,...cam})).toThrow()
    expect(()=>fromUV('head',NaN,0,defaults)).toThrow(); expect(flatHit(NaN,0,defaults)).toBeNull(); expect(scene(3,3,defaults,front).hit(Infinity,NaN)).toBeNull()
  })
})
