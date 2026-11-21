import { project } from './density-transfer'
import { MIX_CAPACITY, type MixCell, type RGB, mixingBrush } from './pigment-mixing'
import type { Mode } from './density-transfer'

export const PIGMENT_TILE = 32
const AREA = PIGMENT_TILE ** 2
const MAX_SIDE = 2048
export type PigmentChannel = 'line' | 'fill' | 'mixMR' | 'mixGB' | 'mixLine'
const channels = ['line','fill','mixMR','mixGB','mixLine'] as const
export const isPigmentChannel=(s:unknown):s is PigmentChannel=>channels.some(c=>c===s)
const mixed=(c:PigmentChannel)=>c==='mixMR'||c==='mixGB'||c==='mixLine'
export type Pigment = Readonly<{ r: number; g: number; b: number; opacity: number }> // all sRGB/alpha bytes, 0..255
export type PigmentTile = { channel: PigmentChannel; id: number; pixels: Uint32Array }
export type PigmentDelta = { width: number; height: number; tiles: { channel: PigmentChannel; id: number; before: Uint32Array | null; after: Uint32Array | null }[] }
export type PigmentSnapshot = { version: 1 | 2; width: number; height: number; tiles: { channel: PigmentChannel; id: number; pixels: number[] | number | string }[] }

// V2: uniform word or exactly 1024 little-endian RGBA words in base64.
export function encodePigmentTile(data: Uint32Array, channel: PigmentChannel='line') {
  if (!(data instanceof Uint32Array) || data.length !== AREA || !data.some(Boolean) || (!mixed(channel) && !data.every(validRGBA))) throw new RangeError('pigment tile data')
  if (data.every(p => p === data[0])) return data[0]
  const bytes = new Uint8Array(AREA * 4), view = new DataView(bytes.buffer)
  data.forEach((p, i) => view.setUint32(i * 4, p, true))
  return btoa(String.fromCharCode(...bytes))
}
function validRGBA(p: number) { return Number.isInteger(p) && (p === 0 || p >= 0x01000000 && p <= 0xffffffff) }
function decodeTile(version: number, pixels: number[] | number | string, channel:PigmentChannel) {
  const validWord = mixed(channel) ? (p:number)=>Number.isInteger(p)&&p>=0&&p<=0xffffffff : validRGBA
  if (version === 1 && Array.isArray(pixels) && pixels.length === AREA && pixels.every(validWord) && pixels.some(Boolean)) return Uint32Array.from(pixels)
  if (version === 2 && typeof pixels === 'number' && pixels && validWord(pixels)) return new Uint32Array(AREA).fill(pixels)
  if (version === 2 && typeof pixels === 'string' && pixels.length === Math.ceil((AREA * Uint32Array.BYTES_PER_ELEMENT) / 3) * 4) {
    const raw = atob(pixels)
    if (raw.length === AREA*4) {
      const words = new Uint32Array(AREA)
      for (let i=0;i<AREA;i++) {const j=i*4; words[i]=raw.charCodeAt(j) + raw.charCodeAt(j+1)*256 + raw.charCodeAt(j+2)*65536 + raw.charCodeAt(j+3)*16777216}
      if (words.some(Boolean) && words.every(validWord)) return words
    }
  }
  throw new RangeError('pigment snapshot data')
}
export type PigmentBoundary = (index: number) => boolean

function byte(n: number) { return Number.isInteger(n) && n >= 0 && n <= 255 }
function pack(color: Pigment | null) {
  if (!color) return 0
  const { r, g, b, opacity } = color
  if (![r, g, b, opacity].every(byte)) throw new RangeError('pigment sRGB/opacity bytes')
  return opacity === 0 ? 0 : ((opacity << 24) | (r << 16) | (g << 8) | b) >>> 0
}
function unpack(p: number): Pigment | null {
  return p ? { r: (p >>> 16) & 255, g: (p >>> 8) & 255, b: p & 255, opacity: p >>> 24 } : null
}

export function pigmentBoundary(rho: Float64Array, mode: Mode = 'stencil', maxShade = 64): PigmentBoundary {
  if (!byte(maxShade)) throw new RangeError('projection threshold')
  return i => project(rho[i], mode) <= maxShade
}

