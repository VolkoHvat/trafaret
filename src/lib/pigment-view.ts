import type { PigmentField, Pigment } from './pigment'
import { projectMix } from './pigment-mixing'
import { tileRect, type Patch } from './field-tiles'

export function hexPigment(hex:string):Pigment {
  if(!/^#[0-9a-f]{6}$/i.test(hex))throw Error('Нужен цвет #RRGGBB')
  const rgb=parseInt(hex.slice(1),16);return {r:rgb>>>16,g:(rgb>>>8)&255,b:rgb&255,opacity:255}
}
export function* depleted(before:Patch,rho:Float64Array,width:number){
  for(const [id,tile] of before){const r=tileRect(rho,id);let j=0
    for(let y=r.top;y<=r.bottom;y++)for(let x=r.left;x<=r.right;x++,j++){const i=y*width+x;if(rho[i]<tile[j])yield i}
  }
}
export function composite(data:Uint8ClampedArray,offset:number,pigment:PigmentField,i:number,mixed=pigment.mixAt(i)){
  if(mixed){const c=projectMix([data[offset],data[offset+1],data[offset+2]],mixed,'pigment');data[offset]=c[0];data[offset+1]=c[1];data[offset+2]=c[2]}
  for(const channel of ['fill','line'] as const){const c=pigment.get(channel,i);if(!c)continue
    const a=c.opacity/255;data[offset]=data[offset]*(1-a)+c.r*a;data[offset+1]=data[offset+1]*(1-a)+c.g*a;data[offset+2]=data[offset+2]*(1-a)+c.b*a
  }
}
