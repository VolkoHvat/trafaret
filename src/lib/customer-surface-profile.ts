import { freshField, WIDTH, Transfer, type Point, type BufferMode } from './density-transfer'
import { capture, type Patch } from './field-tiles'
import { chart, type Part } from './surface-model'
import type { Size } from './field-size'
import { texelBounds } from './surface-body'
import { decodeField, encodeField } from './field-document'
import { atlasSize, defaults, measurementsDefs, type Settings } from './surface-model'

// v1 binds the measurements to this surface atlas, not to the generic .tfw schema.
const magic = 'TRAFSRF1', header = 16, maxMetadata = 8192
const fieldBytes = 24 + 8 * atlasSize.width * atlasSize.height
export const maxProjectBytes = header + maxMetadata + fieldBytes

export function validMeasurement(value: number, def: { min:number; max:number; step:number }) {
  const steps = (value - def.min) / def.step
  return Number.isFinite(value) && value >= def.min && value <= def.max && Math.abs(steps - Math.round(steps)) < 1e-7
}
export function measurements(input: unknown): Settings {
  if (!input || typeof input !== 'object') throw Error('Неверный состав мерок')
  const hasPreset = Object.hasOwn(input,'preset')
  if (Object.keys(input).length !== measurementsDefs.length + Number(hasPreset)) throw Error('Неверный состав мерок')
  const body: Settings = { ...defaults }
  if (hasPreset) {
    const preset = (input as Settings).preset
    if (preset !== 'male' && preset !== 'female') throw Error('Неизвестная форма тела')
    body.preset = preset
  }
  for (const def of measurementsDefs) {
    const value: unknown = (input as Record<string, unknown>)[def.key]
    if (typeof value !== 'number' || !validMeasurement(value, def)) throw Error(`Недопустимая мерка: ${def.label}`)
    body[def.key] = value
  }
  return body
}
function checksum(data: Uint8Array) {
  let hash = 2166136261
  for (const value of data) hash = Math.imul(hash ^ value, 16777619)
  return hash >>> 0
}
export function encodeSurfaceProject(field: Float64Array, body: Settings) {
  if (field.byteLength !== fieldBytes - 24) throw Error('Размер атласа не совпадает')
  const meta = new TextEncoder().encode(JSON.stringify(measurements(body)))
  const bytes = new Uint8Array(header + meta.length + fieldBytes), view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode(magic)); view.setUint32(8, meta.length, true); view.setUint32(12, checksum(meta), true)
  bytes.set(meta, header); bytes.set(new Uint8Array(encodeField(field)), header + meta.length)
  return bytes.buffer
}
export function decodeSurfaceProject(buffer: ArrayBuffer) {
  if (buffer.byteLength < header || buffer.byteLength > maxProjectBytes || new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== magic) throw Error('Неизвестный формат проекта поверхности')
  const v = new DataView(buffer), len = v.getUint32(8, true)
  if (!len || len > maxMetadata || buffer.byteLength !== header + len + fieldBytes) throw Error('Неверная длина проекта')
  const meta = new Uint8Array(buffer, header, len)
  if (checksum(meta) !== v.getUint32(12, true)) throw Error('Повреждены мерки')
  const body = measurements(JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(meta)))
  return { body, field: decodeField(buffer.slice(header + len)) }
}

/** Derive the round kernel from Transfer; at an atlas edge redistribute mass only within the same chart. */
export class SurfaceBrush extends Transfer {
  private reach: number
  private coreWeights: [number,number,number][] = []
  private ringWeights: [number,number,number][] = []
  private bounds: {left:number; right:number; top:number; bottom:number}
  private readonly predicate?: (x:number, y:number)=>boolean
  private before?: Patch
  private readonly atlas: Size
  private readonly noBuffer: boolean
  constructor(radius:number, part:Part, settings:Settings, predicate?: (x:number, y:number)=>boolean, before?:Patch, atlas: Size = atlasSize, bufferMode:BufferMode='full') {
    super({radius,buffer:3,bufferMode})
    this.before = before
    this.noBuffer = bufferMode === 'off'
    this.predicate = predicate
    this.reach = radius + 3
    this.atlas = { ...atlas }
    this.bounds = texelBounds(chart(part, settings, atlas))
    // Probe only the brush stencil, not the user's atlas.
    if (this.noBuffer) {this.reach = radius;return}
    const kernel = freshField(), center=this.reach
    super.stamp(kernel,{x:center,y:center})
    for(let y=-center;y<=center;y++) for(let x=-center;x<=center;x++) {
      const delta=kernel[(y+center)*WIDTH+x+center]-1
      if(delta<0)this.coreWeights.push([x,y,-delta]); else if(delta>0)this.ringWeights.push([x,y,delta])
    }
  }
  override stamp(field:Float64Array,p:Point) {
    const {width,height}=this.atlas
    if(field.length!==width*height) throw new RangeError('surface atlas size')
    const x=Math.round(p.x),y=Math.round(p.y), b=this.bounds,e=this.reach
    const rect={left:Math.max(x-e,b.left),right:Math.min(x+e,b.right),top:Math.max(y-e,b.top),bottom:Math.min(y+e,b.bottom)}
    const inside=(dx:number,dy:number)=>x+dx>=b.left&&x+dx<=b.right&&y+dy>=b.top&&y+dy<=b.bottom&&(!this.predicate||this.predicate(x+dx,y+dy))
    if(this.noBuffer){this.pigmentCore(width,x,y,inside);return rect}
    if(this.before)capture(this.before,field,rect)
    if(!this.predicate&&x-e>=b.left&&x+e<=b.right&&y-e>=b.top&&y+e<=b.bottom)return super.stamp(field,p)
    let mass=0,sum=0
    for(const [dx,dy,w] of this.ringWeights)if(inside(dx,dy))sum+=w
    if(sum>0){
      if(this.material){const samples=(weights:[number,number,number][]):[number,number][]=>weights.filter(([dx,dy])=>inside(dx,dy)).map(([dx,dy,w])=>[(y+dy)*width+x+dx,w]);this.material(samples(this.coreWeights).map(([i,w])=>[i,Math.min(1,field[i])*w]),samples(this.ringWeights))}
      for(const [dx,dy,w] of this.coreWeights)if(inside(dx,dy)){const i=(y+dy)*width+x+dx,take=field[i]*w;field[i]-=take;mass+=take}
      for(const [dx,dy,w] of this.ringWeights)if(inside(dx,dy))field[(y+dy)*width+x+dx]+=mass*w/sum
    }
    return {left:Math.max(x-e,b.left),right:Math.min(x+e,b.right),top:Math.max(y-e,b.top),bottom:Math.min(y+e,b.bottom)}
  }
}
