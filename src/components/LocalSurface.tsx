import { useEffect, useRef, useState } from 'react'
import { makeSection, sections, tattooUV, type Section } from '../lib/local-surface'
import './LocalSurface.css'

type Props={image:ImageData;widthMm:number;neutral:number;leave:()=>void}
export default function LocalSurface({image,widthMm,neutral,leave}:Props){
  const [kind,setKind]=useState<Section>('forearm'),[mm,setMm]=useState<string[]>(sections.forearm.mm.map(String))
  const [dx,setX]=useState(0),[dy,setY]=useState(0),[angle,setAngle]=useState(0),[yaw,setYaw]=useState(0)
  const canvas=useRef<HTMLCanvasElement>(null)
  let error='';try{makeSection(kind,mm.map(Number))}catch(e){error=(e as Error).message}
  useEffect(()=>{
    const c=canvas.current,ctx=c?.getContext('2d');if(!c||!ctx||error)return
    const shape=makeSection(kind,mm.map(Number)), scale=Math.min((c.width-60)/shape.width,(c.height-80)/shape.height)
    const img=ctx.createImageData(c.width,c.height),rad=angle*Math.PI/180,cs=Math.cos(rad),sn=Math.sin(rad),view=yaw*Math.PI/180
    for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
      const hit=shape.sample((x+.5-c.width/2)/scale,(y+.5-c.height/2)/scale+shape.height/2,view);if(!hit)continue
      const {u,v}=tattooUV(hit.x,hit.y,dx,dy,cs,sn,widthMm),inside=u>=0&&u<1&&v>=0&&v<1
      const src=4*(Math.floor(u*image.width)+Math.floor(v*image.height)*image.width),dst=4*(x+y*c.width)
      for(let k=0;k<3;k++)img.data[dst+k]=[222,184,159][k]*hit.light*(inside?image.data[src+k]/neutral:1)
      img.data[dst+3]=255
    }
    ctx.putImageData(img,0,0);ctx.fillStyle='#eee';const bar=scale*50;ctx.fillRect((c.width-bar)/2,c.height-22,bar,2);ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('50 мм',c.width/2,c.height-5)
  },[image,neutral,widthMm,kind,mm,dx,dy,angle,yaw,error])
  function slider(name:string,value:number,set:(v:number)=>void,limit:number,unit:string){return <label>{name} <output>{value}{unit}</output><input aria-label={name} type="range" min={-limit} max={limit} value={value} onChange={e=>set(+e.target.value)}/></label>}
  return <main className="local-surface"><header><button onClick={leave}>Вернуться в поле</button><h1>Участок тела</h1></header><div className="local-layout"><section><label>Участок <select value={kind} onChange={e=>{const k=e.target.value as Section;setKind(k);setMm(sections[k].mm.map(String));setYaw(0);setX(0);setY(0);setAngle(0)}}>{Object.entries(sections).map(([k,p])=><option key={k} value={k}>{p.name}</option>)}</select></label><p>{sections[kind].hint}</p>
    {mm.map((v,i)=>kind==='back'&&i===1?null:<label key={i}>{(kind==='back'?['Ширина','','Высота']:['Верхний обхват','Нижний обхват','Длина по коже','Средний обхват'])[i]}, мм <input type="number" min="10" max="1500" value={v} onChange={e=>setMm(mm.map((s,j)=>j===i?e.target.value:s))}/></label>)}
    {error&&<p role="alert">{error}</p>}<h2>Размещение</h2>{slider('Сдвиг поперёк',dx,setX,750,' мм')}{slider('Сдвиг вдоль',dy,setY,750,' мм')}{slider('Поворот рисунка',angle,setAngle,180,'°')}{slider('Обзор',yaw,setYaw,kind==='back'?75:180,'°')}
    </section><figure><canvas hidden={!!error} ref={canvas} width="560" height="600" aria-label="Проекция участка тела"/><figcaption>Поле {image.width}² · {widthMm} × {widthMm} мм · {(widthMm/image.width).toPrecision(4)} мм/px. Размер всего листа задаётся в «Документ и печать». За краем участка рисунок обрезается.</figcaption></figure></div><p>Условная поверхность, не слепок. Посадку на локтевой складке и лопатках проверьте на коже. Мерки и размещение этого просмотра не сохраняются после выхода.</p></main>
}
