import { PathInput, Transfer, project } from './density-transfer'
import type { Brush, Point, Rect } from './density-transfer'
import { sizeOf } from './field-size'
import { capture, readTile, tileRect, writeTile } from './field-tiles'
import type { Patch } from './field-tiles'

export const LIMIT = { samples: 4096, stamps: 2048, tiles: 256 }
export type Sample = Point & { pressure: number; packet: number }
export class Gesture {
  samples: Sample[] = []; base: Patch = new Map(); result: Patch = new Map()
  reason = ''; cancelled = false; dropped = 0; peak = 0; packets = 0; stamps = 0
  brush: Brush; source: string; cells: number
  constructor(cells:number, brush:Brush, source:string){this.cells=cells; this.brush={...brush}; this.source=source}
  sample(p:Point, pressure:number){
    if(this.samples.length < LIMIT.samples)this.samples.push({...p,pressure,packet:this.packets})
    else this.reason ||= 'усечена: лимит точек'
  }
  before(field:Float64Array, r:Rect){
    if(this.reason)return
    if(++this.stamps>LIMIT.stamps){this.reason='усечена: лимит импульсов';return}
    // Include the largest supported alternate brush, even when the original is a tiny tap.
    const {width,height}=sizeOf(this.cells)
    capture(this.base,field,{left:Math.max(0,r.left-30),top:Math.max(0,r.top-30),right:Math.min(width-1,r.right+30),bottom:Math.min(height-1,r.bottom+30)})
    if(this.base.size>LIMIT.tiles){this.base.clear();this.reason='усечена: лимит тайлов'}
  }
  finish(field:Float64Array,cancelled:boolean){
    this.cancelled=cancelled
    if(!this.available){this.base.clear();return}
    for(const id of this.base.keys())this.result.set(id,readTile(field,id))
  }
  get available(){return !this.cancelled&&!this.reason&&!this.dropped}
}
export type Diff = { density:number; pixels:number; max:number }
export type ReplayData = Pick<Gesture,'samples'|'base'|'result'|'brush'|'cells'>
export function replay(g:ReplayData, brush:Brush){
  const field=new Float64Array(g.cells), width=sizeOf(g.cells).width
  function run(kernel:Brush, repack:boolean){
    for(const [id,a] of g.base)writeTile(field,id,a)
    const path=new PathInput(field,new Transfer(kernel),g.samples[0]); let budget=64, packet=-1, count=1
    for(let i=1;i<g.samples.length;i++){
      const p=g.samples[i], next=repack?Math.floor(i/17):p.packet
      if(packet!==next){budget=64;packet=next}
      for(;;){const step=path.move(p,budget,true);count+=step.count;budget-=step.count
        if(count>LIMIT.stamps+1)throw Error('Лимит работы повтора'); if(!budget)budget=64; if(!step.more)break}
    }
  }
  const snapshot=()=>new Map([...g.base.keys()].map(id=>[id,readTile(field,id)]))
  function diff(other:Patch):Diff{
    let density=0,pixels=0,max=0
    for(const [id,a] of other){const r=tileRect(field,id);let j=0
      for(let y=r.top;y<=r.bottom;y++)for(let x=r.left;x<=r.right;x++,j++){
        const m=field[y*width+x], d=Math.abs(m-a[j]);if(d){density++;max=Math.max(max,d);if(project(m,'tone')!==project(a[j],'tone'))pixels++}
      }
    }
    return {density,pixels,max}
  }
  run(g.brush,false);const original=diff(g.result), reference=snapshot()
  run(g.brush,true);const packing=diff(reference)
  run(brush,false);return {original,packing,selected:diff(g.result)}
}
