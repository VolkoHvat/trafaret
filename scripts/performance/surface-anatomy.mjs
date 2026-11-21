import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { preview } from 'vite'
import { chromium } from 'playwright'
const [outDir,images]=process.argv.slice(2);assert.ok(outDir&&images)
await mkdir(images,{recursive:true});const server=await preview({build:{outDir},preview:{port:0,host:'127.0.0.1',open:false}})
let browser
try{
 browser=await chromium.launch({channel:'msedge'});const p=await browser.newPage({serviceWorkers:'block',viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message))
 await p.goto(`http://127.0.0.1:${server.httpServer.address().port}/?field=2048&surface=1`)
 const btn=name=>p.getByRole('button',{name,exact:true}),click=name=>btn(name).click(),canvas=p.getByLabel('3D-модель тела',{exact:true}),flat=p.getByLabel('Развёртка поля',{exact:true}),pixels=c=>c.evaluate(el=>el.toDataURL())
 assert.equal(await btn('Тело').getAttribute('aria-pressed'),'true');const baseline=await pixels(flat)
 const snapshots=new Set()
 for(const [sex,label] of [['male','Мужская'],['female','Женская']]){
 await click('Камера');await click('Вся фигура');await click('Мерки');await click(label);await click('Режим');await click('Орбита')
 const b=await canvas.boundingBox();for(const view of ['front','three-quarter']){
 if(view!=='front'){await p.mouse.move(b.x+b.width*.5,b.y+b.height*.45);await p.mouse.down();await p.mouse.move(b.x+b.width*.5+65,b.y+b.height*.45);await p.mouse.up()}
 for(const [mode,name] of [['body','Тело'],['schematic','Схема']]){await click(name);snapshots.add(await pixels(canvas));await canvas.screenshot({path:join(images,`${sex}-${mode}-${view}.png`)})}
 await click('Тело')
 }}assert.equal(snapshots.size,8);assert.equal(await pixels(flat),baseline)
 await click('Камера');await click('Вся фигура');await click('Режим');await p.getByRole('group',{name:'Режим жеста'}).getByRole('button',{name:'Кисть',exact:true}).click();await p.getByLabel('Режим пигмента').filter({visible:true}).first().selectOption('line')
 const b=await canvas.boundingBox();await p.mouse.move(b.x+b.width*.5,b.y+b.height*.35);await p.mouse.down();await p.mouse.move(b.x+b.width*.53,b.y+b.height*.37,{steps:4});await p.mouse.up()
 const tattoo=await pixels(flat),onBody=await pixels(canvas);assert.notEqual(tattoo,baseline);await click('Схема');assert.equal(await pixels(flat),tattoo);await click('Тело');assert.equal(await pixels(canvas),onBody)
 await p.waitForFunction(()=>document.querySelector('.surface-status')?.textContent.includes('Сохранено локально'));await p.reload();await btn('Тело').waitFor();assert.equal(await pixels(flat),tattoo);assert.equal(await pixels(canvas),onBody);assert.deepEqual(errors,[])
 console.log('PASS Edge: 8 distinct model snapshots, atlas unchanged; painted body and atlas identical after mode round trip and reload')
}finally{try{await browser?.close()}finally{await server.close()}}
