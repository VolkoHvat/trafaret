import { registerHooks } from 'node:module'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

registerHooks({ resolve(specifier, context, next) {
  return next(specifier === './field-size' ? './field-size.ts' : specifier, context)
} })
const { Transfer, PathInput, freshField, DEFAULT, STEP, project } = await import('../../src/lib/density-transfer.ts')
const { SMALL, LARGE } = await import('../../src/lib/field-size.ts')
const { capture, TileHistory, HISTORY_BYTES } = await import('../../src/lib/field-tiles.ts')
const hash = f => createHash('sha256').update(new Uint8Array(f.buffer, f.byteOffset, f.byteLength)).digest('hex')
const P = (x, y, time = 0) => ({ x, y, time })
let pass = 0, fail = 0
for (const size of [SMALL, LARGE]) for (const shape of ['round','nib','refill']) {
  const { width: w, height: h } = size, brush = { ...DEFAULT, shape }, kernel = new Transfer(brush)
  const fresh = () => freshField(size), index = (x,y) => y*w+x
  let maxResidual = 0, minDensity = 1
  function invariant(f) {
    let residual = 0, min = 1
    for (let i=0;i<f.length;i++) { residual += f[i]-1; min = Math.min(min,f[i]) }
    assert.ok(min>=0 && Math.abs(residual)<1e-8, `min=${min} residual=${residual}`)
    maxResidual=Math.max(maxResidual,Math.abs(residual)); minDensity=Math.min(minDensity,min)
  }
  function stroke(f, pts, k=kernel, budget=Infinity) {
    const path = new PathInput(f,k,pts[0]); let count=1
    for (const p of pts.slice(1)) { let r; do { r=path.move(p,budget,true); count+=r.count } while(r.more) }
    return count
  }
  function check(name, fn) {
    try { const evidence = fn(); console.log('PASS',w,shape,name,evidence??''); pass++ }
    catch (e) { console.error('FAIL',w,shape,name,e.stack); fail++ }
  }
  const line = (y,t=96) => [P(80,y),P(176,y,t)]
  const interpolate = (pts,n) => pts.flatMap((p,i) => i===0 ? [p] : Array.from({length:n},(_,j) => {
    const a=pts[i-1], t=(j+1)/n; return P(a.x+(p.x-a.x)*t,a.y+(p.y-a.y)*t,a.time+(p.time-a.time)*t)
  }))
  for (const duration of [32,2048]) check(`straight/repack ${duration}ms`,()=>{
    const pts=line(96,duration), f=fresh(), g=fresh(), resumed=fresh()
    for(const [field,path,budget] of [[f,pts,Infinity],[g,interpolate(pts,16),Infinity],[resumed,pts,3]]) {
      assert.equal(stroke(field,path,kernel,budget),33); invariant(field)
    }
    assert.equal(hash(f),hash(g)); assert.equal(hash(f),hash(resumed)); assert.ok(f[index(128,96)]<1)
  })
  check('speed response',()=>{
    const f=fresh(),g=fresh(); stroke(f,line(96,32)); stroke(g,line(96,2048))
    const a=f[index(128,96)], b=g[index(128,96)]
    if(shape==='refill') assert.ok(b>a); else assert.equal(hash(f),hash(g)); return [a,b]
  })
  check('tap/hold + stop after movement',()=>{
    const f=fresh(), path=new PathInput(f,kernel,P(80,96)); assert.ok(f[index(80,96)]<1)
    for(const x of [80,176]) { if(x!==80) path.move(P(x,96,512)); const before=hash(f)
      for(let i=1;i<=20;i++) assert.equal(path.move(P(x,96,512+i*250)).count,0)
      assert.equal(hash(f),before); invariant(f)
    }
  })
  for(const [name,pts,length] of [
    ['loop',[P(80,80),P(100,80,20),P(100,100,40),P(80,100,60),P(80,80,80)],80],
    ['reverse',[P(80,80),P(100,80,20),P(80,80,40)],40],
  ]) check(name,()=>{
    const f=fresh(),g=fresh(); assert.equal(stroke(f,pts),1+Math.floor(length/STEP)); stroke(g,interpolate(pts,4)); invariant(f); assert.equal(hash(f),hash(g)); assert.ok(f[index(99,80)]<1 && f[index(80,80)]<1)
  })
  check('exact repeat',()=>{
    const f=fresh(); stroke(f,line(96)); const a=f[index(128,96)]; stroke(f,line(96)); invariant(f); const b=f[index(128,96)]; assert.ok(b<a && a-b<1-a); return [a,b]
  })
  for(const [name,a,b,interact] of [
    ['near',line(96),line(101),true],['far',line(96),line(150),false],
    ['acute',line(96),[P(80,72),P(176,120,96)],true],['right',line(96),[P(128,48),P(128,144,96)],true],
  ]) check(`${name} AB/BA`,()=>{
    const f=fresh(),g=fresh(); stroke(f,a); stroke(f,b); stroke(g,b); stroke(g,a); invariant(f); invariant(g)
    let diff=0,pixels=0; for(let i=0;i<f.length;i++) if(f[i]!==g[i]) { diff+=Math.abs(f[i]-g[i]); pixels+=Number(project(f[i],'tone')!==project(g[i],'tone')) }
    assert.ok(interact ? diff>1 && pixels>10 : diff===0, `L1=${diff} pixels=${pixels}`); return {L1:diff,tonePixels:pixels}
  })
  check('all edges/corners and input clamp',()=>{
    const f=fresh(),g=fresh(); for(const [x,y] of [[0,0],[w-1,0],[0,h-1],[w-1,h-1],[w>>1,0],[w>>1,h-1],[0,h>>1],[w-1,h>>1]]) {
      const off=(v,max)=>v===0?-99:v===max-1?max+99:v
      const start=P(x< w/2?x+12:x-12,y<h/2?y+12:y-12)
      stroke(f,[start,P(x,y,30)]); stroke(g,[start,P(off(x,w),off(y,h),30)]); assert.ok(f[index(x,y)]<1)
    } invariant(f); assert.equal(hash(f),hash(g))
  })
  check('45 degree tap profile',()=>{
    const f=fresh(); stroke(f,[P(100,100)]); const diagonal=f[index(104,104)],opposite=f[index(104,96)]
    assert.ok(shape==='nib'?diagonal<1 && opposite>1 : diagonal===opposite && diagonal<1); return [diagonal,opposite]
  })
  check('dt negative/zero/positive/250ms cap',()=>{
    const sample=dt=>{const f=fresh();stroke(f,[P(80,96,100),P(83,96,100+dt)]); invariant(f);return [hash(f),f[index(83,96)]]}
    const [zero,v0]=sample(0),[mid,v1]=sample(50),[cap,v2]=sample(250)
    assert.equal(sample(-10)[0],zero); assert.equal(sample(900)[0],cap)
    if(shape==='refill')assert.ok(v0<v1 && v1<v2);else assert.ok(zero===mid && mid===cap);return [v0,v1,v2]
  })
  check('100 strokes / 12 exact undo+redo',()=>{
    const f=fresh(), history=new TileHistory(), states=[]; let peak=0
    for(let i=0;i<100;i++) {
      const x=(i*41)%(w-96),y=(i*37)%h, patch=new Map(),k=new Transfer(brush,r=>capture(patch,f,r)); stroke(f,[P(x,y),P(x+90,y,128)],k);history.commit(patch)
      peak=Math.max(peak,history.bytes);assert.ok(history.bytes<=HISTORY_BYTES);assert.equal(history.undoCount,Math.min(i+1,12)); if(i>=87) states.push(hash(f))
    }
    invariant(f);const bytes=history.bytes
    for(let i=11;i>=0;i--){assert.ok(history.travel(f,false));assert.equal(hash(f),states[i]);assert.equal(history.bytes,bytes)}
    assert.equal(history.travel(f,false),undefined);assert.equal(history.redoCount,12)
    for(let i=1;i<=12;i++){assert.ok(history.travel(f,true));assert.equal(hash(f),states[i]);assert.equal(history.bytes,bytes)}
    return {peakTileBytes:peak,fieldBytes:f.byteLength}
  })
  console.log('MEASURED',w,shape,{maxResidual,minDensity})
}
console.log({pass,fail}); process.exitCode=Number(fail!==0)
