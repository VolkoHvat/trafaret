import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { preview } from 'vite'

const server=await preview({build:{outDir:process.argv[2]??'dist'},preview:{host:'127.0.0.1',port:0,open:false}})
let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()})
  const page=await browser.newPage({viewport:{width:1280,height:1200}}), errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const click=name=>page.getByRole('button',{name,exact:true}).click(),canvas=page.getByLabel('Поле плотности',{exact:true}),tool=page.getByLabel('Инструмент'),name=page.getByLabel('Имя документа'),mm=page.getByLabel('Ширина поля, мм'),opacity=page.getByLabel('Непрозрачность')
  const file=async action=>{const [d]=await Promise.all([page.waitForEvent('download'),click(action)]);return readFile(await d.path())}
  const upload=async (action,filename,buffer,mimeType)=>{const [picker]=await Promise.all([page.waitForEvent('filechooser'),click(action)]);await picker.setFiles({name:filename,buffer,mimeType})}
  await click('Чистое поле');await canvas.click();const drawn=await file('Экспорт поля')
  await tool.selectOption('restore');await canvas.click();const fixed=await file('Экспорт поля');assert.notDeepEqual(fixed,drawn)
  await click('Шаг назад');assert.deepEqual(await file('Экспорт поля'),drawn);await click('Шаг вперёд');assert.deepEqual(await file('Экспорт поля'),fixed)
  await tool.selectOption('pan');await click('Увеличить');await canvas.focus();await page.keyboard.press('ArrowLeft');const left=await canvas.evaluate(c=>c.getBoundingClientRect().left)
  const b=await canvas.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+50,b.y+b.height/2+15,{steps:3});await page.mouse.up();assert.notEqual(await canvas.evaluate(c=>c.getBoundingClientRect().left),left)
  await click('Вписать');assert.deepEqual(await file('Экспорт поля'),fixed)
  const png=await file('Экспорт PNG'),ref=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=96;c.height=48;const ctx=c.getContext('2d');ctx.fillStyle='black';ctx.fillRect(7,7,75,25);return c.toDataURL().split(',')[1]});await upload('Импорт PNG/JPEG reference','ref.png',Buffer.from(ref,'base64'),'image/png');await page.getByAltText('Локальная подложка').waitFor();assert.deepEqual(await file('Экспорт PNG'),png)
  await click('Разложить в линворк');await page.getByRole('img',{name:'Предпросмотр осей штрихов'}).waitFor();assert.deepEqual(await file('Экспорт поля'),fixed)
  await click('Применить штрихи к полю');assert.notDeepEqual(await file('Экспорт поля'),fixed);await click('Шаг назад');assert.deepEqual(await file('Экспорт поля'),fixed)
  await click('Скрыть reference');assert.equal(await page.getByAltText('Локальная подложка').count(),0);await click('Показать reference');assert.deepEqual(await file('Экспорт PNG'),png)
  await opacity.focus();await page.keyboard.press('Home');for(let i=0;i<27;i++)await page.keyboard.press('ArrowRight');await name.fill('Эскиз №4');await mm.fill('87.5');await page.getByRole('combobox',{name:/^Проекция/}).selectOption('stencil');const doc=await file('Сохранить документ')
  await click('Новый документ');assert.equal(await name.inputValue(),'Без названия');assert.equal(await page.getByAltText('Локальная подложка').count(),0)
  await upload('Открыть документ','эскиз.tfw',doc,'application/octet-stream');await page.getByText('Документ открыт',{exact:true}).waitFor();assert.deepEqual(await file('Сохранить документ'),doc)
  const corrupt=Buffer.from(doc);corrupt[17]^=1;await upload('Открыть документ','bad.tfw',corrupt,'application/octet-stream');await page.getByText('Повреждены метаданные документа').waitFor();assert.deepEqual(await file('Сохранить документ'),doc)
  await page.reload();await page.getByText('Локальное поле загружено').waitFor();assert.deepEqual(await file('Сохранить документ'),doc);assert.equal(await name.inputValue(),'Эскиз №4');assert.equal(await mm.inputValue(),'87.5');assert.equal(await opacity.inputValue(),'0.27');assert.deepEqual(await file('Экспорт поля'),fixed)
  // Force an actual IDB write transaction abort: the previous field AND metadata must survive.
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);this.transaction.abort();return request}})
  await click('Новый документ');await page.getByText('Не удалось сохранить локально — экспортируйте файл').waitFor();await page.reload();await page.getByText('Локальное поле загружено').waitFor();assert.deepEqual(await file('Сохранить документ'),doc)
  assert.deepEqual(errors,[]);console.log(`Workspace PASS; ${browser.version()}; document ${doc.length} B`)
}finally{try{await browser?.close()}finally{await server.close()}}
