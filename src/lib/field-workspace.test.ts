import { describe, expect, it } from 'vitest'
import { defaults, equilibrate, pack, unpack, workspace } from './field-workspace'
import { decodeField, encodeField } from './field-document'
import { TileHistory } from './field-tiles'
import { defaults as bodyDefaults } from './surface-body'
import { SMALL, LARGE } from './field-size'

describe('workspace',()=>{
  for(const size of [SMALL,LARGE]) it(`balanced edits and exact undo at ${size.width}`,()=>{
    const f=new Float64Array(size.width*size.height).fill(1);f[0]=0;f[8]=2
    const history=new TileHistory(), initial=encodeField(f)
    history.commit(equilibrate(f,0,0,3));expect(f[0]).toBe(1);expect(f[8]).toBe(2)
    expect(f[4]).toBeLessThan(1);expect(()=>decodeField(encodeField(f))).not.toThrow()
    history.travel(f,false);expect(Buffer.compare(Buffer.from(encodeField(f)),Buffer.from(initial))).toBe(0)
    history.travel(f,true);expect(f[0]).toBe(1)
  })
  it('round trips body placement and privacy-safe report metadata',async()=>{
    const f=new Float64Array(SMALL.width*SMALL.height).fill(1), meta={...defaults(),bodyPlacement:{version:1,bodyRegion:'forearm',side:'left',orientation:'front',placement:{x:.5,y:.5},widthMm:40,heightMm:80,rotation:5,wrap:'flat',safeMarginMm:3} as const,report:{optIn:true,score:1}}
    expect(await unpack(pack(f,meta),f.length)).toEqual({field:f,meta})
    expect(()=>workspace({...meta,report:'image'})).toThrow()
  })
  it('does not overdraw an exhausted ring',()=>{
    const f=new Float64Array(SMALL.width*SMALL.height);f[4]=1
    equilibrate(f,0,0,3);expect(f[0]).toBeGreaterThan(0);expect(f[0]).toBeLessThan(1);expect(f[4]).toBe(0);expect(f.reduce((a,b)=>a+b)).toBeCloseTo(1,12)
  })
  it('round trips body metadata without changing legacy document shape',async()=>{
    const f=new Float64Array(SMALL.width*SMALL.height).fill(1), body={...bodyDefaults,chest:100}
    const meta={...defaults(),surfaceBody:body};expect((await unpack(pack(f,meta),f.length)).meta).toEqual(meta)
    expect((await unpack(pack(f,defaults()),f.length)).meta).toEqual(defaults())
  })
  it('round trips metadata, detects corruption, opens legacy bytes',async()=>{
    const f=new Float64Array(SMALL.width*SMALL.height).fill(1), meta={...defaults(),name:'Эскиз',widthMm:92.5,opacity:.37}, doc=pack(f,meta)
    expect((await unpack(doc,f.length)).meta).toEqual(meta)
    expect((await unpack(new Blob([encodeField(f)]),f.length)).meta).toBe(null)
    await expect(unpack(doc,LARGE.width*LARGE.height)).rejects.toThrow()
    const bad=new Uint8Array(await doc.arrayBuffer());bad[17]^=1
    await expect(unpack(new Blob([bad]),f.length)).rejects.toThrow('метаданные')
    expect(()=>workspace({...meta,reference:'https://example.com/image.png'})).toThrow()
  })
})
