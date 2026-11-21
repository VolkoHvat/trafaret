import { describe, expect, it } from 'vitest'
import { atlasSize, chart, defaults, fromUV, measurementsDefs, parts } from './surface-model'
import { decodeField } from './field-document'
import { SurfaceZone } from './surface-zone'
import { freshField } from './density-transfer'
import { decodeSurfaceProject, encodeSurfaceProject, SurfaceBrush } from './customer-surface-profile'

import { unpackCheckpoint } from './customer-surface-profile-checkpoint'

describe('локальный проект поверхности',()=>{
 it('отличает отсутствие копии от повреждения и валидирует вложенный .tfs',()=>{
  expect(unpackCheckpoint(undefined)).toBeNull()
  const bytes=encodeSurfaceProject(freshField(atlasSize),defaults)
  expect(unpackCheckpoint({token:'abc',bytes})?.body).toEqual(defaults)
  for(const record of [null,{}, {token:'',bytes}, {token:'abc',bytes:bytes.slice(1)}])expect(()=>unpackCheckpoint(record)).toThrow()
 })
 it('возвращает поле без потерь вместе с мерками',()=>{
  const field=freshField(atlasSize), d=measurementsDefs[0], body={...defaults,[d.key]:d.max}
  new SurfaceBrush(4,parts[0],body).stamp(field,fromUV(parts[0],.5,.5,body))
  const bytes=encodeSurfaceProject(field,body), restored=decodeSurfaceProject(bytes)
  expect(restored.body).toEqual(body);expect(restored.field.every((v,i)=>v===field[i])).toBe(true)
  expect(()=>decodeField(bytes)).toThrow()
 })
 it('отклоняет неполный файл, повреждённое поле или метаданные',()=>{
  const bytes=encodeSurfaceProject(freshField(atlasSize),defaults)
  for(const i of [0,8,16,bytes.byteLength-1]){const bad=bytes.slice(0);new Uint8Array(bad)[i]^=1;expect(()=>decodeSurfaceProject(bad)).toThrow()}
  expect(()=>decodeSurfaceProject(bytes.slice(0,-1))).toThrow()
 })
 it('отклоняет лишние данные и мерки вне диапазона или шага',()=>{
  const field=freshField(atlasSize), d=measurementsDefs[0]
  for(const body of [{...defaults,name:'не сохранять'},{...defaults,[d.key]:NaN},{...defaults,[d.key]:d.max+d.step},{...defaults,[d.key]:d.min+d.step/2}])expect(()=>encodeSurfaceProject(field,body)).toThrow()
 })
 it('ограничивает и ядро, и кольцо на границе маски без потери массы',()=>{
  const zone=new SurfaceZone(), field=freshField(atlasSize), center=fromUV('torso',.5,.5,defaults)
  zone.dab(center,7,defaults)
  const brush=new SurfaceBrush(4,center.part,defaults,zone.contains), p={x:center.x+6,y:center.y}
  for(let n=0;n<10;n++)brush.stamp(field,p)
  let lost=0,gained=0,leaks=0
  field.forEach((v,i)=>{if(v===1)return;if(!zone.contains(i%atlasSize.width,Math.floor(i/atlasSize.width)))leaks++;if(v<1)lost+=1-v;else gained+=v-1})
  expect(leaks).toBe(0);expect(lost).toBeGreaterThan(0);expect(gained).toBeCloseTo(lost,10)
 })
 it('без разрешённого кольца поле неизменно; clear снова разрешает перенос',()=>{
  const zone=new SurfaceZone(), p=fromUV('torso',.5,.5,defaults), field=freshField(atlasSize)
  zone.dab(p,0,defaults)
  const brush=new SurfaceBrush(4,p.part,defaults,zone.contains)
  brush.stamp(field,p);expect(field.every(v=>v===1)).toBe(true)
  zone.clear();brush.stamp(field,p);expect(field.some(v=>v<1)).toBe(true)
 })
 it('у каждого края массоперенос остаётся внутри выбранного участка',()=>{
  const field=freshField(atlasSize)
  for(const part of parts){field.fill(1);const brush=new SurfaceBrush(10,part,defaults), c=chart(part,defaults)
   for(const u of [0,1])for(const v of [0,1])brush.stamp(field,fromUV(part,u,v,defaults))
   let changed=0,mass=0;field.forEach((value,i)=>{mass+=value;if(value===1)return;changed++;const x=i%atlasSize.width,y=Math.floor(i/atlasSize.width);if(x<c.x||x>c.x+c.w||y<c.y||y>c.y+c.rows)throw Error(part)})
   expect(changed).toBeGreaterThan(0);expect(mass).toBeCloseTo(field.length,6)
  }
 })
})
