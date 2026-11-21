import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
import { preview } from 'vite'

const outDir=process.argv[2] || 'dist'
const index=await readFile(`${outDir}/index.html`, 'utf8')
let browser
const server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}})
const url=`http://127.0.0.1:${server.httpServer.address().port}/?surface=1`
try {
 const response=await fetch(url)
 assert.equal(response.status,200,`GET ${url} (${outDir}): HTTP ${response.status}`)
 assert.ok(await response.text()===index,`GET ${url} did not serve ${outDir}/index.html`)
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH || chromium.executablePath()})
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1150,height:940}})
 const open=async()=>{const p=await context.newPage();await p.goto(url);return p}
 const state=(p,s)=>p.locator(`[data-checkpoint="${s}"]`).waitFor()
 const click=(p,name)=>p.getByRole('button',{name,exact:true}).click()
 const project=async(p,name='Сохранить проект .tfs')=>{const dl=p.waitForEvent('download');await click(p,name);return createHash('sha256').update(await readFile(await (await dl).path())).digest('hex')}
 const stroke=async(p,cancel=false)=>{const v=p.getByLabel('3D-модель тела',{exact:true});await v.scrollIntoViewIfNeeded();const b=await v.boundingBox(),x=b.x+b.width*.5,y=b.y+b.height*.48;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+15,y+5,{steps:4});if(cancel)await p.keyboard.press('Escape');await p.mouse.up()}
 const page=await open();await state(page,'ready');const stale=await open();await state(stale,'ready')
 const measure=page.getByRole('spinbutton').first();await measure.fill(await measure.getAttribute('max'));await state(page,'saved');const blank=await project(page)
 await stroke(page);await state(page,'saved');const ink=await project(page);assert.notEqual(ink,blank)
 await stroke(page,true);assert.equal(await project(page),ink)
 await click(page,'Отменить');await state(page,'saved');assert.equal(await project(page),blank)
 await click(page,'Повторить');await state(page,'saved');assert.equal(await project(page),ink)
 await page.getByRole('link',{name:'Вернуться в поле'}).click();await page.waitForURL(u=>!u.searchParams.has('surface'));await page.goto(url);await state(page,'saved');assert.equal(await project(page),ink)
 await page.reload();await state(page,'saved');assert.equal(await project(page),ink)
 await stroke(stale);await state(stale,'error');assert.match(await stale.getByRole('alert').innerText(),/Конфликт/);assert.notEqual(await project(stale,'Аварийный экспорт .tfs'),ink)
 stale.once('dialog',d=>d.dismiss());await stale.getByRole('link',{name:'Вернуться в поле'}).click();assert.equal(stale.url(),url)
 await page.close();const recovered=await open();await state(recovered,'saved');assert.equal(await project(recovered),ink)
 const reset='Очистить поле для изменения мерок';recovered.once('dialog',d=>d.dismiss());await click(recovered,reset);assert.equal(await project(recovered),ink)
 recovered.once('dialog',d=>d.accept());await click(recovered,reset);await state(recovered,'saved');await recovered.reload();await state(recovered,'saved');assert.equal(await project(recovered),blank)
 // Hold a real competing transaction to make pending deterministic, then release it.
 await recovered.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('trafaret-surface-checkpoint');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects');let hold=true;window.releaseCheckpoint=()=>{hold=false};const loop=()=>{if(hold)store.get('hold').onsuccess=loop};loop();tx.oncomplete=()=>db.close();resolve()}}))
 await stroke(recovered);await state(recovered,'pending');const dialog=recovered.waitForEvent('dialog');await recovered.evaluate(()=>{setTimeout(()=>location.reload(),0)});const guard=await dialog;assert.equal(guard.type(),'beforeunload');await guard.dismiss();assert.equal(await project(recovered,'Аварийный экспорт .tfs'),ink);await recovered.evaluate(()=>window.releaseCheckpoint());await state(recovered,'saved')
 await recovered.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('trafaret-surface-checkpoint');req.onsuccess=()=>{const db=req.result,tx=db.transaction('projects','readwrite');tx.objectStore('projects').put({token:'corrupt',bytes:new ArrayBuffer(4)},'surface');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)}}))
 await recovered.reload();await state(recovered,'error');await stroke(recovered);await project(recovered,'Аварийный экспорт .tfs');await recovered.close();const stillBad=await open();await state(stillBad,'error')
 console.log('PASS Surface checkpoint: field+measurements, link/reload/tab close, cancel/undo/redo/reset, conflict, pending, emergency export, corrupt read')
} finally {try {await browser?.close()} finally {await server.close()}}
