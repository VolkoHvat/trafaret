import { expect,it } from 'vitest'
import { DEFAULT, freshField, PathInput, Transfer } from './density-transfer'
import { Gesture,LIMIT,replay } from './gesture-diagnostic'

it('compares from frozen pre-stroke tiles, including the halo for a larger alternate brush',()=>{
  const f=freshField(); new Transfer(DEFAULT).stamp(f,{x:64,y:47})
  const g=new Gesture(f.length,{radius:2,buffer:2},'pen'),start={x:38,y:47,time:5}
  const path=new PathInput(f,new Transfer(g.brush,r=>g.before(f,r)),start); g.sample(start,.1)
  for(let i=1;i<50;i++){const p={x:38+i*4,y:47+Math.sin(i)*6,time:5+i*8};g.packets++;g.sample(p,.9);path.move(p)}
  g.finish(f,false);f.fill(0)
  const result=replay(g,{radius:14,buffer:16,shape:'nib'});expect(result.original.density).toBe(0);expect(result.packing.density).toBe(0);expect(result.selected.pixels).toBeGreaterThan(0)
  g.samples.forEach(p=>p.pressure=0);expect(replay(g,g.brush).selected.density).toBe(0)
})
it('never certifies cancelled, trimmed or over-limit input',()=>{
  const f=freshField(),g=new Gesture(f.length,DEFAULT,'mouse');g.dropped=1;expect(g.available).toBe(false)
  g.dropped=0;g.finish(f,true);expect(g.available).toBe(false)
  const full=new Gesture(f.length,DEFAULT,'pen');for(let i=0;i<=LIMIT.samples;i++)full.sample({x:1,y:1,time:i},.5)
  expect(full.samples).toHaveLength(LIMIT.samples);expect(full.available).toBe(false)
})
