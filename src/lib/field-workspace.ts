import { decodeField, encodeField } from './field-document'
import { sizeOf } from './field-size'
import { capture, type Patch } from './field-tiles'
import type { Mode } from './density-transfer'
import { parseBodyPlacement, type BodyPlacement } from './body-placement'

import { measurements } from './customer-surface-profile'
import type { Settings } from './surface-model'

import { PigmentField, type PigmentSnapshot } from './pigment'

export type Workspace = { bufferMode?: 'full'|'off'; pigment?: PigmentSnapshot; surfaceBody?: Settings; name: string; widthMm: number; mode: Mode; opacity: number; reference: string | null; bodyPlacement?: BodyPlacement; report?: Record<string, unknown> }
export const defaults = ():Workspace => ({name:'Без названия', widthMm:100, mode:'tone', opacity:0.4, reference:null})
const magic = 'TFWORK01'
export const imageLimit = 6*1024*1024, metadataLimit = 8*1024*1024+4096

export function validateReference(url:string) {
  const png=url.startsWith('data:image/png;base64,'),jpeg=url.startsWith('data:image/jpeg;base64,')
  if((!png&&!jpeg)||url.length>Math.ceil(imageLimit/3)*4+23)throw Error('Требуется локальный PNG или JPEG до 6 МиБ')
  const data=url.slice(png?22:23), raw=atob(png?data.slice(0,32):data), byte=(i:number)=>raw.charCodeAt(i), word=(i:number)=>256*byte(i)+byte(i+1)
  let w=0,h=0
  if(png){
    if(raw.length<24||raw.slice(0,16)!=='\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR')throw Error('Неверный заголовок PNG')
    w=word(16)*65536+word(18);h=word(20)*65536+word(22)
  }else{
    if(word(0)!==0xffd8)throw Error('Неверный заголовок JPEG')
    for(let p=2;p+3<raw.length;){
      if(byte(p++)!==255)break
      while(byte(p)===255)p++
      const tag=byte(p++),len=word(p)
      if(tag===0xda||tag===0xd9||len<2||p+len>raw.length)break
      if(tag>=0xc0&&tag<=0xcf&&![0xc4,0xc8,0xcc].includes(tag)&&len>=8){h=word(p+3);w=word(p+5);break}
      p+=len
    }
  }
  if(!w||!h||w>4096||h>4096)throw Error('Подложка: нужен PNG/JPEG до 4096×4096')
}
export async function checkImage(url:string) {
  validateReference(url)
  const image=new Image(); image.src=url; await image.decode()
}
// Worst case at 2048²: every tile of all five pigment channels stored as base64
// (1024 words → 5464 chars) plus its JSON keys, on top of the ordinary metadata.
// A smaller limit made fully coloured documents impossible to save as .tfw.
const fullInk2048 = 5 * (2048 / 32) ** 2 * (5464 + 64)
const exportMetadataLimit = (cells:number) => cells === 2048**2 ? fullInk2048 + metadataLimit : metadataLimit
export function workspace(value:unknown,cells?:number):Workspace {
  if (!value || typeof value!=='object') throw Error('Нет метаданных документа')
  const {name,widthMm,mode,opacity,reference,bodyPlacement,report,pigment}=value as Workspace
  if(typeof name!=='string' || name.length>100 || !Number.isFinite(widthMm) || widthMm<=0 || widthMm>2000 || !['stencil','tone'].includes(mode) || !Number.isFinite(opacity) || opacity<0 || opacity>1 || (reference!==null && typeof reference!=='string')) throw Error('Недопустимые метаданные документа')
  const {bufferMode}=value as Workspace
  if(bufferMode!==undefined&&bufferMode!=='full'&&bufferMode!=='off')throw Error('Недопустимый режим буфера')
  if(reference!==null) validateReference(reference)
  if(pigment!==undefined){const size=sizeOf(cells??pigment.width*pigment.height);if(pigment.width!==size.width||pigment.height!==size.height)throw Error('Размер цветного атласа');PigmentField.restore(pigment)}
  if(bodyPlacement!==undefined) parseBodyPlacement(bodyPlacement)
  if(report!==undefined) {
    if(!report || typeof report!=='object' || Array.isArray(report)) throw Error('Недопустимый отчёт документа')
    const bytes=new TextEncoder().encode(JSON.stringify(report)); if(bytes.byteLength>4096) throw Error('Отчёт документа слишком велик')
  }
  return {name,widthMm,mode,opacity,reference,...(bufferMode===undefined?{}:{bufferMode}), ...('surfaceBody' in value ? {surfaceBody:measurements(value.surfaceBody)} : {}), ...(pigment===undefined?{}:{pigment}), ...(bodyPlacement===undefined ? {} : {bodyPlacement:parseBodyPlacement(bodyPlacement)}), ...(report===undefined ? {} : {report})}
}
function hash(bytes:Uint8Array){let h=2166136261;for(const b of bytes)h=Math.imul(h^b,16777619);return h>>>0}
export function pack(field:Float64Array, meta:Workspace){
  const json=new TextEncoder().encode(JSON.stringify(workspace({...meta,reference:null},field.length))), header=new ArrayBuffer(16), v=new DataView(header)
  if(json.length>exportMetadataLimit(field.length))throw Error('Метаданные документа слишком велики')
  new Uint8Array(header).set(new TextEncoder().encode(magic)); v.setUint32(8,json.length,true); v.setUint32(12,hash(json),true)
  return new Blob([header,json,encodeField(field)],{type:'application/octet-stream'})
}
export async function unpack(file:Blob, cells:number) {
  const length=cells*8+24
  if(file.size===length)return {field:decodeField(await file.arrayBuffer()), meta:null}
  if(file.size<length+16 || file.size>length+16+exportMetadataLimit(cells))throw Error('Откройте документ соответствующего размера (384×240 или 2048²)')
  const header=await file.slice(0,16).arrayBuffer(),v=new DataView(header),n=v.getUint32(8,true)
  if(new TextDecoder().decode(header.slice(0,8))!==magic || length+16+n!==file.size)throw Error('Неверный формат или размер документа')
  const json=new Uint8Array(await file.slice(16,16+n).arrayBuffer());if(hash(json)!==v.getUint32(12,true))throw Error('Повреждены метаданные документа')
  const meta=workspace(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(json)),cells)
  return {meta,field:decodeField(await file.slice(16+n).arrayBuffer())}
}

