import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preview } from 'vite'
import { chromium } from 'playwright'

const [outDir,images]=process.argv.slice(2); assert.ok(outDir && images,'Pass production outDir and PNG directory')
await mkdir(images,{recursive:true})
const server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try {
 const url=`http://127.0.0.1:${server.httpServer.address().port}/?surface=1&field=2048`
 assert.equal(await (await fetch(url)).text(),await readFile(join(outDir,'index.html'),'utf8'))
 browser=await chromium.launch({channel:'msedge'})
 const ctx=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}})
 const p=await ctx.newPage(), errors=[];p.on('pageerror',e=>errors.push(e.message))
 const click=n=>p.getByRole('button',{name:n,exact:true}).click(), model=p.getByLabel('3D-модель тела',{exact:true}), chest=p.getByLabel('Обхват груди, см',{exact:true})
 const selected=async(n)=>assert.equal(await p.getByRole('button',{name:n,exact:true}).getAttribute('aria-pressed'),'true')
 await p.goto(url);await click('Мерки');await click('Мужская');await selected('Мужская')
 const male=await model.screenshot({path:join(images,'male-front.png')})
 await click('Женская');await selected('Женская');const female=await model.screenshot({path:join(images,'female-front.png')})
 assert.ok(!male.equals(female));await chest.fill('93.5');await chest.blur()
 await p.waitForFunction(()=>document.querySelector('.surface-status')?.textContent.includes('Сохранено локально'))
 await p.reload();await click('Мерки');await selected('Женская');assert.equal(await chest.inputValue(),'93.5')
 const pigment=p.getByLabel('Режим пигмента').filter({visible:true}).first();await pigment.selectOption('line')
 const b=await model.boundingBox();await p.mouse.move(b.x+b.width*.5,b.y+b.height*.43);await p.mouse.down();await p.mouse.move(b.x+b.width*.51,b.y+b.height*.45,{steps:4});await p.mouse.up()
 assert.ok(await chest.isDisabled());const flat=p.getByLabel('Развёртка поля',{exact:true}), atlas=()=>flat.evaluate(c=>c.toDataURL());const painted=await atlas()
 const savedTiles=()=>p.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('trafaret-density-2');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result,tx=db.transaction('documents'),cursor=tx.objectStore('documents').openCursor(IDBKeyRange.bound('2048/','2048/\uffff')),tiles={};cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;if(/^(2048\/\d+|2048\/pigment\/.*)$/.test(c.key))tiles[c.key]=Array.from(c.value);c.continue()};tx.oncomplete=()=>{db.close();resolve(tiles)};tx.onabort=()=>reject(tx.error)}}))
 await p.waitForFunction(()=>document.querySelector('.surface-status')?.textContent.includes('Сохранено локально'));const original=await savedTiles();assert.ok(Object.keys(original).some(k=>k.includes('/pigment/line/')));assert.ok(Object.keys(original).some(k=>/^2048\/\d+$/.test(k)))
 p.once('dialog',d=>d.dismiss());await click('Мужская');await selected('Женская');assert.equal(await chest.inputValue(),'93.5')
 p.once('dialog',d=>d.accept());await click('Мужская');await selected('Мужская');assert.equal(await atlas(),painted)
 await p.waitForFunction(()=>document.querySelector('.surface-status')?.textContent.includes('Сохранено локально'));await p.reload();await click('Мерки');await selected('Мужская');assert.equal(await atlas(),painted);assert.deepEqual(await savedTiles(),original);assert.deepEqual(errors,[])
 console.log('PASS Edge, production, 2048: both front PNGs, custom measure restored, cancel/accept preset switch, painted atlas identical through reopen:',images)
} finally {try{await browser?.close()}finally{await server.close()}}
