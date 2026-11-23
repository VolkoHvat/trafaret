import { expect, it } from 'vitest'
import {makeSection,tattooUV} from './local-surface'

it('measures slant length and arc distance on tapered rings in mm',()=>{
  const s=makeSection('forearm',[300,180,240]);expect(Math.hypot(s.height,120/(2*Math.PI))).toBeCloseTo(240)
  for(const t of [0,.5,1]){
    const r=(300-120*t)/(2*Math.PI),hit=s.sample(r*Math.sin(.8),s.height*t,0)!
    expect(hit.x).toBeCloseTo(r*.8);expect(hit.y).toBeCloseTo(240*(t-.5));expect(s.sample(r+1,s.height*t,0)).toBeNull()
  }
})
it('uses middle circumference at half the measured length',()=>{
  const s=makeSection('shin',[320,200,300,400]), half=Math.sqrt(150**2-(80/(2*Math.PI))**2)
  expect(s.sample(0,half,1)?.x).toBeCloseTo(400/(2*Math.PI));expect(s.sample(0,half,0)?.y).toBeCloseTo(0)
})
it('preserves 2048 UV/mm under back resizing, yaw, offset and tattoo rotation',()=>{
  for(const w of [200,450]){const hit=makeSection('back',[w,0,300]).sample(25,160,Math.PI/3)!
    const uv=tattooUV(hit.x,hit.y,10,10,0,1,160);expect(uv.u*2048).toBeCloseTo(1024);expect(uv.v*2048).toBeCloseTo(512)}
})
it('rejects missing, invalid and geometrically impossible measurements',()=>{
  for(const m of [[300,200],[300,NaN,200],[300,200,0],[1500,10,10]])expect(()=>makeSection('forearm',m)).toThrow()
})
