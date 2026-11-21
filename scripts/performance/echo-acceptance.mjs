#!/usr/bin/env node
// Standalone density-transfer demo. Run with --rows for all paired measurements (JSON).
import assert from 'node:assert/strict'

const angles = [0, 22.5, 45, 90], positions = [-9, 0, 9]
const config = { side: 144, radius: 4, buffer: 3, stampStep: 3, arcRadius: 72,
  gap: [-30, -12], tensorRadius: 4, tensorSigma: 2, minCoherence: 0.35,
  share: 0.25, hop: 4, reach: 40, decayLength: 10, roiRadius: 3 }
const { side, radius, buffer, stampStep, arcRadius: R, hop, reach, decayLength } = config
const regions = ['end', 'axis', 'side', 'beyondGap']
function run(shape, angle, phase, scale) {
  const n = side * scale, area = 1 / scale ** 2, rad = angle * Math.PI / 180
  const c = Math.cos(rad), s = Math.sin(rad), origin = n / 2 + phase
  const xy = (x, y) => [origin + scale * (c*x - s*y), origin + scale * (s*x + c*y)]
  const arc = t => [R*Math.sin(t/R), R*(1-Math.cos(t/R))]
  const frozen = new Float64Array(n*n).fill(1), core = [], ring = [], window = []
  let norm = 0
  for (let j = -(radius+buffer)*scale; j <= (radius+buffer)*scale; j++) {
    for (let i = -(radius+buffer)*scale; i <= (radius+buffer)*scale; i++) {
      const r = Math.hypot(i,j)/scale, d = j*n+i
      if (r < radius) core.push([d, -Math.expm1(-0.8*(1-(r/radius)**2))])
      if (r > radius && r < radius+buffer) {
        const u = (r-radius)/buffer, w = 4*u*(1-u); ring.push([d,w]); norm += w
      }
      if (r <= config.tensorRadius) window.push([d, Math.exp(-0.5*(r/config.tensorSigma)**2)])
    }
  }
  function stamp(field, coord, deposits) {
    const [x,y] = xy(...coord).map(v => Math.floor(v+0.5+1e-10)), k=y*n+x
    let mass = 0
    for (const [d,w] of core) { const take = field[k+d]*w; field[k+d] -= take; mass += take }
    for (const [d,w] of ring) { const add = mass*w/norm; field[k+d] += add; if (deposits) deposits[k+d] += add }
  }
  for (let t=-54; shape !== 'flat' && t<=0; t+=stampStep) {
    if (shape !== 'broken' || t<=config.gap[0] || t>=config.gap[1]) stamp(frozen, arc(t))
  }
  function axis(k) {
    let xx=0, yy=0, cross=0
    for (const [d,w] of window) {
      const p=k+d, gx=(frozen[p+1]-frozen[p-1])*scale/2, gy=(frozen[p+n]-frozen[p-n])*scale/2
      xx+=w*gx*gx; yy+=w*gy*gy; cross+=w*gx*gy
    }
    if (xx+yy<1e-12 || Math.hypot(xx-yy,2*cross)<config.minCoherence*(xx+yy)) return null
    return Math.round((Math.atan2(2*cross,xx-yy)/2+Math.PI/2)/(Math.PI/4))*Math.PI/4
  }
  const rows=[]
  for (const pos of positions) {
    const ref=frozen.slice(), deposits=new Float64Array(n*n)
    for (let y=-18;y<=18;y+=stampStep) stamp(ref,[pos,y],deposits)
    // Only the surviving new ring surplus can leave; never borrow from the frozen arc.
    const out=ref.slice()
    let totalWeight=0
    for (let r=hop;r<=reach;r+=hop) totalWeight+=2*Math.exp(-r/decayLength)
    for (let k=0;k<ref.length;k++) {
      const amount=config.share*Math.min(deposits[k], Math.max(0,ref[k]-frozen[k]))
      if (!amount) continue
      const a=axis(k); if (a===null) continue
      out[k]-=amount
      // Frozen donor tangent, two rays, no recirculation. Bilinear deposit keeps hop length physical.
      for (let r=hop;r<=reach;r+=hop) for (const sign of [-1,1]) {
        const x=k%n+sign*r*scale*Math.cos(a), y=Math.floor(k/n)+sign*r*scale*Math.sin(a)
        const i=Math.floor(x), j=Math.floor(y), fx=x-i, fy=y-j
        assert(i>=0 && i+1<n && j>=0 && j+1<n)
        const m=amount*Math.exp(-r/decayLength)/totalWeight
        for (const [dx,wx] of [[0,1-fx],[1,fx]]) for (const [dy,wy] of [[0,1-fy],[1,fy]])
          out[(j+dy)*n+i+dx]+=m*wx*wy
      }
    }
    // Cell values are densities (cell mass / cell area). Signed integral = sum(density * area).
    // Also retain signed ROI mean and absolute impulse peak, relative to the frozen arc.
    const metrics={}
    const centers=[arc(0),arc(-9),[-9,-10],arc(-33)]
    for (const [idx,name] of regions.entries()) {
      const [x,y]=xy(...centers[idx]), rr=config.roiRadius*scale
      const m=metrics[name]={ cells:0, ref:[0,0], echo:[0,0], delta:[0,0] }
      for (let j=Math.ceil(y-rr);j<=y+rr;j++) for (let i=Math.ceil(x-rr);i<=x+rr;i++) {
        if ((i-x)**2+(j-y)**2>rr**2+1e-9) continue
        const k=j*n+i; m.cells++
        for (const [key,v] of [['ref',ref[k]-frozen[k]],['echo',out[k]-frozen[k]],['delta',out[k]-ref[k]]]) {
          m[key][0]=Math.max(m[key][0],Math.abs(v)); m[key][1]+=v*area
        }
      }
      for (const key of ['ref','echo','delta']) m[key].push(m[key][1]/(m.cells*area))
    }
    let balance=0, refBalance=0, moved=0
    for (let k=0;k<out.length;k++) {
      assert(Number.isFinite(out[k]) && out[k]>=0)
      const d=(out[k]-ref[k])*area; balance+=d; moved+=Math.max(0,d); refBalance+=(ref[k]-1)*area
    }
    assert(Math.abs(balance)<1e-8 && Math.abs(refBalance)<1e-8 && (shape!=='flat'||moved===0))
    rows.push({shape,angle,phase,scale,pos,metrics,balance,refBalance,moved})
  }
  return rows
}
const rows=[]
for (const shape of ['flat','continuous','broken']) for (const angle of angles)
  for (const phase of [0,0.5]) for (const scale of [1,2]) rows.push(...run(shape,angle,phase,scale))
