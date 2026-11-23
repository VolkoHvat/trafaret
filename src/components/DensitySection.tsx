import { useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import type { Gesture } from '../lib/gesture-diagnostic'
import { densitySection } from '../lib/density-section'
import type { Segment } from '../lib/density-section'
import type { Size } from '../lib/field-size'

type Props = { children:ReactNode; gesture:Gesture|null; locked:boolean; size:Size }
export default function DensitySection({children,gesture,locked,size:{width,height}}:Props){
  const [select,setSelect]=useState(false), [segment,setSegment]=useState<Segment|null>(null)
  const drag=useRef<number|null>(null)
  const enabled=select && !locked && gesture?.available
  const point=(e:PointerEvent<SVGSVGElement>)=>{
    const r=e.currentTarget.getBoundingClientRect()
    return [Math.max(0,Math.min(width-1,Math.floor((e.clientX-r.left)*width/r.width))),Math.max(0,Math.min(height-1,Math.floor((e.clientY-r.top)*height/r.height)))]
  }
  const defaultSegment={x1:Math.floor(width/4),x2:Math.floor(width*3/4),y1:Math.floor(height/2),y2:Math.floor(height/2)}
  const s=segment??defaultSegment
  const samples=select && gesture?.available ? densitySection(gesture,s):null
  const known=samples?.filter(p=>p!==null)??[]
  const min=Math.min(0,...known.map(p=>p.delta)),max=Math.max(1,...known.flatMap(p=>[p.before,p.after,p.delta]))
  const y=(v:number)=>96-92*(v-min)/(max-min)
  const curves=[['before','До','#63c9f4'],['after','После','#ffb483'],['delta','Δ','#aeec87']] as const
  return <><div className="section-surface">{children}{enabled && <svg aria-label="Выбор отрезка среза" className="section-overlay" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
    onPointerDown={e=>{if(e.button!==0||drag.current!==null)return;drag.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);const [x,y]=point(e);setSegment({x1:x,y1:y,x2:x,y2:y})}}
    onPointerMove={e=>{if(drag.current===e.pointerId){const [x2,y2]=point(e);setSegment(old=>old&&({...old,x2,y2}))}}}
    onPointerUp={e=>{if(drag.current===e.pointerId){const [x2,y2]=point(e);setSegment(old=>old&&({...old,x2,y2}));drag.current=null}}}
    onLostPointerCapture={()=>{drag.current=null}}><line x1={s.x1+.5} y1={s.y1+.5} x2={s.x2+.5} y2={s.y2+.5} stroke="black" strokeWidth="4" vectorEffect="non-scaling-stroke"/><line x1={s.x1+.5} y1={s.y1+.5} x2={s.x2+.5} y2={s.y2+.5} stroke="white" strokeWidth="2" strokeDasharray="5 3" vectorEffect="non-scaling-stroke"/></svg>}</div>
    <section aria-label="Срез плотности"><button aria-pressed={!!enabled} disabled={locked||!gesture?.available} onClick={()=>setSelect(!select)}>{enabled?'Вернуться к рисованию':'Выбрать срез'}</button>
    {!gesture?<p>Нет записи для среза. Включите «Записывать последний жест» и завершите штрих.</p>:gesture.cancelled?<p>Штрих отменён — срез недоступен.</p>:!gesture.available?<p>Запись неполная — срез недоступен: {gesture.reason||'прореживание очереди'}.</p>:null}
    {enabled && <><p>Протяните отрезок поверх поля или задайте координаты его концов. Рисование выключено.</p><div className="transfer-controls">{(['x1','y1','x2','y2'] as const).map(k=><label key={k}>{k.toUpperCase()} <input type="number" min="0" max={(k[0]==='x'?width:height)-1} value={s[k]} onChange={e=>{const v=e.target.valueAsNumber;if(Number.isInteger(v))setSegment({...s,[k]:Math.max(0,Math.min(Number(e.target.max),v))})}}/></label>)}</div>
    <p aria-live="polite" data-section-stats>{known.length===samples?.length?'Полное покрытие':known.length?'Частичное покрытие':'Нет данных вдоль отрезка'}: {known.length}/{samples?.length}. {known.length>0 && `Δρ от ${Math.min(...known.map(p=>p.delta)).toFixed(4)} до ${Math.max(...known.map(p=>p.delta)).toFixed(4)}.`}</p>
    {known.length>0 && <><svg className="section-chart" role="img" aria-label="Плотность до, после и разность вдоль отрезка" viewBox="0 0 512 100" preserveAspectRatio="none"><line x2="512" y1={y(1)} y2={y(1)} stroke="white" strokeDasharray="4 4"/>{curves.map(([key,label,color],index)=>{
      let gap=true, d='';samples?.forEach((p,i)=>{if(!p){gap=true;return}const x=2+508*i/Math.max(1,samples.length-1),v=y(p[key]);d+=`${gap?'M':'L'}${x},${v} `;if(gap)d+=`l0.01,0 `;gap=false})
      return <path key={key} aria-label={label} d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeDasharray={index===0?'7 2':index===2?'2 2':undefined}/>
    })}</svg><p>Слева — начало, справа — конец. Белый пунктир: ρ = 1. Голубая штриховая: до; оранжевая сплошная: после; зелёная точечная: Δ = после − до. Пробел — вне записи.</p></>}</>}
    </section></>
}
