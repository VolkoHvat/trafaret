import { HISTORY_BYTES, readTile, writeTile, type Patch, type TileHistory } from './field-tiles'
import { sizeOf } from './field-size'
import type { PigmentDelta, PigmentField } from './pigment'

/** Record a completed joint operation or roll it back if it cannot fit as one undo. */
export function commitSharedEdit(history:TileHistory,field:Float64Array,before:Patch,ink:PigmentField,delta:PigmentDelta) {
  let bytes=0
  for(const tile of before.values())bytes+=tile.byteLength
  for(const t of delta.tiles)bytes+=(t.before?.byteLength??0)+(t.after?.byteLength??0)
  if(bytes>HISTORY_BYTES){
    ink.apply(delta,'before');for(const [id,t] of before)writeTile(field,id,t)
    throw RangeError('Operation exceeds shared history budget')
  }
  history.commit(before,delta)
}

/** Capture completed operations immediately, including undo/redo. Swap the entire batch
 * before awaiting saveBatch; never collect edits into an in-flight batch. */
export class SharedFieldBatch {
  readonly density:Patch=new Map()
  private readonly colors=new Map<string,PigmentDelta['tiles'][number]>()
  private readonly field:Float64Array
  constructor(field:Float64Array){this.field=field}
  collect(patch:Patch,delta?:PigmentDelta,side:'before'|'after'='after'){
    const size=sizeOf(this.field.length)
    if(delta&&(delta.width!==size.width||delta.height!==size.height))throw RangeError('pigment dimensions')
    for(const id of patch.keys())this.density.set(id,readTile(this.field,id))
    for(const t of delta?.tiles??[])this.colors.set(t.channel+'/'+t.id,{channel:t.channel,id:t.id,before:null,after:t[side]})
  }
  get dirty(){return this.density.size>0||this.colors.size>0}
  prepend(older:SharedFieldBatch){for(const [id,t] of older.density)if(!this.density.has(id))this.density.set(id,t);for(const [k,t] of older.colors)if(!this.colors.has(k))this.colors.set(k,t)}
  get pigment():PigmentDelta{return {...sizeOf(this.field.length),tiles:[...this.colors.values()]}}
}
