import { useEffect, useMemo, useRef, useState } from 'react'
import { flatCheck, sleeveUV, type Raster, type Wrap } from '../lib/composition-review'
import './CompositionTool.css'

function RasterCanvas({ image, label }: { image: Raster; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return
    const buffer = ctx.createImageData(image.width, image.height)
    buffer.data.set(image.data); ctx.putImageData(buffer, 0, 0)
  }, [image])
  return <canvas ref={ref} width={image.width} height={image.height} aria-label={label}/>
}

function Sleeve({image, widthMm}: {image: Raster; widthMm: number}) {
  const [full, setFull] = useState(false), [side,setSide] = useState(-90), [offset,setOffset] = useState(0)
  const [circ,setCirc] = useState('280'), [length,setLength] = useState('320')
  const valid = [circ,length].every(v => Number(v) >= 10 && Number(v) <= 1500)
  const wrap: Wrap = {full, widthMm, circumference:Number(circ), length:Number(length), seamDeg:side+offset}
  const views = valid ? [-90,0,90].map(yaw => {
    const ratio = wrap.circumference / Math.PI / wrap.length
    const width = Math.max(1,Math.round(Math.min(192,240*ratio))), height = Math.max(1,Math.round(Math.min(240,192/ratio)))
    const data = new Uint8ClampedArray(width*height*4)
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const uv=sleeveUV(2*(x+.5)/width-1,(y+.5)/height,yaw,wrap,image.width/image.height), dst=4*(y*width+x)
      if(!uv){data.set([217,196,179,255],dst);continue}
      const i=4*(Math.floor(uv[1]*image.height)*image.width+Math.floor(uv[0]*image.width));data.set(image.data.subarray(i,i+4),dst)
    }
    const angle=(wrap.seamDeg-yaw)*Math.PI/180
    return <figure key={yaw}><div className="wrap-face"><RasterCanvas image={{width,height,data}} label={`Ракурс ${yaw}°`}/>{Math.cos(angle)>0.001&&<i style={{left:`${(1+Math.sin(angle))*50}%`}}/>}</div><figcaption>{yaw}°</figcaption></figure>
  }) : null
  return <section><h2>Рукав</h2><label>Размещение <select value={full?'full':'motif'} onChange={e=>setFull(e.target.value==='full')}><option value="motif">Одиночный мотив</option><option value="full">Полная развёртка</option></select></label>
    <label>Обхват, мм <input type="number" min="10" max="1500" value={circ} onChange={e=>setCirc(e.target.value)}/></label><label>Длина участка, мм <input type="number" min="10" max="1500" value={length} onChange={e=>setLength(e.target.value)}/></label>
    <label>Шов <select value={side} onChange={e=>setSide(+e.target.value)}><option value={-90}>Слева</option><option value={90}>Справа</option></select></label><label>Смещение шва: {offset}° <input type="range" min="-90" max="90" value={offset} onChange={e=>setOffset(+e.target.value)}/></label>
    {valid?<div className="wrap-views">{views}</div>:<p role="alert">Введите мерки от 10 до 1500 мм.</p>}
    <p>{full?'Весь лист растянут на обхват и длину. Сравните края у пунктирного шва: они могут не совпасть.':`Лист шириной ${widthMm} мм без растяжения, по центру напротив шва. За краями участка мотив обрезается, не повторяется.`} Три вида одного цилиндра; мерки начальные, замените своими. Сужение, складки и движение кожи не моделируются.</p></section>
}

export default function CompositionTool({image, neutral, widthMm, leave}: {image: Raster; neutral:number; widthMm:number; leave:()=>void}) {
  const [view,setView]=useState('Спина'), [bands,setBands]=useState(3), [guides,setGuides]=useState([true,true,true]), [focus,setFocus]=useState(-1)
  const flat=useMemo(()=>flatCheck(image,neutral,bands),[image,neutral,bands])
  const names=['Слева сверху','Справа сверху','Слева снизу','Справа снизу']
  return <main className="composition-tool" onKeyDown={e=>{if(e.key==='Escape')leave()}}><header><button autoFocus onClick={leave}>Вернуться в поле</button><h1>Композиция</h1></header>
    <div className="composition-layout"><section><h2>Плоская проверка</h2><label>Тональные массы <select value={bands} onChange={e=>setBands(+e.target.value)}><option value={2}>2 · силуэт</option><option value={3}>3 · массы</option></select></label><div className="flat-thumb"><RasterCanvas image={flat} label="Маленькая проверка силуэта и масс"/>{focus>=0&&<i style={{left:`${focus%2*50}%`,top:`${Math.floor(focus/2)*50}%`}}/>}</div><p>Уменьшение ≠ размер на коже. Лист {widthMm} мм по ширине. Различим ли главный мотив без деталей?</p><label>Область внимания <select value={focus} onChange={e=>setFocus(+e.target.value)}><option value={-1}>Не отмечена</option>{names.map((n,i)=><option key={n} value={i}>{n}</option>)}</select></label><p>Близко к фону: {Math.round(flat.quiet*100)}%. Это возможное негативное пространство, не дефект. Остаются ли просветы между массами?</p><p>Среднее отличие яркости от фона (0–255): {names.map((n,i)=>`${n.toLowerCase()} ${flat.contrast[i]}`).join('; ')}. Конкурирует ли другая четверть с выбранной?</p></section>
    <section><label>Режим <select value={view} onChange={e=>setView(e.target.value)}><option>Спина</option><option>Рукав</option></select></label>{view==='Спина'?<><h2>Спина</h2><fieldset><legend>Направляющие · не для печати</legend>{['Лопатки','Ось','Поясница'].map((name,i)=><label key={name}><input type="checkbox" checked={guides[i]} onChange={()=>setGuides(g=>g.map((v,j)=>j===i?!v:v))}/>{name}</label>)}</fieldset><div className="back-plane"><RasterCanvas image={image} label="Текущая композиция на плоскости"/><svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">{guides[0]&&<path d="M12 19 Q25 13 40 26 L34 43 Q23 37 12 19 M88 19 Q75 13 60 26 L66 43 Q77 37 88 19"/>}{guides[1]&&<path d="M50 2 V98"/>}{guides[2]&&<path d="M12 78 Q50 68 88 78"/>}</svg></div><p>Условные ориентиры, не индивидуальная анатомия. Сверьте ось и движение лопаток на теле.</p></>:<Sleeve image={image} widthMm={widthMm}/>}</section></div><p>Только просмотр текущей проекции, без подложки. Отметки и мерки исчезнут при выходе.</p></main>
}
