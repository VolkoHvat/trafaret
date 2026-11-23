import type { Gesture } from './gesture-diagnostic'
import { sizeOf } from './field-size'
import { TILE } from './field-tiles'

export type Segment = { x1:number; y1:number; x2:number; y2:number }
export function densitySection(g:Gesture, s:Segment) {
  if (!g.available) return null
  const {width,height}=sizeOf(g.cells)
  const {x1,y1,x2,y2}=s
  if (![x1,x2].every(x=>Number.isInteger(x)&&x>=0&&x<width) || ![y1,y2].every(y=>Number.isInteger(y)&&y>=0&&y<height)) return null
  const n=Math.min(512,Math.max(Math.abs(x2-x1),Math.abs(y2-y1))+1)
  return Array.from({length:n},(_,i)=>{
    const t=i/Math.max(1,n-1), x=Math.round(x1+(x2-x1)*t), y=Math.round(y1+(y2-y1)*t)
    const id=Math.floor(y/TILE)*Math.ceil(width/TILE)+Math.floor(x/TILE)
    const a=g.base.get(id), b=g.result.get(id)
    if (!a || !b) return null
    const offset=y%TILE*Math.min(TILE,width-(x-x%TILE))+x%TILE
    return {before:a[offset],after:b[offset],delta:b[offset]-a[offset]}
  })
}
