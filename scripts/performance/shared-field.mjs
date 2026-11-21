import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { preview } from 'vite'
import { chromium } from 'playwright'

const outDir=process.argv[2];assert.ok(outDir,'Pass isolated production build directory')
const server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try {
 const url=`http://127.0.0.1:${server.httpServer.address().port}/`
 assert.equal(await (await fetch(url)).text(),await readFile(`${outDir}/index.html`,'utf8'))
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()})
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1150,height:940}}), page=await context.newPage()
 const click=name=>page.getByRole('button',{name,exact:true}).click(), saved=()=>page.getByRole('status').filter({hasText:'Сохранено локально'}).waitFor()
 async function heightInput(p){
   await p.getByRole('navigation',{name:'Группы инспектора'}).getByRole('button',{name:'Мерки',exact:true}).click()
   const group=p.getByRole('group',{name:'Мерки',exact:true});await group.waitFor();return group.getByRole('spinbutton').first()
 }
 async function bytes(){const dl=page.waitForEvent('download');await click('Сохранить документ');return readFile(await (await dl).path())}
 async function stroke(label){const canvas=page.getByLabel(label,{exact:true});await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox(),x=b.x+b.width*.5,y=b.y+b.height*.48;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+16,y+6,{steps:6});await page.mouse.up();await saved()}
 await page.goto(url);await click('Чистое поле');await saved();await click('3D-поверхность');const measure=await heightInput(page),max=await measure.getAttribute('max');await measure.fill(max);await saved();await click('Вернуться в поле')
 await stroke('Поле плотности');const before=await bytes(),origin=await page.evaluate(()=>performance.timeOrigin)
 await click('3D-поверхность');await stroke('3D-модель тела');await click('Вернуться в поле');assert.equal(await page.evaluate(()=>performance.timeOrigin),origin)
 const after=await bytes();assert.ok(!after.equals(before),'3D stroke must mutate the shared document');await click('Шаг назад');await saved();assert.ok((await bytes()).equals(before),'2D undo must restore exact field and measurements');await click('Шаг вперёд');await saved();assert.ok((await bytes()).equals(after));await click('Шаг назад');await saved();await page.close()
 const reopened=await context.newPage();await reopened.goto(url);await reopened.getByText('Локальное поле загружено',{exact:true}).waitFor();const dl=reopened.waitForEvent('download');await reopened.getByRole('button',{name:'Сохранить документ',exact:true}).click();assert.ok((await readFile(await (await dl).path())).equals(before));await reopened.getByRole('button',{name:'3D-поверхность'}).click();assert.equal(await (await heightInput(reopened)).inputValue(),max)
 console.log('PASS shared 2D → 3D stroke → 2D undo/redo → reopen, byte-identical .tfw, body retained, no reload')
} finally {try{await browser?.close()}finally{await server.close()}}
