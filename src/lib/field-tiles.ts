import type { PigmentDelta, PigmentField } from './pigment'
import { sizeOf } from './field-size'
import type { Rect } from './density-transfer'
export const TILE = 32, HISTORY_BYTES = 32 * 1024 * 1024
export type Patch = Map<number, Float64Array>
export function tileRect(field: Float64Array, id: number): Rect {
  const { width, height } = sizeOf(field.length), cols = Math.ceil(width / TILE)
  const left = (id % cols) * TILE, top = Math.floor(id / cols) * TILE
  return { left, top, right: Math.min(width, left + TILE) - 1, bottom: Math.min(height, top + TILE) - 1 }
}
export function readTile(field: Float64Array, id: number) {
  const r = tileRect(field, id), stride = sizeOf(field.length).width, w = r.right-r.left+1
  const a = new Float64Array(w * (r.bottom-r.top+1))
  for (let y=r.top; y<=r.bottom; y++) a.set(field.subarray(y*stride+r.left,y*stride+r.right+1),(y-r.top)*w)
  return a
}
export function writeTile(field: Float64Array, id: number, a: Float64Array, swap = false) {
  const r = tileRect(field,id), stride = sizeOf(field.length).width, w = r.right-r.left+1
  if (!(a instanceof Float64Array) || a.length !== w*(r.bottom-r.top+1)) throw Error('Повреждён тайл')
  for(let y=r.top;y<=r.bottom;y++) for(let x=r.left;x<=r.right;x++) {
    const i=y*stride+x,j=(y-r.top)*w+x-r.left, old=field[i]; field[i]=a[j]; if(swap) a[j]=old
  }
}
export function capture(patch: Patch, field: Float64Array, r: Rect) {
  const cols = Math.ceil(sizeOf(field.length).width/TILE)
  for(let y=r.top>>5;y<=r.bottom>>5;y++) for(let x=r.left>>5;x<=r.right>>5;x++) {
    const id=y*cols+x; if(!patch.has(id)) patch.set(id,readTile(field,id))
  }
}
export function replacement(field: Float64Array, next: Float64Array) {
  if(field.length!==next.length) throw Error('Размер документа не совпадает')
  const patch: Patch = new Map(), {width,height}=sizeOf(field.length)
  for(let id=0;id<Math.ceil(width/TILE)*Math.ceil(height/TILE);id++) {
    const r=tileRect(field,id); let changed=false
    for(let y=r.top;y<=r.bottom&&!changed;y++) for(let x=r.left;x<=r.right;x++) if(!Object.is(field[y*width+x],next[y*width+x])) {changed=true; break}
    if(changed) patch.set(id,readTile(field,id))
  }
  field.set(next); return patch
}
export class TileHistory {
  private past: Patch[]=[]; private future: Patch[]=[]
  private colors=new WeakMap<Patch,PigmentDelta>()
  get undoCount(){return this.past.length} get redoCount(){return this.future.length}
  get bytes(){return [...this.past,...this.future].reduce((n,p)=>n+(this.colors.get(p)?.tiles.reduce((s,t)=>s+(t.before?.byteLength??0)+(t.after?.byteLength??0),0)??0)+[...p.values()].reduce((b,a)=>b+a.byteLength,0),0)}
  commit(p: Patch, pigment?: PigmentDelta){ if(!p.size&&!pigment?.tiles.length)return; if(pigment)this.colors.set(p,pigment); this.future=[]; this.past.push(p); while(this.past.length>12||this.bytes>HISTORY_BYTES)this.past.shift() }
  pigmentDelta(p:Patch){return this.colors.get(p)}
  travel(field:Float64Array,redo:boolean,pigment?:PigmentField){const source=redo?this.future:this.past,p=source.at(-1); if(!p)return; const delta=this.colors.get(p);if(delta){if(!pigment)throw Error('Missing pigment layer');pigment.apply(delta,redo?'after':'before')} for(const [id,a] of p)writeTile(field,id,a,true); source.pop();(redo?this.past:this.future).push(p); return p}
}
