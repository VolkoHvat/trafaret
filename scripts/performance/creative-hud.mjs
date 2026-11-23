import assert from 'node:assert/strict'
import { mkdir,readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const [dist,frames]=process.argv.slice(2);assert.ok(dist&&frames,'Expected outDir and screenshot directory')
const server=await preview({build:{outDir:dist},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()});await mkdir(frames,{recursive:true})
  const page=await browser.newPage({viewport:{width:1360,height:880},serviceWorkers:'block'}), errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);await page.getByText('Новый документ',{exact:true}).filter({visible:true}).first().waitFor()
  const canvas=page.getByLabel('Поле плотности',{exact:true}),pixels=()=>canvas.evaluate(c=>c.toDataURL()),panel=page.getByLabel('Инспектор'),btn=name=>page.getByRole('button',{name,exact:true}),paper=page.getByLabel('Бумага · вид')
  const empty=await pixels();assert.equal(await canvas.evaluate(c=>new Set(c.getContext('2d').getImageData(0,0,c.width,c.height).data.filter((_,i)=>i%4===0)).size),1)
  assert.equal(await page.getByLabel('Срез плотности',{exact:true}).isVisible(),false)
  const radius=page.getByRole('slider',{name:'Радиус кисти'});await radius.press('Home');await radius.press('ArrowRight');assert.equal(await radius.inputValue(),'2');await page.getByLabel('Пигмент линии').fill('#782137')
  const box=await canvas.boundingBox();const draw=async points=>{for(const [i,[x,y]] of points.entries()){await page.mouse.move(box.x+box.width*x,box.y+box.height*y,{steps:i?4:1});if(!i)await page.mouse.down()}await page.mouse.up();await page.getByText('Сохранено локально',{exact:true}).waitFor()}
  // Wing, spine, lowered jaw, tapered tail: all marks are ordinary pointer strokes.
  await draw([[.19,.73],[.31,.62],[.37,.49],[.51,.37],[.59,.32],[.55,.17],[.65,.29],[.74,.25],[.70,.32],[.82,.38],[.77,.43],[.71,.41],[.74,.47],[.64,.43],[.53,.49],[.42,.61],[.32,.70],[.19,.73]])
  await draw([[.38,.53],[.26,.28],[.25,.16],[.36,.27],[.45,.32],[.39,.20],[.52,.31],[.54,.36]])
  await draw([[.27,.22],[.36,.38],[.39,.49]]);await draw([[.31,.29],[.44,.38],[.47,.41]]);await draw([[.65,.34],[.68,.34]])
  const motif=await pixels();assert.notEqual(motif,empty);await btn('Шаг назад').click();assert.notEqual(await pixels(),motif);await btn('Шаг вперёд').click();assert.equal(await pixels(),motif)
  await btn('На печать').click();await page.getByLabel('Имя документа').fill('Алый виверн');await page.getByText('Сохранено локально',{exact:true}).waitFor();assert.equal(await btn('Печать поля 1:1').isVisible(),true)
  const file=async name=>{const [d]=await Promise.all([page.waitForEvent('download'),btn(name).click()]);return readFile(await d.path())}
  const png=await file('Экспорт PNG'),doc=await file('Сохранить документ');for(const view of ['ash','raw','warm']){await paper.selectOption(view);assert.equal(await pixels(),motif);assert.deepEqual(await file('Экспорт PNG'),png);assert.deepEqual(await file('Сохранить документ'),doc)}
  await panel.selectOption('shelf');await page.screenshot({path:`${frames}/desktop.png`});await page.setViewportSize({width:390,height:844});assert.equal(await pixels(),motif);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${frames}/narrow.png`})
  await btn('Композиция').click();await page.getByRole('heading',{name:'Композиция'}).waitFor();await btn('Вернуться в поле').click();assert.equal(await pixels(),motif)
  await page.reload();await page.getByText('Локальное поле загружено').waitFor();assert.equal(await pixels(),motif);assert.deepEqual(errors,[]);console.log(`Creative HUD PASS ${browser.version()}`)
}finally{await browser?.close();await server.close()}
