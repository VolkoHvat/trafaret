import { createStore } from 'idb-keyval'
import { decodeField } from './field-document'
import { sizeOf, LARGE, SMALL } from './field-size'
import { writeTile, TILE, type Patch } from './field-tiles'
import { encodePigmentTile, PigmentField, isPigmentChannel, type PigmentDelta, type PigmentSnapshot } from './pigment'
import { defaults, workspace, type Workspace } from './field-workspace'

const slot=createStore('trafaret-density-2','documents')
export class WorkspaceConflict extends Error {}
export function preferredWorkspace() {
  return slot('readonly',store=>new Promise<typeof SMALL|typeof LARGE>((resolve,reject)=>{
    const legacy=store.getKey('current'),small=store.getKey(IDBKeyRange.bound('384/','384/\uffff')),large=store.getKey(IDBKeyRange.bound('2048/','2048/\uffff'))
    store.transaction.onabort=()=>reject(store.transaction.error)
    store.transaction.oncomplete=()=>resolve(!legacy.result&&!small.result&&large.result?LARGE:SMALL)
  }))
}
function revision(value:unknown):number {
  if(value===undefined)return 0
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value===Number.MAX_SAFE_INTEGER)throw Error('Повреждена ревизия документа')
  return value
}
// A single readonly transaction prevents mixing metadata and tiles from different commits.
export function restoreWorkspace(staged:Float64Array){
  const size=sizeOf(staged.length), prefix=`${size.width}/`, count=Math.ceil(size.width/TILE)*Math.ceil(size.height/TILE)
  return slot('readonly',store=>new Promise<{data:boolean;metadata:Workspace|null;revision:number}>((resolve,reject)=>{
    const tx=store.transaction;let data=false,rev=0,metadata:Workspace|null=null
    const colors:PigmentSnapshot={version:2,...size,tiles:[]}
    tx.onabort=()=>reject(tx.error??Error('Чтение отменено'));tx.oncomplete=()=>{
      if(colors.tiles.length){try{PigmentField.restore(colors);metadata={...(metadata??defaults()),pigment:colors}}catch(err){reject(err);return}}
      resolve({data,metadata,revision:rev})
    }
    if(size===SMALL){const old=store.get('current');old.onsuccess=()=>{try{if(old.result!==undefined){staged.set(decodeField(old.result));data=true}}catch{tx.abort()}}}
    const records=store.openCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'))
    records.onsuccess=()=>{const c=records.result;if(!c)return
      try{const key=String(c.key).slice(prefix.length)
        if(key==='revision')rev=revision(c.value)
        else if(key==='workspace')metadata=workspace(c.value,staged.length)
        else if(key.startsWith('pigment/')){const parts=key.split('/');if(parts.length!==3)throw Error('Повреждён ключ пигмента');colors.tiles.push({channel:parts[1] as 'line'|'fill',id:Number(parts[2]),pixels:c.value});data=true}
        else{const id=Number(key);if(!Number.isInteger(id)||String(id)!==key||id<0||id>=count)throw Error('Повреждён ключ тайла');writeTile(staged,id,c.value);data=true}
        c.continue()
      }catch{tx.abort()}
    }
  }))
}
export function saveBatch(width:number,tiles:Patch,metadata:Workspace|null,expected:number,pigment?:PigmentDelta,side:'before'|'after'='after'){
  const size=width===LARGE.width?LARGE:width===SMALL.width?SMALL:null
  if(!size)throw RangeError('workspace size')
  const cells=size.width*size.height,cols=Math.ceil(width/TILE),count=cols*Math.ceil(size.height/TILE)
  if(pigment&&(pigment.width!==width||pigment.height!==size.height||metadata?.pigment))throw Error('Sparse batch needs matching large field and metadata without snapshot')
  return slot('readwrite',store=>new Promise<number>((resolve,reject)=>{
    const tx=store.transaction,key=`${width}/revision`,read=store.get(key)
    let failure:unknown
    tx.oncomplete=()=>resolve(expected+1)
    tx.onabort=()=>reject(failure??tx.error??Error('Запись отменена'))
    read.onsuccess=()=>{try{
      if(revision(read.result)!==expected)throw new WorkspaceConflict()
      for(const [id,tile] of tiles){
        if(!Number.isInteger(id)||id<0||id>=count||!(tile instanceof Float64Array)||tile.length!==Math.min(TILE,size.height-Math.floor(id/cols)*TILE)*Math.min(TILE,width-id%cols*TILE))throw Error('Повреждён тайл')
        store.put(tile,`${width}/${id}`)
      }
      const prefix=`${width}/pigment/`
      const previous=pigment?store.get(`${width}/workspace`):null
      if(metadata){
        const checked=workspace(metadata,cells)
        // Old four-argument calls replace the complete metadata (including ink).
        if(!pigment){
          store.delete(IDBKeyRange.bound(prefix,prefix+'\uffff'))
          if(checked.pigment){const snap=checked.pigment.version===2?checked.pigment:PigmentField.restore(checked.pigment).snapshot(2)
            for(const t of snap.tiles)store.put(t.pixels,prefix+t.channel+'/'+t.id)
            delete checked.pigment
          }
        }
        store.put(checked,`${width}/workspace`)
      }
      if(previous&&pigment)previous.onsuccess=()=>{try{
        if(previous.result?.pigment){const old=workspace(previous.result,cells);for(const t of PigmentField.restore(old.pigment!).snapshot(2).tiles)store.put(t.pixels,prefix+t.channel+'/'+t.id);delete old.pigment;if(!metadata)store.put(old,`${width}/workspace`)}
        for(const t of pigment.tiles){
        if(!Number.isInteger(t.id)||t.id<0||t.id>=count||!isPigmentChannel(t.channel))throw Error('Повреждён тайл пигмента')
        const k=prefix+t.channel+'/'+t.id, pixels=t[side]
        if(pixels===null)store.delete(k);else store.put(encodePigmentTile(pixels,t.channel),k)
      }
      }catch(err){failure=err;tx.abort()}}
      store.put(expected+1,key)
    }catch(err){failure=err;try{tx.abort()}catch{/* already aborting */}}}
  }))
}
