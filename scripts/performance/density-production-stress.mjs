import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { preview } from 'vite'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { setTimeout as pause } from 'node:timers/promises'

// After npm run build: node scripts/performance/density-production-stress.mjs [--endurance]
const endurance = process.argv.includes('--endurance'), MiB = 2 ** 20
const limits = { history: 32 * MiB, backing: 256 * MiB, heap: 128 * MiB, growth: 96 * MiB }
const start = performance.now(), elapsed = () => Math.round(performance.now() - start)
const outDir = process.argv.slice(2).find(arg=>!arg.startsWith('--')) ?? 'dist'
const server = await preview({ build:{outDir}, preview: { host: '127.0.0.1', port: 0, open: false } })
const origin = `http://127.0.0.1:${server.httpServer.address().port}/`
let browser, stopped = false
try {
  browser = await chromium.launch({ channel: 'msedge' })
  const ctx = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1250, height: 1050 } })
  const errors = []; ctx.on('page', p => p.on('pageerror', e => errors.push(e.message)))
  let page = await ctx.newPage()
  const canvas = () => page.getByLabel('Поле плотности',{exact:true}), button = name => page.getByRole('button', { name, exact: true })
  const saved = async () => { try { await page.getByText('Сохранено локально', { exact: true }).waitFor() } catch (cause) { throw new Error(`Save status: ${await page.locator('p[role=status]').allTextContents()}; errors: ${errors}`, {cause}) } }
  const ready = () => page.waitForFunction(() => document.querySelector('fieldset')?.disabled === false)
  const hash = () => canvas().evaluate(async c => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', c.getContext('2d').getImageData(0, 0, c.width, c.height).data)), b => b.toString(16).padStart(2, '0')).join(''))
  const fieldHash = (verifyProjection=false) => page.evaluate(async verify => {
    const req = indexedDB.open('trafaret-density-2'); const db = await new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error)})
    try {
      const store=db.transaction('documents').objectStore('documents'), entries=[]
      await new Promise((res,rej)=>{const cursor=store.openCursor(IDBKeyRange.bound('2048/','2048/\uffff'));cursor.onerror=()=>rej(cursor.error);cursor.onsuccess=()=>{const c=cursor.result;if(!c)return res();if(/^2048\/\d+$/.test(c.key)&&!c.value.every(v=>v===1))entries.push([c.key,c.value]);c.continue()}})
      if(verify){const c=document.querySelector('canvas[aria-label="Поле плотности"]'),ctx=c.getContext('2d'); for(const [key,tile] of entries){const id=Number(key.split('/')[1]),rgba=ctx.getImageData((id%64)*32,Math.floor(id/64)*32,32,32).data; for(let j=0;j<tile.length;j++){const tone=Math.round(Math.max(16,Math.min(251,176+100*Math.log2(Math.max(.01,tile[j])))));if(rgba[4*j]!==tone||rgba[4*j+1]!==tone||rgba[4*j+2]!==tone||rgba[4*j+3]!==255)throw Error(`Projection mismatch ${key}:${j}`)}}}
      const hex = async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('')
      return hex(new TextEncoder().encode(JSON.stringify(await Promise.all(entries.map(async ([k,v])=>[k,await hex(v)])))))
    } finally {db.close()}
  },verifyProjection)
  const historyState = () => page.getByText(/^Касание — .*История:/).innerText()
  const draw = async (x,y) => {
    await canvas().scrollIntoViewIfNeeded(); const b = await canvas().boundingBox()
    const input=await canvas().evaluate((c,{x,y})=>{const r=c.getBoundingClientRect(),point=(u,v)=>[r.left+u*r.width,r.top+v*r.height];const from=point(x,y),to=point(x+.035,y+.021);window.probeEvents=[];for(const t of ['pointerdown','pointerup']) c.addEventListener(t,e=>window.probeEvents.push([t,e.clientX,e.clientY,e.isTrusted]),{once:true});return {from,to,rect:r.toJSON(),ready:!document.querySelector('fieldset').disabled,hit:[from,to].map(([a,b])=>document.elementFromPoint(a,b)===c)}},{x,y})
    await page.mouse.move(b.x + x*b.width,b.y + y*b.height); await page.mouse.down()
    await page.mouse.move(b.x + (x+.035)*b.width,b.y + (y+.021)*b.height,{steps:8}); await page.mouse.up(); await ready(); await saved(); return {...input,events:await page.evaluate(()=>window.probeEvents)}
  }
  if(process.env.TRACE_SAVE){const debug=await ctx.newCDPSession(page); await debug.send('Debugger.enable');await debug.send('Debugger.setPauseOnExceptions',{state:'all'});debug.on('Debugger.paused',async e=>{console.log('exception',e.data?.description?.split('\n')[0]);await debug.send('Debugger.resume')})}
  await page.goto(origin); await ready(); await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated')
  const sw = await page.evaluate(() => navigator.serviceWorker.controller.scriptURL); assert.equal(sw, origin+'sw.js')
  await button('B → A').click(); await saved(); const small = await hash()
  await page.close(); assert.equal(ctx.pages().length,0); await ctx.setOffline(true); await server.close(); stopped = true
  page = await ctx.newPage(); const open = await page.goto(origin); assert.ok(open.fromServiceWorker()); await ready(); assert.equal(await hash(),small)
  await draw(.4,.4); const offline = await hash(); assert.notEqual(offline,small)
  const reload = await page.reload(); assert.ok(reload.fromServiceWorker()); await ready(); assert.equal(await hash(),offline)
  console.log(JSON.stringify({ stage:'offline restore',browser:browser.version(),sw,small,offline,elapsedMs:elapsed() }))
  const size = async (name,width) => { await button(name).click(); await ready(); assert.equal(await canvas().evaluate(c=>c.width),width) }
  const artifact=await readFile(`${outDir}/index.html`,'utf8'); console.log(JSON.stringify({indexSHA256:createHash('sha256').update(artifact).digest('hex'),bundle:artifact.match(/\/assets\/main-[\w-]+\.js/)?.[0]}))
  const repro=process.argv.includes('--repro'); const cdp = await ctx.newCDPSession(page); let baseline, expected, expectedField
  const stressStart = performance.now(); let i = 0
  do {
    await size('Основная студия · открыть 2048×2048',2048); const before = await hash(); if(expected)assert.equal(before,expected)
    const shape = ['round','nib','refill'][i%3], combo = Math.floor(i/3)%4
    await page.getByRole('combobox',{name:/^Кисть/}).selectOption(shape)
    const values = [combo&1 ? '14':'2',combo&2 ? '16':'2']
    for(let j=0;j<2;j++) { const slider = page.getByRole('slider',{name:j===0?/^Радиус/:/^Буфер/}); await slider.press(values[j]==='2'?'Home':'End'); assert.equal(await slider.inputValue(),values[j]) }
    const original=await fieldHash(),h0=await historyState(); if(expectedField)assert.equal(original,expectedField)
    const input=await draw(.32+(i%9)*.029,.36+(i%7)*.025); expected = await hash(); expectedField=await fieldHash(true)
    const evidence={cycle:i+1,input,before,after:expected,original,changed:expectedField,h0,h1:await historyState()}; console.log(JSON.stringify(evidence))
    assert.ok(input.ready && input.hit.every(Boolean));assert.deepEqual(input.events.map(e=>[e[0],e[3]]),[['pointerdown',true],['pointerup',true]])
    assert.notEqual(original,expectedField); assert.match(evidence.h0,/0 назад \/ 0 вперёд/); assert.match(evidence.h1,/1 назад \/ 0 вперёд/)
    if(repro || i<12)assert.notEqual(expected,before)
    const history = Number(await canvas().getAttribute('data-history-bytes')); assert.ok(history>0 && history<=limits.history)
    await button('Шаг назад').click(); await saved(); assert.equal(await hash(),before); assert.equal(await fieldHash(),original)
    await button('Шаг вперёд').click(); await saved(); assert.equal(await hash(),expected); assert.equal(await fieldHash(),expectedField)
    await cdp.send('HeapProfiler.collectGarbage'); const { usedSize:heap,backingStorageSize:backing } = await cdp.send('Runtime.getHeapUsage')
    baseline ??= heap+backing; assert.ok(heap < limits.heap && backing < limits.backing && heap+backing-baseline < limits.growth,JSON.stringify({heap,backing,baseline,limits}))
    await size('Открыть 384×240',384); assert.equal(await hash(),offline); assert.deepEqual(errors,[])
    console.log(JSON.stringify({ cycle:++i,shape,values,history,heap,backing,elapsedMs:elapsed() }))
    if(endurance)await pause(1500)
  } while(i<(repro?300:12) || (endurance && performance.now()-stressStart<1800000))
  await size('Основная студия · открыть 2048×2048',2048); assert.equal(await hash(),expected); await size('Открыть 384×240',384)
  // Only the disposable browser context's legacy small-field record is poisoned.
  await page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('trafaret-density-2'); r.onerror=()=>reject(r.error); r.onsuccess=()=>{const db=r.result,tx=db.transaction('documents','readwrite'); tx.objectStore('documents').put(new ArrayBuffer(3),'current'); tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}}))
  await page.reload(); await page.getByText(/^Не удалось прочитать локальн/).waitFor(); await page.goto(origin+'?field=2048'); await ready(); assert.equal(await hash(),expected); assert.deepEqual(errors,[])
  console.log(JSON.stringify({result:'PASS',cycles:i,endurance,elapsedMs:elapsed(),limits,corruptSmallDetected:true,largeUnaffected:true}))
} finally { try {await browser?.close()} finally {if(!stopped)await server.close()} }
