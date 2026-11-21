import { describe, expect, it } from 'vitest'
import { chart, defaults, flatHit, front, fromUV, scene, type Camera } from './surface-model'
import { surfaceFrame } from './surface-projection'

// A 20 cm forearm has a circular barrel. Only its equator is under test.
const part = 'forearm', settings = { ...defaults, forearmGirth: 20 }
const a = 3/8, b = 5/8, v = .5
const frame = (u: number) => surfaceFrame(part, u, v, settings)
const chord = (p: ReturnType<typeof frame>['positionMm'], q: typeof p) =>
  Math.hypot(q.x-p.x, q.y-p.y, q.z-p.z)

describe('50 mm reference arc on the circular forearm barrel', () => {
  it('resolves a quarter turn as surface length, not endpoint distance', () => {
    const c = chart(part, settings)
    expect(c.core).toBeGreaterThan(0)
    expect(c.rx).toBeCloseTo(100/Math.PI, 10)
    expect(c.rz).toBeCloseTo(c.rx, 10)
    const segments = 256
    let polyline = 0, previous = frame(a).positionMm
    for (let i = 1; i <= segments; i++) {
      const current = frame(a + (b-a)*i/segments)
      polyline += chord(previous, current.positionMm)
      previous = current.positionMm
    }
    expect(Math.abs(polyline-50)).toBeLessThan(.0001)
    expect(chord(frame(a).positionMm, previous)).toBeCloseTo(45.015815808, 8)
    expect((b-a)*frame(.5).mmPerUnitUV.u).toBeCloseTo(50, 10)
  })

  it('recovers 50 mm from continuous atlas coordinates in the metric development', () => {
    const c = chart(part, settings)
    const hits = [a,b].map(u => fromUV(part, u, v, settings))
    const mmPerAtlasX = frame(.5).mmPerUnitUV.u / c.w
    expect((hits[1].x-hits[0].x)*mmPerAtlasX).toBeCloseTo(50, 10)
    for (const [i, hit] of hits.entries()) {
      const picked = flatHit(hit.x, hit.y, settings)
      expect(picked?.part).toBe(part)
      expect(picked?.u).toBeCloseTo([a,b][i], 10)
      expect(picked?.v).toBeCloseTo(v, 10)
    }
  })

  it('picks the same arc in two cameras despite a different screen span', () => {
    function measure(camera: Camera) {
      const view = scene(600, 480, settings, camera)
      const targets = [a,b].map(u => ({ u, error: Infinity, x: 0, y: 0 }))
      for (let i = 0; i < view.ids.length; i++) {
        const hit = view.hit(i%view.w, Math.floor(i/view.w))
        if (hit?.part !== part) continue
        for (const t of targets) {
          const error = Math.hypot(hit.u-t.u, hit.v-v)
          if (error < t.error) Object.assign(t, {error, x:i%view.w, y:Math.floor(i/view.w)})
        }
      }
      const [p,q] = targets.map(t => {
        expect(t.error).toBeLessThan(.003)
        return view.hit(t.x,t.y)!
      })
      const arc = (q.u-p.u)*surfaceFrame(part,p.u,p.v,settings).mmPerUnitUV.u
      expect(Math.abs(arc-50)).toBeLessThan(.6)
      const pixels = Math.hypot(targets[0].x-targets[1].x, targets[0].y-targets[1].y)
      console.info(`Cylinder zoom ${camera.zoom}: ${arc.toFixed(4)} mm, ${pixels.toFixed(2)} px`)
      return pixels
    }
    const first = measure({ ...front, focus:part, zoom:12 })
    const second = measure({ focus:part, yaw:.25, pitch:.15, zoom:18, panX:.08 })
    expect(second-first).toBeGreaterThan(15)
  })
})
