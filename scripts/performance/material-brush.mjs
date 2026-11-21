import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
const out=process.argv[2];assert.ok(out)
const server=await preview({build:{outDir:out},preview:{host:'127.0.0.1',port:0}});let browser
try{
 browser=await chromium.launch({channel:'msedge'});const page=await browser.newPage({viewport:{width:1100,height:850},serviceWorkers:'block'})
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);await page.getByText('Новый документ',{exact:true}).last().waitFor()
 const label=n=>page.getByLabel(n).filter({visible:true}).first(),group=async s=>{const sel=label('Инспектор');if(await sel.count())await sel.selectOption(s)},btn=n=>page.getByRole('button',{name:n,exact:true}).filter({visible:true}).first().click()
 const snapshot=async()=>{await group('document');const wait=page.waitForEvent('download');await btn('Сохранить документ');const b=await readFile(await(await wait).path());const {pigment}=JSON.parse(b.subarray(16,16+b.readUInt32LE(8)));const sums=[0,0,0,0];let count=0;for(const t of pigment.tiles){for(const w of t.pixels){if(t.channel==='mixMR'){sums[0]+=w>>>16;sums[1]+=w&65535;if(w>>>16)count++}if(t.channel==='mixGB'){sums[2]+=w>>>16;sums[3]+=w&65535}}}return {sums,count}}
 const tap=async()=>{await label('Поле плотности').click({position:{x:80,y:70}});await page.getByRole('status').filter({hasText:'Сохранено локально'}).first().waitFor()}
 await group('pigment');await label('Режим пигмента').selectOption('material');await label('Добавлять новый пигмент').check();await label('Цвет вещества').fill('#af3593');await tap();const first=await snapshot();await group('pigment');await label('Добавлять новый пигмент').uncheck();await tap();const second=await snapshot();assert.deepEqual(second.sums,first.sums);assert.ok(second.count>first.count)
 await group('scene');await btn('Шаг назад');assert.deepEqual(await snapshot(),first);await group('scene');await btn('Шаг вперёд');assert.deepEqual(await snapshot(),second);console.log('PASS Edge: material export, zero-feed ring, undo/redo',first,second)
}finally{await browser?.close();await server.close()}
