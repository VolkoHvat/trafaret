import { anatomyMetric, drawAnatomy } from './surface-anatomy'
import { SMALL, type Size } from './field-size'
import { body, islandsFor, parts, tau, type Part, type Settings, type Segment } from './surface-body'
export { names, parts, defaults, measurementsDefs, cellMm, texelBounds } from './surface-body'
export type { Part, Settings } from './surface-body'
export type Camera = { yaw: number; pitch: number; zoom: number; focus: Part | null; panX?: number; panY?: number }
export const front: Camera = { yaw: 0, pitch: 0, zoom: 1, focus: null }
export const atlasSize = SMALL
export type Hit = { part: Part; u: number; v: number; x: number; y: number }
export function chart(part: Part, s: Settings, atlas: Size = SMALL) {
  if (!parts.includes(part)) throw new RangeError('surface part')
  return { ...body(s)[part], ...islandsFor(atlas)[part] }
}
function atlasHit(part: Part, u: number, v: number, size: Size): Hit {
  const c = islandsFor(size)[part]; return { part, u, v, x: c.x + u * c.w, y: c.y + v * c.rows }
}
export function fromUV(part: Part, u: number, v: number, s: Settings, atlas: Size = SMALL): Hit {
  chart(part, s, atlas)
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) throw new RangeError('surface UV')
  return atlasHit(part, u, v, atlas)
}
export function flatHit(x: number, y: number, s: Settings, atlas: Size = SMALL): Hit | null {
  body(s)
  const islands = islandsFor(atlas)
  for (const part of parts) {
    const c = islands[part]
    const right = c.x+c.w, bottom = c.y+c.rows
    if (x < Math.min(c.x,Math.round(c.x)) || x > Math.max(right,Math.round(right)) ||
        y < Math.min(c.y,Math.round(c.y)) || y > Math.max(bottom,Math.round(bottom)) || !Number.isFinite(x+y)) continue
    const px = Math.max(c.x,Math.min(x,right)), py = Math.max(c.y,Math.min(y,bottom))
    return { part, x:px, y:py, u:Math.min(1,(px-c.x)/c.w), v:Math.min(1,(py-c.y)/c.rows) }
  }
  return null
}
export function connected(a: Hit | null, b: Hit) { return a?.part === b.part && Math.abs(a.u - b.u) < .5 }
function size(w: number, h: number) {
  if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || w <= 0 || h <= 0 || w * h > 4194304) throw new RangeError('surface viewport')
  return w * h
}
export function sceneBuffers(w: number, h: number) {
  const n = size(w, h)
  return { depth: new Float32Array(n), ids: new Int8Array(n), uv: new Float32Array(n * 2), shade: new Uint8Array(n), indices: new Int32Array(n) }
}
// Each end uses a half ellipsoid; v traverses its meridian by polar angle,
// not height, so the old flat cylinder ends now receive ordinary texture samples.
export const capFraction = (c: Segment) => c.core === 0 ? .5 : (Math.PI / 2 * c.r) / (2 * c.core + Math.PI * c.r)
export function surfacePitch(hit:Pick<Hit,'part'|'u'|'v'>,s:Settings,atlas:Size,geometry:'body'|'schematic') {
  const {part,u,v}=hit, c=chart(part,s,atlas)
  if(geometry==='body')return anatomyMetric(s,body(s),parts.indexOf(part),u,v,c.w,c.rows)
  const cap=capFraction(c), angle=(u-.5)*tau, sin=Math.sin(angle),cos=Math.cos(angle)
  function position(t:number){
    let y:number, ring:number
    if(t<cap||t>=1-cap){const upper=t<cap, a=(upper?t:1-t)/cap*Math.PI/2; y=(upper?1:-1)*(c.core+c.end*Math.cos(a));ring=(upper?c.upper:c.lower)*Math.sin(a)}
    else{y=(.5-t)*c.core/(.5-cap);ring=(c.upper+c.lower)/2+y*c.slope}
    return [c.rx*ring*sin+y*c.lean,y,c.rz*ring*cos,ring]
  }
  const lo=Math.max(0,v-1e-5),hi=Math.min(1,v+1e-5),a=position(lo),b=position(hi)
  return {u:Math.hypot(c.rx*cos,c.rz*sin)*position(v)[3]*tau/c.w,v:Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])/(hi-lo)/c.rows}
}
function frontRoot(a: number, b: number, c: number) {
  const disc = b * b - a * c
  if (Math.abs(a)<1e-20) return b>1e-12 ? -c/(2*b) : -Infinity
  return disc < 0 ? -Infinity : (-b + Math.sqrt(disc)) / a
}
export function scene(w: number, h: number, s: Settings, cam: Camera, buffers = sceneBuffers(w, h), atlas: Size = SMALL, mode: 'body'|'schematic' = 'schematic') {
  const islands = islandsFor(atlas)
  const n = size(w,h), { depth, ids, uv, indices, shade } = buffers
  if (depth.length !== n || ids.length !== n || indices.length !== n || shade.length !== n || uv.length !== 2*n) throw new RangeError('surface buffers')
  const centerX = w * (.5 + (cam.panX ?? 0)), centerY = h * (.5 + (cam.panY ?? 0))
  if (![cam.yaw, cam.pitch, cam.zoom, centerX, centerY].every(Number.isFinite) || cam.zoom <= 0 || cam.zoom > 1000 || (cam.focus !== null && !parts.includes(cam.focus))) throw new RangeError('surface camera')
  const shapes = body(s), f = cam.focus ? shapes[cam.focus] : null
  const top = shapes.head.cy + shapes.head.ry, width = Math.max(...Object.values(shapes).map(c => 2*(Math.abs(c.cx)+Math.abs(c.lean)*c.ry+c.rx)))
  const fx = f?.cx ?? 0, fy = f?.cy ?? top / 2, fz = f?.cz ?? 0, scale = Math.min(w/(width*1.12), h/(top*1.06))*cam.zoom
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch)
  const dx = sy*cp, dy = sp, dz = cy*cp
  depth.fill(-Infinity); ids.fill(-1); indices.fill(-1)
  if (mode==='body') drawAnatomy(w,h,s,shapes,atlas,buffers,(x,y,z)=>{
    x-=fx;y-=fy;z-=fz
    return {x:centerX+(x*cy-z*sy)*scale,y:centerY-(y*cp-(x*sy+z*cy)*sp)*scale,z:x*dx+y*dy+z*dz}
  })
  else for (const [id, part] of parts.entries()) {
    const c = shapes[part], island = islands[part], { rx, rz, core, end, lean } = c
    const X=c.cx-fx, Y=c.cy-fy, Z=c.cz-fz, px=X*cy-Z*sy, py=Y*cp-(X*sy+Z*cy)*sp
    const maxRing=Math.max(c.upper,c.lower), sx=centerX+px*scale, sty=centerY-py*scale, extentX=rx*maxRing+Math.abs(lean)*c.ry
    const bx=(Math.abs(cy)*extentX+Math.abs(sy)*rz*maxRing)*scale, by=(Math.abs(cp)*c.ry+Math.abs(sp)*(extentX+rz*maxRing))*scale
    const ax = (dx-lean*dy)/rx, az=dz/rz, ay=dy/end, horizontal=ax*ax+az*az, cap=capFraction(c)
    for(let y=Math.max(0,Math.floor(sty-by));y<=Math.min(h-1,Math.ceil(sty+by));y++) {
      const yy=(centerY-y-.5)/scale, oy=yy*cp-Y
      for(let x=Math.max(0,Math.floor(sx-bx));x<=Math.min(w-1,Math.ceil(sx+bx));x++) {
        const xx=(x+.5-centerX)/scale, ox=(xx*cy-yy*sp*sy-X-lean*oy)/rx, oz=(-xx*sy-yy*sp*cy-Z)/rz
        const b=ox*ax+oz*az, q=ox*ox+oz*oz-1
        const base=(c.upper+c.lower)*.5+oy*c.slope, ds=dy*c.slope
        let t=frontRoot(horizontal-ds*ds,b-base*ds,q+1-base*base), sign=0
        if (!Number.isFinite(t) || Math.abs(oy+t*dy)>core || core===0) t=-Infinity
        for(let k=-1;k<=1;k+=2) {
          const r=k>0?c.upper:c.lower, o=(oy-k*core)/end, root=frontRoot(horizontal+r*r*ay*ay,b+r*r*o*ay,q+1+r*r*(o*o-1))
          if(root>t && k*(oy+root*dy)>=core) { t=root; sign=k }
        }
        const i=y*w+x
        if(t<=depth[i]) continue
        const hx=ox+t*ax, hz=oz+t*az, hy=oy+t*dy, nx=hx/rx, nz=hz/rz
        const r=sign ? (sign>0?c.upper:c.lower) : base+t*ds
        const ny=(sign ? r*r*(hy-sign*core)/(end*end) : -r*c.slope)-lean*nx
        const u=(.5+Math.atan2(hx,hz)/tau)%1, angle=Math.atan2(Math.hypot(hx,hz)/r,Math.abs(hy-sign*core)/end)
        const v=sign ? (sign>0 ? 0 : 1)+sign*cap*angle/(Math.PI/2) : .5-hy*(.5-cap)/core
        depth[i]=t; ids[i]=id; uv[2*i]=u; uv[2*i+1]=Math.max(0,Math.min(1,v))
        indices[i]=Math.round(island.x+uv[2*i]*island.w)+atlas.width*Math.round(island.y+uv[2*i+1]*island.rows)
        shade[i]=Math.round(110+48*(-.4*nx+.45*ny+.75*nz)/Math.hypot(nx,ny,nz))
      }
    }
  }
  return { w,h,ids,uv,indices,shade, hit(x:number,y:number) {
    if (!(x>=0 && y>=0 && x<w && y<h)) return null
    const i=Math.floor(y)*w+Math.floor(x)
    return ids[i]<0 ? null : atlasHit(parts[ids[i]], uv[i*2], uv[i*2+1], atlas)
  } }
}
