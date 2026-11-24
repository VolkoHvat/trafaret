import assert from 'node:assert/strict'
import { preview } from 'vite'
import { chromium } from 'playwright'
const [outDir='dist',png='.tools/local-surface.png']=process.argv.slice(2)
const server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()})
  const p=await browser.newPage({viewport:{width:1280,height:960},serviceWorkers:'block'}),click=name=>p.getByRole('button',{name,exact:true}).click()
  await p.goto(`http://127.0.0.1:${server.httpServer.address().port}/?field=2048`);await p.getByLabel('Инспектор').selectOption('all')
  const origin=await p.evaluate(()=>performance.timeOrigin),field=p.getByLabel('Поле плотности',{exact:true}),c=p.getByLabel('Проекция участка тела'),frame=()=>c.evaluate(el=>el.toDataURL()),leave=()=>click('Вернуться в поле'),open=()=>click('Участок тела')
  assert.equal(await field.getAttribute('width'),'2048');await open();const blank=await frame();await leave()
  const b=await field.boundingBox();await p.mouse.move(b.x+b.width*.30,b.y+b.height*.65);await p.mouse.down()
  for(let i=0;i<=120;i++){const t=i/120;await p.mouse.move(b.x+b.width*(.30+.4*t+.12*Math.sin(2*Math.PI*t)),b.y+b.height*(.65-.35*t+.12*Math.sin(4*Math.PI*t)))}await p.mouse.up()
  await p.getByText('Сохранено локально',{exact:true}).waitFor();await open();const ink=await frame();assert.notEqual(ink,blank)
  assert.match(await p.locator('figcaption:visible').innerText(),/2048×2048 · 100 × 100 мм · 0.04883 мм\/px/)
  await p.screenshot({path:png});await p.getByLabel('Верхний обхват, мм').fill('0');await p.getByRole('alert').waitFor();assert.equal(await c.isVisible(),false)
  await p.locator('main.local-surface').getByRole('combobox').selectOption('back');await p.getByLabel('Ширина, мм').fill('300');const back=await frame();await p.getByLabel('Обзор',{exact:true}).press('End');assert.notEqual(await frame(),back)
  await leave();if(await p.getByLabel('Инспектор').isVisible())await p.getByLabel('Инспектор').selectOption('all');await click('Шаг назад');await open();assert.equal(await frame(),blank);await leave();await click('Шаг вперёд');await open();assert.equal(await frame(),ink);assert.equal(await p.evaluate(()=>performance.timeOrigin),origin)
  console.log('PASS 2048 production: projected real stroke, mm/px, validation, camera, return, exact undo/redo frames; screenshot:',png)
}finally{await browser?.close();await server.close()}
