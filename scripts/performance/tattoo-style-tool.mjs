import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {preview} from 'vite'
import {chromium} from 'playwright'
const outDir=process.argv[2]; assert.ok(outDir)
const server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0,open:false}}); let browser
try {
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH||chromium.executablePath()})
  const p=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'})
  await p.goto(`http://127.0.0.1:${server.httpServer.address().port}/`)
  const click=name=>p.getByRole('button',{name,exact:true}).click(), label=name=>p.getByLabel(name).filter({visible:true}), canvas=label('Поле плотности'), frame=()=>canvas.evaluate(el=>el.toDataURL()), saved=()=>p.getByText('Сохранено локально',{exact:true}).last().waitFor()
  const tap=async()=>{const b=await canvas.boundingBox();await p.mouse.click(b.x+b.width*.5,b.y+b.height*.5); await saved()}
  const png=async()=>{const d=p.waitForEvent('download');await click('Экспорт PNG');return (await readFile(await (await d).path())).toString('base64')}
  await click('Чистое поле');await saved(); const blank=await frame()
  await p.getByText('Мастер стиля',{exact:true}).first().click();await label('Художественный профиль').selectOption('traditional-neo');await click('Проверка эскиза');await p.getByText('Нет данных: выберите строку текущего поля.').waitFor()
  await p.getByLabel('Строка поля').fill('121');await click('Проверка эскиза');await p.getByText(/Снимок строки 121.*покрытие: 0\.0%/).waitFor()
  await click('Акцент #d49b62');await click('Для линии');assert.equal(await label('Цвет линии').inputValue(),'#d49b62');assert.equal(await label('Цвет заливки').inputValue(),'#000000');await label('Свой HEX').fill('#abcdef');await click('Для заливки');await click('Для смеси');assert.equal(await label('Цвет заливки').inputValue(),'#abcdef');await label('Режим пигмента').selectOption('mix');assert.equal(await label('Цвет пигмента').inputValue(),'#abcdef');assert.equal(await frame(),blank)
  await label('Режим пигмента').selectOption('line');await tap();const styled=await png();assert.notEqual('data:image/png;base64,'+styled,blank);await click('Проверка эскиза');await p.getByText(/Снимок строки 121.*покрытие: (?!0\.0%)[\d.]+%/).waitFor()
  await click('Шаг назад');await saved();assert.equal(await frame(),blank);await label('Цвет линии').fill('#000000');await label('Цвет линии').fill('#d49b62');await tap();assert.equal(await png(),styled);await click('Шаг назад');await saved();assert.equal(await frame(),blank)
  await click('3D-поверхность');await p.getByRole('navigation',{name:'Группы инспектора'}).getByRole('button',{name:'Цвет',exact:true}).click();await p.getByLabel('Инспектор поверхности').getByText('Мастер стиля',{exact:true}).click();assert.equal(await label('Художественный профиль').inputValue(),'traditional-neo');await click('Проверка эскиза');await p.getByText(/Снимок строки 121.*покрытие: 0\.0%/).filter({visible:true}).waitFor();await label('Свой HEX').fill('#ffffff');await click('Для линии');await click('Вернуться в поле');assert.equal(await label('Цвет линии').inputValue(),'#ffffff');assert.equal(await frame(),blank)
  console.log('PASS style profiles, no-data and measured row before/after stroke, independent channels, custom HEX, Surface sharing, identical PNG and Undo vs manual selection')
} finally {try{await browser?.close()}finally{await server.close()}}
