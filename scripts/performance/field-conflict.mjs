import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const server=await preview({build:{outDir:process.argv[2]??'dist'},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
const button=(p,name)=>p.getByRole('button',{name,exact:true}), name=p=>p.getByLabel('Имя документа'), saved=p=>p.getByText('Сохранено локально',{exact:true}).waitFor()
async function file(p){const [d]=await Promise.all([p.waitForEvent('download'),button(p,'Сохранить документ').click()]);return readFile(await d.path())}
async function tap(p,x){const c=p.getByLabel('Поле плотности',{exact:true}), b=await c.boundingBox();await c.click({position:{x:Math.floor(x*b.width),y:Math.floor(.5*b.height)}})}
const url=`http://127.0.0.1:${server.httpServer.address().port}/`
try{
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()})
  for(const [label,x] of [['overlap',.26],['disjoint',.75]]){
    const ctx=await browser.newContext({serviceWorkers:'block'}),a=await ctx.newPage(),b=await ctx.newPage(),errors=[]
    for(const p of [a,b])p.on('pageerror',e=>errors.push(String(e)))
    const response=await a.goto(url);assert.equal(response.status(),200);assert.equal(await response.text(),await readFile(`${process.argv[2]??'dist'}/index.html`,'utf8'));await a.bringToFront();await button(a,'Чистое поле').click();await saved(a)
    // Establish the exact standalone result for B's edit before creating the race.
    await tap(a,x);await saved(a);const expectedLocal=await file(a);await button(a,'Шаг назад').click();await saved(a)
    await b.goto(url);await b.getByText('Локальное поле загружено').waitFor()
    const base=await file(b);await tap(a,.25);await saved(a);await name(a).fill('Победитель');await saved(a);const winner=await file(a)
    await tap(b,x);await b.getByText(/^Конфликт:/).waitFor();const local=await file(b)
    assert.deepEqual(local,expectedLocal);assert.notDeepEqual(local,base);assert.notDeepEqual(local,winner);assert.equal(await name(b).inputValue(),'Без названия')
    for(const n of ['Новый документ','Открыть документ','Основная студия · открыть 2048×2048'])assert.ok(await button(b,n).isDisabled())
    b.once('dialog',d=>d.dismiss());await button(b,'Открыть актуальную версию').click();assert.deepEqual(await file(b),local)
    await a.reload();await a.getByText('Локальное поле загружено').waitFor();assert.deepEqual(await file(a),winner)
    b.once('dialog',d=>d.accept());await button(b,'Открыть актуальную версию').click();await b.getByText('Локальное поле загружено').waitFor();assert.deepEqual(await file(b),winner)
    // Abort after a real put. Retry must not be necessary to download the entire failed document.
    await b.evaluate(()=>{const orig=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const r=orig.apply(this,args);this.transaction.abort();return r}})
    b.once('dialog',d=>d.accept());await button(b,'Новый документ').click();await b.getByText('Не удалось сохранить локально — экспортируйте файл').waitFor();const emergency=await file(b);assert.deepEqual(emergency,base)
    const dialogPromise=b.waitForEvent('dialog');const reload=b.reload({timeout:5000}).catch(()=>{});const dialog=await dialogPromise;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();await reload;assert.deepEqual(await file(b),emergency)
    await a.reload();await a.getByText('Локальное поле загружено').waitFor();assert.deepEqual(await file(a),winner)
    a.once('dialog',d=>d.accept());const [picker]=await Promise.all([a.waitForEvent('filechooser'),button(a,'Открыть документ').click()]);await picker.setFiles({name:'emergency.tfw',mimeType:'application/octet-stream',buffer:emergency});await saved(a);await a.reload();await a.getByText('Локальное поле загружено').waitFor();assert.deepEqual(await file(a),emergency)
    assert.deepEqual(errors,[]);await ctx.close();console.log(`${label}: both versions, abort and emergency round-trip PASS`)
  }
  console.log(`Field conflict PASS; ${browser.version()}`)
}finally{try{await browser?.close()}finally{await server.close()}}
