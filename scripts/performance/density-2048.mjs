import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'
const server = await preview({ build:{outDir:process.argv[2]??'dist'}, preview: { host:'127.0.0.1', port:0, open:false } })
let browser
try {
  browser = await chromium.launch({ executablePath:process.env.CHROME_PATH || chromium.executablePath() })
  const page = await browser.newPage({viewport:{width:1200,height:1100},serviceWorkers:'block'})
  const cdp=await page.context().newCDPSession(page), base=`http://127.0.0.1:${server.httpServer.address().port}/`
  const canvas=page.getByLabel('Поле плотности',{exact:true}), click=n=>page.getByRole('button',{name:n,exact:true}).click()
  const idle=()=>page.waitForFunction(()=>document.querySelector('fieldset')?.disabled === false)
  const saved=()=>page.getByText('Сохранено локально',{exact:true}).waitFor()
  const hash=async()=>canvas.evaluate(async c=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',c.getContext('2d').getImageData(0,0,c.width,c.height).data)),x=>x.toString(16).padStart(2,'0')).join(''))
  const exportFile=async name=>{const [d]=await Promise.all([page.waitForEvent('download'),click(name)]);return readFile(await d.path())}
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  // Synchronous event handler duration, not device latency. Record IDB byte payloads (not browser RSS).
  await page.addInitScript(()=>{
    window.probe={down:[],move:[],up:[],put:[],txMs:[],pen:0}; for(const t of ['pointerdown','pointermove','pointerup']){
      let start=0;window.addEventListener(t,e=>{if(e.target.tagName==='CANVAS'){start=performance.now();if(e.pointerType==='pen')window.probe.pen++}},true)
      window.addEventListener(t,e=>{if(e.target.tagName==='CANVAS')window.probe[t.slice(7)].push(performance.now()-start)})
    }
    const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(...args){const tx=transaction.apply(this,args);if(tx.mode==='readwrite'){const t=performance.now();tx.addEventListener('complete',()=>window.probe.txMs.push(performance.now()-t))}return tx}
    const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(v,...args){window.probe.put.push({key:args[0],bytes:v?.byteLength});return put.call(this,v,...args)}
  })
  await page.goto(base);await idle();await click('B → A');await saved();const small=await hash()
  await click('Основная студия · открыть 2048×2048');await idle();assert.equal(await canvas.evaluate(c=>c.width),2048)
  await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox()
  const pen=(type,x,y)=>cdp.send('Input.dispatchMouseEvent',{type,x:box.x+x*box.width,y:box.y+y*box.height,pointerType:'pen',button:type==='mouseMoved'?'none':'left',buttons:type==='mouseReleased'?0:1,force:.57,clickCount:1})
  const stroke=async points=>{await pen('mousePressed',...points[0]);for(const p of points.slice(1))await pen('mouseMoved',...p);await pen('mouseReleased',...points.at(-1));await idle()}
  const loop=Array.from({length:17},(_,i)=>[.5+.015*Math.cos(i*Math.PI/8),.5+.015*Math.sin(i*Math.PI/8)])
  await stroke(loop);await saved();const loopHash=await hash()
  await stroke([[.41,.41],[.59,.59]]);await stroke([[.41,.59],[.59,.41]]);await saved();const cross=await hash();assert.notEqual(loopHash,cross)
  const short=[];for(let i=0;i<12;i++){await stroke([[.3+i*.007,.48],[.306+i*.007,.49]]);short.push(await canvas.evaluate(c=>[+c.dataset.patchBytes,+c.dataset.saveCopyMs,+c.dataset.historyBytes]))}
  await saved();const result=await hash(), probe=await page.evaluate(()=>window.probe)
  const tiles=probe.put.filter(({key})=>/^2048\/\d+$/.test(key))
  assert.ok(tiles.length>0,'No 2048 density tiles written')
  for(const {key,bytes} of tiles)assert.ok(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=8192,`${key}: ${bytes} bytes`)
  assert.ok(probe.pen>=30);assert.ok(short.at(-1)[2]<2**20)
  // 12 fast short strokes in the history: go both ways without taking a full-field snapshot.
  for(let i=0;i<12;i++)await click('Шаг назад');assert.equal(await hash(),cross)
  for(let i=0;i<12;i++)await click('Шаг вперёд');assert.equal(await hash(),result);await saved()
  const original=await exportFile('Экспорт поля');assert.equal(original.length,33554456);const png=await exportFile('Экспорт PNG');assert.equal(png.readUInt32BE(16),2048);assert.equal(png.readUInt32BE(20),2048)
  await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width*.39,b.y+b.height*.51);await page.mouse.down();assert.notEqual(await hash(),result);await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await hash(),result)
  await page.reload();await idle();assert.equal(await hash(),result);assert.deepEqual(await exportFile('Экспорт поля'),original)
  await click('Чистое поле');await page.locator('input[type=file][accept=".tfd,.tfw"]').setInputFiles({name:'roundtrip.tfd',mimeType:'application/octet-stream',buffer:original});await page.getByText('Импортировано',{exact:true}).waitFor();assert.equal(await hash(),result);await saved()
  await click('Открыть 384×240');await idle();assert.equal(await hash(),small);await click('Основная студия · открыть 2048×2048');await idle();assert.equal(await hash(),result)
  await page.getByLabel('Записывать последний жест').check();await canvas.scrollIntoViewIfNeeded();Object.assign(box,await canvas.boundingBox());await stroke(loop);await saved()
  const recorded=await hash(), diag=await page.evaluate(()=>window.probe),writes=diag.put.length
  const summary=await page.locator('[data-gesture-summary]').innerText();assert.match(summary,/Источник: pen/);assert.match(summary,/Полная запись/)
  await page.getByRole('combobox',{name:/^Кисть/}).selectOption('nib');await click('Повторить и сравнить');const report=page.locator('[data-gesture-report]');await report.getByText(/^Исходная:/).waitFor();const text=await report.innerText()
  assert.match(text,/Исходная: 0 ячеек \/ 0 пикс/);assert.match(text,/пакеты: 0 ячеек \/ 0 пикс/);assert.match(text,/выбранная .*: [1-9]\d* ячеек/);assert.equal(await hash(),recorded);assert.equal(await page.evaluate(()=>window.probe.put.length),writes)
  await click('Шаг назад');assert.equal(await hash(),result);await click('Шаг вперёд');await saved();await canvas.scrollIntoViewIfNeeded();Object.assign(box,await canvas.boundingBox());await pen('mousePressed',.5,.5);await page.keyboard.press('Escape');await pen('mouseReleased',.5,.5);assert.match(await page.locator('[data-gesture-summary]').innerText(),/Отменена/);assert.ok(await page.getByRole('button',{name:'Повторить и сравнить'}).isDisabled());await page.reload();await idle();assert.equal(await hash(),recorded);assert.equal(await page.getByLabel('Записывать последний жест').isChecked(),false)
  await click('Чистое поле');await saved();await canvas.scrollIntoViewIfNeeded();Object.assign(box,await canvas.boundingBox());await stroke([[.46,.50],[.54,.50]]);await saved();const firstLine=await hash()
  await page.getByLabel('Записывать последний жест').check();await canvas.scrollIntoViewIfNeeded();Object.assign(box,await canvas.boundingBox());await stroke([[.50,.46],[.50,.54]]);await saved();const crossed=await hash();assert.notEqual(crossed,firstLine)
  const countBefore=await page.evaluate(()=>window.probe.put.length),historyBefore=await page.getByText(/История: .* назад/).innerText()
  await click('Выбрать срез');const overlay=page.getByLabel('Выбор отрезка среза');await overlay.scrollIntoViewIfNeeded();const ob=await overlay.boundingBox()
  await page.mouse.move(ob.x+.486*ob.width,ob.y+.5*ob.height);await page.mouse.down();await page.mouse.move(ob.x+.514*ob.width,ob.y+.5*ob.height,{steps:5});await page.mouse.up()
  assert.equal(await page.getByLabel('Y1',{exact:true}).inputValue(),await page.getByLabel('Y2',{exact:true}).inputValue())
  const stats=await page.locator('[data-section-stats]').innerText(),values=stats.match(/Δρ от (-?\d+\.\d+) до (-?\d+\.\d+)/);assert.match(stats,/Полное покрытие/);assert.ok(values && +values[1]<0 && +values[2]>0)
  const chart=page.getByRole('img',{name:'Плотность до, после и разность вдоль отрезка'});assert.equal(await chart.locator('path').count(),3);assert.ok(await chart.isVisible());assert.ok(await chart.locator('line').evaluate(l=>l.getTotalLength()===512 && l.y1.baseVal.value>=0 && l.y1.baseVal.value<=100 && getComputedStyle(l).stroke!=='none'));assert.notEqual(await chart.locator('path').nth(0).getAttribute('d'),await chart.locator('path').nth(1).getAttribute('d'))
  await page.getByLabel('X1',{exact:true}).fill('0');assert.match(await page.locator('[data-section-stats]').innerText(),/Частичное покрытие/)
  assert.equal(await hash(),crossed);assert.equal(await page.getByText(/История: .* назад/).innerText(),historyBefore);assert.equal(await page.evaluate(()=>window.probe.put.length),countBefore);await click('Вернуться к рисованию');await click('Шаг назад');assert.equal(await hash(),firstLine)
  console.log({section:stats,crossed,historyBefore})
  console.log({summary,text,recordDown:diag.down.at(-1),recordMoveMedian:diag.move.toSorted((a,b)=>a-b)[Math.floor(diag.move.length/2)],recordUp:diag.up.at(-1)})
  const median=a=>a.toSorted((a,b)=>a-b)[Math.floor(a.length/2)];assert.deepEqual(errors,[])
  console.log(JSON.stringify({browser:browser.version(),port:server.httpServer.address().port,small,loopHash,cross,result,short12:{medianDownMs:median(probe.down.slice(-12)),medianUpMs:median(probe.up.slice(-12)),medianIdbTransactionMs:median(probe.txMs.slice(-12)),medianSaveCopyMs:median(short.map(s=>s[1])),medianPatchBytes:median(short.map(s=>s[0])),historyBytes:short.at(-1)[2]},tileWrites:tiles.length,maxTileBytes:Math.max(...tiles.map(t=>t.bytes)),penEvents:probe.pen,pngBytes:png.length,tfdSHA256:createHash('sha256').update(original).digest('hex')},null,2))
}finally{try{await browser?.close()}finally{await server.close()}}