assert.equal(rows.length,144)
const exemplar=rows.find(r=>r.shape==='broken' && !r.angle && !r.phase && r.scale===1 && !r.pos)
const range=xs=>[Math.min(...xs),Math.max(...xs)]
const select=(overrides={})=>rows.filter(r=>Object.entries({shape:'continuous',pos:0,...overrides}).every(([k,v])=>r[k]===v))
const axisMeans=group=>group.map(r=>r.metrics.axis.delta[2])
const gapPeak=Math.max(...select({shape:'broken'}).map(r=>r.metrics.beyondGap.delta[0]))
console.log(JSON.stringify({config, cases:rows.length, metricsOrder:['absPeakDensity','signedPhysicalIntegral','signedMeanDensity'],
  maxAbsBalance:Math.max(...rows.map(r=>Math.abs(r.balance))), maxAbsRefBalance:Math.max(...rows.map(r=>Math.abs(r.refBalance))),
  flatMoved:range(rows.filter(r=>r.shape==='flat').map(r=>r.moved)), exemplar,
  axisMeanByAngle:axisMeans(select({phase:0,scale:1})),axisMeanByPhase:axisMeans(select({angle:0,scale:1})),
  axisMeanByResolution:axisMeans(select({angle:0,phase:0})), gapPeak,
  decision:gapPeak>1e-10?'no go: echo crosses the empty gap':'inconclusive',
  ...(process.argv.includes('--rows')?{rows}:{})},null,2))