// Positive core deficits borrow from the annulus in proportion to available mass.
// If the annulus cannot pay in full, stop partway rather than making negative cells.
export function equilibrate(field:Float64Array,x:number,y:number,r:number):Patch {
  const {width,height}=sizeOf(field.length),before:Patch=new Map(),inner:number[]=[],ring:number[]=[]
  x=Math.floor(x); y=Math.floor(y)
  if(!Number.isInteger(r)||r<1||r>32||!(x>=0&&x<width&&y>=0&&y<height))return before
  const rect={left:Math.max(0,x-2*r),right:Math.min(width-1,x+2*r),top:Math.max(0,y-2*r),bottom:Math.min(height-1,y+2*r)}
  let need=0,available=0,changed=false
  for(let row=rect.top;row<=rect.bottom;row++)for(let col=rect.left;col<=rect.right;col++){
    const d=(row-y)**2+(col-x)**2,i=row*width+col
    if(d<=r*r){inner.push(i);need+=1-field[i];changed ||= field[i]!==1}
    else if(d<=4*r*r){ring.push(i);available+=field[i]}
  }
  const fraction=need>available?available/need:1
  if(!changed||!fraction||!ring.length)return before
  capture(before,field,rect)
  for(const i of inner)field[i]=fraction===1?1:field[i]+fraction*(1-field[i])
  for(const i of ring)field[i]=need>0?field[i]*(1-Math.min(1,need/available)):field[i]-need/ring.length
  return before
}