export class PigmentField {
  readonly width: number
  readonly height: number
  private readonly layers: Record<PigmentChannel, Map<number, Uint32Array>> = { line: new Map(), fill: new Map(), mixMR: new Map(), mixGB: new Map(), mixLine: new Map() }
  get hasInk(){return !!(this.layers.line.size||this.layers.fill.size||this.layers.mixMR.size||this.layers.mixGB.size)}
  private revision = 0
  constructor(width: number, height: number) {
    if (![width, height].every(v => Number.isInteger(v) && v >= 1 && v <= MAX_SIDE)) throw new RangeError('pigment dimensions')
    this.width = width; this.height = height
  }
  private tile(x: number, y: number) { return (y >>> 5) * Math.ceil(this.width / PIGMENT_TILE) + (x >>> 5) }
  private index(i: number) {
    if (!Number.isInteger(i) || i < 0 || i >= this.width * this.height) throw new RangeError('pigment pixel index')
  }
  mixPlane(ch:'mixMR'|'mixGB', id:number){return this.layers[ch].get(id)}
  mixAt(index:number): MixCell|null {
    if(!this.layers.mixMR.size)return null
    const x=index%this.width,y=Math.floor(index/this.width),id=this.tile(x,y),off=(y&31)*32+(x&31)
    const mr=this.layers.mixMR.get(id)?.[off]??0
    if(!mr)return null
    const gb=this.layers.mixGB.get(id)?.[off]??0
    return {mass:mr>>>16,scattering:[mr&65535,gb>>>16,gb&65535]}
  }
  mixBoundary(i:number){const x=i%this.width,y=Math.floor(i/this.width);return !!this.layers.mixLine.get(this.tile(x,y))?.[(y&31)*32+(x&31)]}
  materialStroke(deposit?:ReturnType<typeof mixingBrush>) {
    const planes={mixMR:new Map<number,Uint32Array>(),mixGB:new Map<number,Uint32Array>()}
    const address=(i:number)=>{const x=i%this.width,y=Math.floor(i/this.width);return [this.tile(x,y),(y&31)*32+(x&31)]}
    const read=(i:number):MixCell=>{const [id,k]=address(i),word=(ch:keyof typeof planes)=>(planes[ch].get(id)??this.layers[ch].get(id))?.[k]??0,mr=word('mixMR'),gb=word('mixGB');return {mass:mr>>>16,scattering:[mr&65535,gb>>>16,gb&65535]}}
    const write=(i:number,mass:number,s:RGB)=>{const [id,k]=address(i);for(const ch of ['mixMR','mixGB'] as const){const word=ch==='mixMR'?((mass<<16)|s[0])>>>0:((s[1]<<16)|s[2])>>>0;let t=planes[ch].get(id);const old=this.layers[ch].get(id);if(((t??old)?.[k]??0)===word)continue;if(!t){t=old?.slice()??new Uint32Array(AREA);planes[ch].set(id,t)}t[k]=word}}
    const rgb=(f:(k:number)=>number):RGB=>[f(0),f(1),f(2)]
    return {
      stamp:(core:[number,number][],ring:[number,number][])=>{
        const donors=core.map(([i,w])=>({i,cell:read(i),w})).map(d=>({...d,offer:Math.floor(d.cell.mass*d.w*.5)}))
        let offered=0;for(const d of donors)offered+=d.offer
        if(offered){
          let sum=0;for(const [,w] of ring)sum+=w
          let cumulative=0,allocated=0,accepted=0
          const shares=ring.map(([i,w])=>{cumulative+=w;const quota=Math.round(offered*(cumulative/sum)),c=read(i),n=Math.min(quota-allocated,MIX_CAPACITY-c.mass);allocated=quota;accepted+=n;return {i,c,n}})
          let removed=0,seen=0;const pool=[0,0,0]
          for(const {i,cell:c,offer} of donors){seen+=offer;const total=Math.round(accepted*(seen/offered)),n=total-removed;removed=total;if(!n)continue;const taken=rgb(k=>Math.round(c.scattering[k]*n/c.mass));write(i,c.mass-n,rgb(k=>c.scattering[k]-taken[k]));taken.forEach((v,k)=>pool[k]+=v)}
          for(const {i,c,n} of shares){if(!n)continue;const add=rgb(k=>Math.round(pool[k]*n/removed));write(i,c.mass+n,rgb(k=>c.scattering[k]+add[k]));removed-=n;add.forEach((v,k)=>pool[k]-=v)}
        }
        if(deposit)for(const [i] of core){const old=read(i),next=deposit(old.mass?old:null).after;if(next)write(i,next.mass,next.scattering)}
      },
      delta:():PigmentDelta=>{const tiles:PigmentDelta['tiles']=[];for(const ch of ['mixMR','mixGB'] as const)for(const [id,t] of planes[ch])tiles.push({channel:ch,id,before:this.layers[ch].get(id)?.slice()??null,after:t.some(Boolean)?t:null});return {width:this.width,height:this.height,tiles}}
    }
  }
  prepareMix(indices:Iterable<number>, brush:ReturnType<typeof mixingBrush>,line=false):PigmentDelta {
    const changes={mixMR:new Map<number,Uint32Array>(),mixGB:new Map<number,Uint32Array>(),mixLine:new Map<number,Uint32Array>()}
    const cache=new Map<string,MixCell|null>()
    for(const i of indices){
      this.index(i)
      const x=i%this.width,y=Math.floor(i/this.width),id=this.tile(x,y),off=(y&31)*32+(x&31)
      const old=this.mixAt(i),key=old?`${old.mass}:${old.scattering}`:''
      let next=cache.get(key)
      if(next===undefined){next=brush(old).after;if(cache.size<4096)cache.set(key,next)}
      if(!next)continue
      const [r,g,b]=next.scattering
      for(const ch of ['mixMR','mixGB','mixLine'] as const){
        if(ch==='mixLine'&&!line)continue
        const word=ch==='mixLine'?1:ch==='mixMR'?((next.mass<<16)|r)>>>0:((g<<16)|b)>>>0, originals=this.layers[ch].get(id)
        if((originals?.[off]??0)===word)continue
        let tile=changes[ch].get(id)
        if(!tile){tile=originals?.slice()??new Uint32Array(AREA);changes[ch].set(id,tile)}
        tile[off]=word
      }
    }
    const delta:PigmentDelta={width:this.width,height:this.height,tiles:[]}
    for(const ch of ['mixMR','mixGB','mixLine'] as const)for(const [id,tile] of changes[ch])delta.tiles.push({channel:ch,id,before:this.layers[ch].get(id)?.slice()??null,after:tile.some(Boolean)?tile:null})
    return delta
  }
  get(channel: 'line'|'fill', index: number) {
    this.index(index)
    const x = index % this.width, y = Math.floor(index / this.width)
    return unpack(this.layers[channel].get(this.tile(x, y))?.[(y & 31) * 32 + (x & 31)] ?? 0)
  }
  /** Row-major pixel indices. null erases only the selected channel; stencil writes nothing. */
  paint(channel: PigmentChannel, indices: Iterable<number>, color: Pigment | null, mode: 'pigment' | 'stencil' = 'pigment'): PigmentDelta {
    const delta: PigmentDelta = { width: this.width, height: this.height, tiles: [] }
    if (mode === 'stencil') return delta
    const value = pack(color), changes = new Map<number, Uint32Array>(), layer = this.layers[channel]
    let remaining = this.width * this.height
    for (const i of indices) {
      if (--remaining < 0) throw new RangeError('pigment work budget')
      this.index(i)
      const x = i % this.width, y = Math.floor(i / this.width), id = this.tile(x, y), offset = (y & 31) * 32 + (x & 31)
      let tile = changes.get(id)
      const old = layer.get(id)
      if (((tile ?? old)?.[offset] ?? 0) === value) continue
      if (!tile) { tile = old?.slice() ?? new Uint32Array(AREA); changes.set(id, tile) }
      tile[offset] = value
    }
    for (const [id, tile] of changes) delta.tiles.push({ channel, id, before: layer.get(id)?.slice() ?? null, after: tile.some(Boolean) ? tile : null })
    this.apply(delta, 'after')
    return delta
  }
  apply(delta: PigmentDelta, side: 'before' | 'after') {
    if (delta.width !== this.width || delta.height !== this.height) throw new RangeError('pigment dimensions')
    for (const tile of delta.tiles) {
      const pixels = tile[side]
      this.checkTile(tile.channel, tile.id)
      if (pixels !== null && (!(pixels instanceof Uint32Array) || pixels.length !== AREA)) throw new RangeError('pigment tile data')
    }
    for (const tile of delta.tiles) {
      const layer = this.layers[tile.channel], pixels = tile[side]
      if (pixels) layer.set(tile.id, pixels.slice()); else layer.delete(tile.id)
    }
    if (delta.tiles.length) this.revision++
  }
  private checkTile(channel: PigmentChannel, id: number) {
    if (!isPigmentChannel(channel) || !Number.isInteger(id) || id < 0 || id >= Math.ceil(this.width / 32) * Math.ceil(this.height / 32)) throw new RangeError('pigment tile')
  }
  clear(): PigmentDelta {
    const delta:PigmentDelta={width:this.width,height:this.height,tiles:[]}
    for(const channel of channels)for(const [id,pixels] of this.layers[channel])delta.tiles.push({channel,id,before:pixels.slice(),after:null})
    this.apply(delta,'after');return delta
  }
  snapshot(version: 1 | 2 = this.width === MAX_SIDE ? 2 : 1): PigmentSnapshot {
    const tiles: PigmentSnapshot['tiles'] = []
    for (const channel of channels) for (const [id, data] of [...this.layers[channel]].sort(([a], [b]) => a - b)) tiles.push({ channel, id, pixels: version === 1 ? Array.from(data) : encodePigmentTile(data,channel) })
    return { version, width: this.width, height: this.height, tiles }
  }
  static restore(snapshot: PigmentSnapshot) {
    if ((snapshot.version !== 1 && snapshot.version !== 2) || !Array.isArray(snapshot.tiles)) throw new RangeError('pigment snapshot')
    const field = new PigmentField(snapshot.width, snapshot.height)
    for (const { channel, id, pixels } of snapshot.tiles) {
      field.checkTile(channel, id)
      if (field.layers[channel].has(id)) throw new RangeError('pigment snapshot data')
      field.layers[channel].set(id, decodeTile(snapshot.version, pixels, channel))
    }
    return field
  }
  /** Deterministic 4-connected BFS. Queue grows to 4*min(area,maxCells) bytes;
   * during growth the previous queue is also live. Visited uses ceil(area/8) bytes. */
  previewFill(seed: number, boundary: PigmentBoundary, maxCells = this.width * this.height) {
    this.index(seed)
    const { width, height } = this, area = width * height, revision = this.revision
    if (!Number.isSafeInteger(maxCells) || maxCells < 1) throw new RangeError('fill budget')
    const limit = Math.min(area, maxCells)
    let queue: Uint32Array | null = new Uint32Array(Math.min(1024, limit))
    const visited = new Uint8Array(Math.ceil(area / 8))
    let head = 0, count = 0, reachedEdge = false, truncated = false
    function visit(i: number) {
      const mask = 1 << (i & 7)
      if (visited[i >>> 3] & mask) return
      visited[i >>> 3] |= mask
      if (boundary(i)) return
      const x = i % width
      if (!x || x === width - 1 || i < width || i >= area - width) reachedEdge = true
      if (count === limit) { truncated = true; return }
      if (count === queue!.length) {const grown = new Uint32Array(Math.min(limit, count * 2)); grown.set(queue!); queue = grown}
      queue![count++] = i
    }
    visit(seed)
    while (head < count && !truncated) {
      const i = queue[head++], x = i % width
      if (x) visit(i - 1)
      if (x + 1 < width) visit(i + 1)
      if (i >= width) visit(i - width)
      if (i + width < area) visit(i + width)
    }
    return { count, reachedEdge, truncated,
      indices:()=>{if(!queue||truncated||revision!==this.revision)throw Error('cancelled, incomplete or stale pigment fill');return queue.subarray(0,count)},
      forEach: (fn: (index: number) => void) => { for (let i = 0; queue && i < count; i++) fn(queue[i]) },
      cancel: () => { queue = null },
      commit: (color: Pigment | null, mode: 'pigment' | 'stencil' = 'pigment', confirmOpen = false) => {
        if (width === MAX_SIDE && reachedEdge && mode !== 'stencil' && !confirmOpen) throw new Error('Open contour needs confirmation')
        if (!queue || truncated || revision !== this.revision) throw new Error('cancelled, incomplete or stale pigment fill')
        const delta = this.paint('fill', queue.subarray(0, count), color, mode)
        queue = null
        return delta
      },
    }
  }
}
