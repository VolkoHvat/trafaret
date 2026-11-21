import { expect, it } from 'vitest'
import { chart, defaults, flatHit, front, fromUV, parts, scene } from './surface-model'
import { surfaceFrame, surfaceStroke } from './surface-projection'
import { freshField, Transfer } from './density-transfer'

it('measures positions, tangents, unit normals and curvature on sides and rounded caps', () => {
  const eps=1e-6
  for(const part of parts) {
    const c=chart(part,defaults)
    expect(surfaceFrame(part,.5,0,defaults).positionMm.y).toBeCloseTo(c.cy+c.ry)
    expect(surfaceFrame(part,.5,1,defaults).positionMm.y).toBeCloseTo(c.cy-c.ry)
    for(const v of [.03,.47,.97]) {
      const a=surfaceFrame(part,.37,v,defaults), p=a.positionMm, n=a.normal
      expect(Math.hypot(n.x,n.y,n.z)).toBeCloseTo(1,10)
      for(const axis of ['u','v'] as const) {
        const b=surfaceFrame(part,.37+(axis==='u'?eps:0),v+(axis==='v'?eps:0),defaults).positionMm
        const dx=(b.x-p.x)/eps, dy=(b.y-p.y)/eps, dz=(b.z-p.z)/eps
        expect(Math.hypot(dx,dy,dz)).toBeCloseTo(a.mmPerUnitUV[axis],2)
        expect(dx*n.x+dy*n.y+dz*n.z).toBeCloseTo(0,2)
        expect(a.curvaturePerMm[axis]).toBeGreaterThanOrEqual(0)
      }
    }
  }
  expect(() => surfaceFrame('shin', NaN, 0, defaults)).toThrow(RangeError)
})

it('deposits identical density from visible scene pixels and flat picks', () => {
  const view = scene(301, 301, defaults, { ...front, focus: 'torso', zoom: 2.5 })
  const a = freshField(), b = freshField(), brush = new Transfer({ radius: 3, buffer: 3 })
  const surface = surfaceStroke(a, brush), flat = surfaceStroke(b, brush)
  for (let x = 112; x <= 188; x += 4) {
    const hit = view.hit(x, 150)!
    expect(hit.part).toBe('torso')
    const unwrapped = flatHit(hit.x, hit.y, defaults)!
    expect(unwrapped.part).toBe(hit.part)
    expect(Math.round(unwrapped.y) * 384 + Math.round(unwrapped.x)).toBe(view.indices[150 * view.w + x])
    surface(hit); flat(unwrapped)
  }
  expect(a.some(rho => rho !== 1)).toBe(true)
  expect(a.every((rho, i) => rho === b[i])).toBe(true)
})

it('breaks a gesture on seam, chart switch or miss without a connecting mark', () => {
  const brush = new Transfer({ radius: 3, buffer: 3 })
  const hits = [fromUV('torso', .01, .5, defaults), fromUV('torso', .99, .5, defaults),
    fromUV('shin', .7, .5, defaults), null, fromUV('shin', .3, .5, defaults)]
  const actual = freshField(), isolated = freshField(), stroke = surfaceStroke(actual, brush)
  for (const hit of hits) {
    stroke(hit)
    if (hit) brush.stamp(isolated, hit)
  }
  expect(actual.every((rho, i) => rho === isolated[i])).toBe(true)
})

it('inverts actual picks to their pixel centers, including side views, sheared arms and ends', () => {
  for(const [yaw,pitch] of [[0,0],[Math.PI,0],[1.4,.6],[-.8,-.95],[0,Math.PI/2]]) {
    const w=191,h=263,zoom=1.1,focus='torso', f=chart(focus,defaults), head=chart('head',defaults)
    const width=Math.max(...parts.map(p=>{ const c=chart(p,defaults); return 2*(Math.abs(c.cx)+Math.abs(c.lean)*c.ry+c.rx) }))
    const scale=Math.min(w/(width*1.12),h/((head.cy+head.ry)*1.06))*zoom
    const view=scene(w,h,defaults,{yaw,pitch,zoom,focus})
    for(let i=0;i<w*h;i+=113) {
      const hit=view.hit(i%w,Math.floor(i/w)); if(!hit) continue
      const p=surfaceFrame(hit.part,hit.u,hit.v,defaults).positionMm, x=p.x-f.cx,y=p.y-f.cy,z=p.z-f.cz
      expect(w/2+(x*Math.cos(yaw)-z*Math.sin(yaw))*scale).toBeCloseTo(i%w+.5,3)
      expect(h/2-(y*Math.cos(pitch)-(x*Math.sin(yaw)+z*Math.cos(yaw))*Math.sin(pitch))*scale).toBeCloseTo(Math.floor(i/w)+.5,3)
    }
  }
})
