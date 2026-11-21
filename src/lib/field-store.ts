import { createStore, get, getMany, setMany } from 'idb-keyval'
import { decodeField } from './field-document'
import { sizeOf, SMALL } from './field-size'
import { TILE, writeTile } from './field-tiles'
import type { Patch } from './field-tiles'

const slot = createStore('trafaret-density-2', 'documents')
export async function restoreField(field: Float64Array, live: () => boolean) {
  const size = sizeOf(field.length), width = size.width
  // Tile records are absolute replacements over the original demo/legacy or blank base.
  let restored = false
  if (size === SMALL) {
    const old = await get<ArrayBuffer>('current', slot)
    if (!live()) return false
    if (old !== undefined) { field.set(decodeField(old)); restored = true }
  }
  const count = Math.ceil(width/TILE)*Math.ceil(size.height/TILE)
  for (let i=0; i<count; i+=128) {
    const values = await getMany<Float64Array>(Array.from({length:Math.min(128,count-i)},(_,j)=>`${width}/${i+j}`),slot)
    if (!live()) return false
    values.forEach((v,j)=>{ if(v!==undefined){ writeTile(field,i+j,v); restored=true } })
  }
  return restored
}
export function saveTiles(width:number, patch:Patch){
  return setMany([...patch].map(([id,v])=>[`${width}/${id}`,v]),slot)
}
