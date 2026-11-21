import { expect,it } from 'vitest'
import { PigmentField } from './pigment'
import { TileHistory,readTile } from './field-tiles'
import { SharedFieldBatch,commitSharedEdit } from './shared-field-patch'
import { defaults,pack,unpack } from './field-workspace'

const color={r:50,g:78,b:10,opacity:91}, n=2048**2
it('one reversible sparse rho + ink operation, captured save batches and lossless workspace',async()=>{
  const rho=new Float64Array(n).fill(1), ink=new PigmentField(2048,2048), history=new TileHistory(), batch=new SharedFieldBatch(rho)
  const before=new Map([[0,readTile(rho,0)]]);rho[0]=0.5;rho[1]=1.5
  const delta=ink.paint('line',[0],color);commitSharedEdit(history,rho,before,ink,delta);batch.collect(before,delta)
  expect(history.bytes).toBe(12288);expect(batch.pigment.tiles).toHaveLength(1)
  expect(()=>history.travel(rho,false)).toThrow();expect(history.undoCount).toBe(1)
  const undone=history.travel(rho,false,ink)!;batch.collect(undone,history.pigmentDelta(undone),'before')
  expect(ink.hasInk).toBe(false);expect(rho[0]).toBe(1);expect(batch.pigment.tiles[0].after).toBeNull();expect(batch.density.get(0)![1]).toBe(1)
  history.travel(rho,true,ink);expect(rho[1]).toBe(1.5);expect(ink.get('line',0)).toEqual(color)
  const snap=ink.snapshot(),{meta,field}=await unpack(pack(rho,{...defaults(),pigment:snap}),n)
  expect(Buffer.compare(Buffer.from(field.buffer),Buffer.from(rho.buffer))).toBe(0)
  expect(PigmentField.restore(meta!.pigment!).get('line',0)).toEqual(color)
  expect(()=>pack(new Float64Array(384*240).fill(1),{...defaults(),pigment:snap})).toThrow()
})
it('rolls back an over-budget joint edit without losing earlier history',()=>{
  const field=new Float64Array(n).fill(1),ink=new PigmentField(2048,2048),history=new TileHistory()
  const prior=ink.paint('fill',[42],color);commitSharedEdit(history,field,new Map(),ink,prior)
  // A full rho replacement alone is exactly the history budget; one ink tile crosses it.
  const unit=new Float64Array(1024).fill(1),before=new Map(Array.from({length:4096},(_,id)=>[id,unit] as const))
  field[0]=0.5;field[1]=1.5;const delta=ink.paint('line',[0],color)
  expect(()=>commitSharedEdit(history,field,before,ink,delta)).toThrow('budget')
  expect([field[0],field[1]]).toEqual([1,1]);expect(ink.get('line',0)).toBeNull();expect(ink.get('fill',42)).toEqual(color);expect(history.undoCount).toBe(1)
})
it('confirms the entire open region before applying, permits exact undo and compact export',()=>{
  const ink=new PigmentField(2048,2048),start=performance.now(),p=ink.previewFill(0,()=>false)
  expect(p.count).toBe(n);expect(p.truncated).toBe(false);expect(()=>p.commit(color)).toThrow('confirmation');expect(ink.hasInk).toBe(false)
  const delta=p.commit(color,'pigment',true);expect(delta.tiles).toHaveLength(4096)
  expect(ink.get('fill',n-1)).toEqual(color);const ms=performance.now()-start, length=JSON.stringify(ink.snapshot()).length
  expect(length).toBeLessThan(256*1024);ink.apply(delta,'before');expect(ink.hasInk).toBe(false)
  console.info({cells:p.count,previewAndCommitMs:Math.round(ms),snapshotBytes:length})
})
