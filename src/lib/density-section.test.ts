import { expect,it } from 'vitest'
import { Gesture } from './gesture-diagnostic'
import { DEFAULT,freshField,Transfer } from './density-transfer'
import { densitySection } from './density-section'
import { LARGE } from './field-size'

it('reads the last crossing against its actual non-uniform input, including partial edge tiles',()=>{
  const f=freshField(),g=new Gesture(f.length,DEFAULT,'mouse'),p={x:177,y:235}
  new Transfer(DEFAULT).stamp(f,p);const before=f.slice();new Transfer(DEFAULT,r=>g.before(f,r)).stamp(f,p);g.finish(f,false)
  const s={x1:0,y1:235,x2:383,y2:235},samples=densitySection(g,s)!
  expect(samples[0]).toBeNull();expect(samples[383]).toBeNull();expect(samples[p.x]?.before).toBe(before[235*384+177]);expect(samples[p.x]?.delta).toBeLessThan(0)
  expect(samples[p.x+11]?.delta).toBeGreaterThan(0);const reversed=densitySection(g,{...s,x1:383,x2:0});expect(reversed).toEqual([...samples].reverse())
  f.fill(42);expect(densitySection(g,s)).toEqual(samples)
})
it('caps samples, handles a tap, missing coverage and unavailable recordings',()=>{
  const g=new Gesture(LARGE.width*LARGE.height,DEFAULT,'pen'),s={x1:0,y1:0,x2:2047,y2:2047}
  const line=densitySection(g,s)!;expect(line).toHaveLength(512);expect(line.every(p=>p===null)).toBe(true)
  expect(densitySection(g,{...s,x2:0,y2:0})).toEqual([null]);expect(densitySection(g,{...s,x2:-1})).toBeNull()
  g.dropped=2;expect(densitySection(g,s)).toBeNull();g.dropped=0;g.cancelled=true;expect(densitySection(g,s)).toBeNull()
})
