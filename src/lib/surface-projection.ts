import { atlasSize, capFraction, chart, connected, type Hit, type Part, type Settings } from './surface-model'
import { islandsFor, parts } from './surface-body'
import type { Size } from './field-size'
import { PathInput, Transfer } from './density-transfer'

/** Inverse of the ray pick, including both rounded ends. Distances are local,
 * not an assertion that a double-curved body can be unwrapped isometrically. */
export function surfaceFrame(part: Part, u: number, v: number, settings: Settings, atlas: Size = atlasSize) {
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) throw new RangeError('surface UV')
  const c = chart(part, settings, atlas), f = capFraction(c), angle = (u-.5)*2*Math.PI
  const sx = Math.sin(angle), sz = Math.cos(angle), upper = v <= f, lower = v >= 1-f
  const theta = upper ? v/f*Math.PI/2 : lower ? Math.PI-(1-v)/f*Math.PI/2 : Math.PI/2
  const ring = (v===0 || v===1) ? 0 : Math.sin(theta), pole = upper || lower ? Math.cos(theta) : 0
  const y = upper || lower ? (upper ? c.core : -c.core) + c.end*pole : (.5-v)*c.core/(.5-f)
  const r = upper ? c.upper : lower ? c.lower : (c.lower+c.upper)/2+y*c.slope
  const nx = ring*sx/(c.rx*r), ny = pole/c.end-c.lean*nx-(upper||lower?0:c.slope/r), nz = ring*sz/(c.rz*r)
  const norm = Math.hypot(nx,ny,nz), rt = r*Math.hypot(c.rx*sz,c.rz*sx)
  const mt = Math.hypot(r*c.rx*sx*pole-c.lean*c.end*ring,c.end*ring,r*c.rz*sz*pole)
  const mmPerUnitUV = { u:2*Math.PI*ring*rt, v: upper || lower ? mt*Math.PI/(2*f) : Math.hypot(1,c.lean+c.rx*c.slope*sx,c.rz*c.slope*sz)*c.core/(.5-f) }
  return {
    positionMm: { x:c.cx+c.lean*y+c.rx*r*ring*sx, y:c.cy+y, z:c.cz+c.rz*r*ring*sz },
    normal: { x:nx/norm, y:ny/norm, z:nz/norm },
    mmPerUnitUV, mmPerAtlasCell: { x:mmPerUnitUV.u/c.w, y:mmPerUnitUV.v/c.rows },
    curvaturePerMm: { u:1/(norm*rt*rt), v:upper || lower ? 1/(norm*mt*mt) : 0 },
  }
}

/** One gesture; caller owns the field, capture/rollback, and sample timestamps in ms. */
export function surfaceStroke(field: Float64Array, brush: Transfer, atlas: Size = atlasSize) {
  const islands = islandsFor(atlas)
  if (field.length !== atlas.width * atlas.height) throw new RangeError('surface atlas size')
  let path: PathInput | null = null
  let previous: Hit | null = null
  return (hit: Hit | null, time?: number) => {
    if (!hit) { path = null; previous = null; return }
    if (!parts.includes(hit.part) || !(hit.u>=0 && hit.u<=1 && hit.v>=0 && hit.v<=1) || (time !== undefined && !Number.isFinite(time))) throw new RangeError('surface sample')
    const c=islands[hit.part]
    if (!Number.isFinite(hit.x) || !Number.isFinite(hit.y) || Math.abs(hit.x-c.x-hit.u*c.w)>1e-7 || Math.abs(hit.y-c.y-hit.v*c.rows)>1e-7) throw new RangeError('surface atlas coordinates')
    const point = { x: hit.x, y: hit.y, time }
    if (!path || !connected(previous, hit)) path = new PathInput(field, brush, point)
    else path.move(point)
    previous = hit
  }
}
