import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {preview} from 'vite'

const server=await preview({build:{outDir:process.argv[2]??'dist'},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()})
  const page=await browser.newPage({viewport:{width:1200,height:1100},serviceWorkers:'block'})
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{
    window.counts={commits:0,transactions:0,paint:0}
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,inject:()=>1,onCommitFiberRoot:()=>window.counts.commits++,onCommitFiberUnmount:()=>{}}
    const tx=IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction=function(...args){if(args[1]==='readwrite')window.counts.transactions++;return tx.apply(this,args)}
    const put=CanvasRenderingContext2D.prototype.putImageData
    CanvasRenderingContext2D.prototype.putImageData=function(...args){window.counts.paint++;return put.apply(this,args)}
  })
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable')
  async function metrics(){const {metrics}=await cdp.send('Performance.getMetrics');return {...Object.fromEntries(metrics.filter(m=>['ScriptDuration','RecalcStyleDuration','LayoutDuration'].includes(m.name)).map(m=>[m.name+'Ms',m.value*1000])),...await page.evaluate(()=>window.counts)}}
  const diff=(a,b)=>Object.fromEntries(Object.keys(a).map(k=>[k,+(b[k]-a[k]).toFixed(2)]))
  const click=name=>page.getByRole('button',{name,exact:true}).click(), canvas=page.locator('canvas')
  const digest=async()=>{const [d]=await Promise.all([page.waitForEvent('download'),click('Экспорт поля')]);return createHash('sha256').update(await readFile(await d.path())).digest('hex')}
  const history=()=>page.getByText(/История: .* назад/).innerText(), saved=()=>page.getByText('Сохранено локально',{exact:true}).waitFor()
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/?field=2048`);await click('A → B');await saved();assert.equal(await canvas.evaluate(c=>c.width),2048)
  const original=await digest(), initial=await history();await page.getByLabel('Инструмент').selectOption('pan')
  const zoomStart=await metrics();for(let i=0;i<5;i++){await click('Увеличить');await click('Уменьшить')}await click('Увеличить');const zoom=diff(zoomStart,await metrics())
  const view=page.locator('.workspace-plane').locator('..');await view.scrollIntoViewIfNeeded();const b=await view.boundingBox(), x=b.x+b.width/2,y=b.y+b.height/2
  await page.mouse.move(x,y);await page.mouse.down();const start=await metrics()
  for(let i=1;i<=120;i++)await page.mouse.move(x+50*Math.sin(i*Math.PI/32),y+25*Math.sin(i*Math.PI/16))
  await page.mouse.up();const pan=diff(start,await metrics());assert.equal(pan.paint,0);assert.equal(zoom.paint,0);assert.equal(pan.transactions+zoom.transactions,0)
  const transform=await page.locator('.workspace-plane').evaluate(el=>new DOMMatrix(getComputedStyle(el).transform).toJSON());assert.equal(transform.a,2);assert.ok(Math.abs(transform.e+50*Math.SQRT1_2)<2 && Math.abs(transform.f+25)<2)
  assert.equal(await digest(),original);assert.equal(await history(),initial)
  await page.getByLabel('Инструмент').selectOption('draw');await page.getByLabel('Записывать последний жест').check();await view.scrollIntoViewIfNeeded()
  const area=await view.boundingBox(), rect=await canvas.boundingBox(), px=Math.floor(area.x+area.width*.53),py=Math.floor(area.y+area.height*.52)
  await page.mouse.move(px,py);await page.mouse.down();await page.mouse.move(px+20,py+16,{steps:8});await page.mouse.up();await saved()
  const coords=(await page.locator('details pre').textContent()).split(' · ')[0].split(', ').map(Number);assert.ok(Math.abs(coords[0]-(px-rect.x)*2048/rect.width)<.02 && Math.abs(coords[1]-(py-rect.y)*2048/rect.height)<.02)
  const drawn=await digest();assert.notEqual(drawn,original);await click('Повторить и сравнить');await page.getByText(/Исходная: 0 ячеек \/ 0 пикс.*пакеты: 0 ячеек \/ 0 пикс/).waitFor();assert.equal(await digest(),drawn)
  await click('Шаг назад');assert.equal(await digest(),original);await click('Шаг вперёд');await saved();assert.equal(await digest(),drawn);assert.deepEqual(errors,[])
  console.log(JSON.stringify({browser:browser.version(),original,drawn,zoom,pan},null,2))
}finally{try{await browser?.close()}finally{await server.close()}}
