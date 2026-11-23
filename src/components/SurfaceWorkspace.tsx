import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as Pointer } from 'react'
import { presets, defaults as legacyBody, type Preset } from '../lib/surface-body'
import { front, parts, names, measurementsDefs, texelBounds, scene, sceneBuffers, chart, flatHit, connected, surfacePitch, type Camera, type Part, type Settings, type Hit } from '../lib/surface-model'
import type { SharedField } from '../lib/shared-field'
import { writeTile, type Patch } from '../lib/field-tiles'
import { PathInput, project, type BufferMode } from '../lib/density-transfer'
import { encodeField } from '../lib/field-document'
import { decodeSurfaceProject, encodeSurfaceProject, maxProjectBytes, SurfaceBrush, validMeasurement } from '../lib/customer-surface-profile'
import { SurfaceZone } from '../lib/surface-zone'
import { openSurfaceCheckpoint, readSurfaceCheckpoint } from '../lib/customer-surface-profile-checkpoint'
import { composite } from '../lib/pigment-view'
import type { PigmentField } from '../lib/pigment'
import type { ReactNode } from 'react'
import './SurfaceWorkspace.css'
import './surface-hud.css'
import { fineBrush, pigmentSpan } from '../lib/fine-line'

import { sizeOf, SMALL } from '../lib/field-size'
type Mode = 'draw'|'zone'|'orbit'|'pan'
const tools: Record<Mode,string> = {draw:'Кисть',zone:'Зона',pan:'Панорама',orbit:'Орбита'}
const views = {model:'3D фигура',atlas:'2D развёртка',both:'Рядом'} as const
const flatFit = {x:0,y:0,zoom:1}
type Session = {core:Set<number>;material?:Material;id:number;target:HTMLElement;model:boolean;mode:Mode;x:number;y:number;before:Patch|null;zoneBefore:SurfaceZone|null;last:Hit|null;path:PathInput|null;changed:boolean}
function drafts(settings:Settings){return Object.fromEntries(measurementsDefs.map(({key})=>[key,String(settings[key])])) as Record<keyof Settings,string>}
function download(bytes:ArrayBuffer,name:string){const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
type Material=ReturnType<PigmentField['materialStroke']>
type Props = Omit<SharedField,'commit'> & {beginMaterial():Material|undefined;commit(before:Patch,material?:Material,core?:Set<number>):void; bufferMode:BufferMode; projection:"tone"|"stencil";pigment:PigmentField;inkRevision:number;palette:ReactNode;filling:boolean;fillAt(i:number,outside?:(j:number)=>boolean):void; body: Settings; setBody(body:Settings):void; replace(field:Float64Array,body:Settings):void; leave():void; locked:boolean; status:string }
export default function SurfaceWorkspace({beginMaterial,bufferMode,projection,pigment,inkRevision,palette,filling,fillAt,field,commit,travel,canUndo,canRedo,body,setBody,replace,leave,locked,status}:Props){
 const atlasSize=sizeOf(field.length),{width:WIDTH,height:HEIGHT}=atlasSize
 const view=useRef<HTMLCanvasElement>(null), flat=useRef<HTMLCanvasElement>(null), stage=useRef<HTMLDivElement>(null)
 const [geometry,setGeometry]=useState<'body'|'schematic'>('body')
 const [camera,setCamera]=useState<Camera>(front),[mode,setMode]=useState<Mode>('draw'),[radius,setRadius]=useState(3),[fineMm,setFineMm]=useState<number|null>(.25)
 const [draft,setDraft]=useState(()=>drafts(body)),[notice,setNotice]=useState(''),[loading,setLoading]=useState(false)
 const [layout,setLayout]=useState<keyof typeof views>('model'),[flatCamera,setFlatCamera]=useState(flatFit)
 const [zone,setZone]=useState(()=>new SurfaceZone(atlasSize)),[zoneRadius,setZoneRadius]=useState(12)
 const groups=['Документ','Цвет','Режим','Кисть','Зона','Камера','Мерки','Файл'] as const
 const [group,setGroup]=useState<typeof groups[number]>('Документ')
 const pending=useRef(false)
 const invalid=measurementsDefs.some(d=>!draft[d.key].trim()||!validMeasurement(Number(draft[d.key]),d))
 const [size,setSize]=useState({w:360,h:440}),[revision,refresh]=useState(0),[busy,setBusy]=useState(false)
 const gesture=useRef<Session|null>(null)
 const hasInk=pigment.hasInk||field.some(v=>v!==1)
 useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(gesture.current||pending.current){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[])
 const projected=useRef<ReturnType<typeof scene>|null>(null)
 const frame=useMemo(()=>({buffers:sceneBuffers(size.w,size.h),image:new ImageData(size.w,size.h)}),[size.w,size.h])
 const atlas=useMemo(()=>new ImageData(WIDTH,HEIGHT),[WIDTH,HEIGHT])
 useLayoutEffect(()=>{const el=stage.current!;const resize=()=>{const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;const k=Math.min(1,840/w,740/h);setSize({w:Math.max(1,Math.round(w*k)),h:Math.max(1,Math.round(h*k))})};resize();const ob=new ResizeObserver(resize);ob.observe(el);return()=>ob.disconnect()},[])
 useLayoutEffect(()=>{projected.current=scene(frame.image.width,frame.image.height,body,camera,frame.buffers,atlasSize,geometry)},[frame,body,camera,atlasSize,geometry])
 useLayoutEffect(()=>{
  for(let i=0;i<field.length;i++){const k=i*4,val=project(field[i],projection);atlas.data[k]=atlas.data[k+1]=atlas.data[k+2]=val;atlas.data[k+3]=255;if(projection!=='stencil'&&pigment.hasInk)composite(atlas.data,k,pigment,i);if(zone.active&&zone.contains(i%WIDTH,Math.floor(i/WIDTH))){atlas.data[k]=val*.55;atlas.data[k+2]=Math.min(255,val*.8+75)}}
  const ac=flat.current!.getContext('2d')!;ac.putImageData(atlas,0,0);for(const p of parts){const c=chart(p,body,atlasSize);ac.strokeStyle='#83574c';ac.strokeRect(c.x,c.y,c.w,c.rows)}
 },[atlas,field,revision,body,zone,projection,pigment,inkRevision,atlasSize,WIDTH])
 useLayoutEffect(()=>{
  const probe=projected.current!,img=frame.image,data=img.data
  for(let i=0;i<probe.ids.length;i++){const id=probe.ids[i],k=i*4;data[k+3]=255
   if(id===-1){data[k]=23;data[k+1]=19;data[k+2]=21;continue}
   const texel=probe.indices[i]*4,tone=id>=0?atlas.data[texel+1]/176:1,light=probe.shade[i]*tone
   data[k]=light*(id<0?.75:1.28);data[k+1]=light*(id<0?.72:1);data[k+2]=light*(id<0?.7:.87)
   if(id>=0&&projection==='stencil'){data[k]=data[k+1]=data[k+2]=atlas.data[texel+1]}
   else if(id>=0&&pigment.hasInk){const idx=probe.indices[i];if(pigment.get('line',idx)||pigment.get('fill',idx)||pigment.mixAt(idx)){const factor=Math.min(1,probe.shade[i]/150);for(let j=0;j<3;j++)data[k+j]=atlas.data[texel+j]*factor}}
   if(id>=0&&zone.active&&zone.contains(probe.indices[i]%WIDTH,Math.floor(probe.indices[i]/WIDTH))){data[k]*=.55;data[k+1]=light*.8+36;data[k+2]=light*.8+75}
  }
  view.current!.getContext('2d')!.putImageData(img,0,0)
 },[frame,body,camera,geometry,atlas,revision,zone,projection,pigment,inkRevision,atlasSize,WIDTH])
 const finish=useCallback((cancel:boolean)=>{const s=gesture.current;if(!s)return;gesture.current=null;if(s.before){if(cancel){for(const [id,tile] of s.before)writeTile(field,id,tile)}else commit(s.before,s.material,s.core);refresh(v=>v+1)}if(cancel&&s.zoneBefore)setZone(s.zoneBefore);if(s.target.hasPointerCapture(s.id))s.target.releasePointerCapture(s.id);setBusy(false)},[field,commit])
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape')finish(true)},blur=()=>finish(true);window.addEventListener('keydown',key);window.addEventListener('blur',blur);return()=>{window.removeEventListener('keydown',key);window.removeEventListener('blur',blur)}},[finish])
 function trace(s:Session,x:number,y:number){
  const canvas=(s.model?view:flat).current!,rect=canvas.getBoundingClientRect(),clip=s.target.getBoundingClientRect()
  const dx=x-s.x,dy=y-s.y,steps=Math.max(1,Math.min(2048,Math.ceil(Math.hypot(dx*canvas.width/rect.width,dy*canvas.height/rect.height)*2)))
  for(let i=1;i<=steps;i++){
   const px=s.x+dx*i/steps,py=s.y+dy*i/steps,u=(px-rect.left)/rect.width,v=(py-rect.top)/rect.height
   const hit=px<clip.left||px>=clip.right||py<clip.top||py>=clip.bottom?null:s.model?projected.current!.hit(u*size.w,v*size.h):flatHit(u*WIDTH,v*HEIGHT,body,atlasSize)
   if(!hit){s.last=null;s.path=null;continue}
   if(s.mode==='zone'){zone.dab(hit,zoneRadius,body);continue}
   if(!zone.contains(hit.x,hit.y)){s.last=null;s.path=null;continue}
   if(!connected(s.last,hit)||!s.path){const metric=fineMm===null?null:surfacePitch(hit,body,atlasSize,geometry),pitch=metric?Math.max(metric.u,metric.v):0,r=fineMm!==null&&pitch>0?fineBrush(fineMm,pitch).radius:radius;const kernel=new SurfaceBrush(r,hit.part,body,zone.active?zone.contains:undefined,s.before??undefined,atlasSize,bufferMode);kernel.markCore=i=>s.core.add(i);kernel.material=s.material?.stamp;s.path=new PathInput(field,kernel,hit);if(fineMm!==null)setNotice(pitch?`Шаг по большей оси: ${pitch.toFixed(3)} мм/текс.; проба ≈ ${(pigmentSpan({radius:r,buffer:3})*pitch).toFixed(3)} мм. Поддержка: r ${r} + буфер 3 текс.`:'Локальный масштаб недоступен; используется ручной радиус.')}
   else s.path.move(hit)
   s.last=hit;s.changed=true
  }
  refresh(v=>v+1)
 }
 function down(e:Pointer<HTMLDivElement>){
  const model=e.currentTarget===stage.current
  if(locked||pending.current||gesture.current||e.button!==0||!e.isPrimary||mode==='orbit'&&!model||invalid&&mode==='draw')return
  if(filling&&mode==='draw'){const rect=(model?view:flat).current!.getBoundingClientRect(),u=(e.clientX-rect.left)/rect.width,v=(e.clientY-rect.top)/rect.height,hit=model?projected.current!.hit(u*size.w,v*size.h):flatHit(u*WIDTH,v*HEIGHT,body,atlasSize);if(hit){const c=texelBounds(chart(hit.part,body,atlasSize));fillAt(Math.round(hit.y)*WIDTH+Math.round(hit.x),i=>{const x=i%WIDTH,y=Math.floor(i/WIDTH);return x<c.left||x>c.right||y<c.top||y>c.bottom||!zone.contains(x,y)})}return}
  e.preventDefault();const s:Session={core:new Set(),material:mode==='draw'?beginMaterial():undefined,id:e.pointerId,target:e.currentTarget,model,mode,before:mode==='draw'?new Map():null,zoneBefore:mode==='zone'?zone.clone():null,x:e.clientX,y:e.clientY,last:null,path:null,changed:false}
  gesture.current=s;s.target.setPointerCapture(s.id);setBusy(true);if(mode==='draw'||mode==='zone')trace(s,s.x,s.y)
 }
 function move(e:Pointer<HTMLDivElement>){
  const s=gesture.current;if(!s||s.id!==e.pointerId)return
  const dx=e.clientX-s.x,dy=e.clientY-s.y;if(!dx&&!dy)return
  if(s.mode==='orbit')setCamera(v=>({...v,yaw:v.yaw+dx*.012,pitch:Math.max(-Math.PI/2,Math.min(Math.PI/2,v.pitch+dy*.008))}))
  else if(s.mode==='pan'){
   if(s.model){const rect=s.target.getBoundingClientRect();setCamera(v=>({...v,panX:(v.panX??0)+dx/rect.width,panY:(v.panY??0)+dy/rect.height}))}
   else setFlatCamera(v=>({...v,x:v.x+dx,y:v.y+dy}))
  }else trace(s,e.clientX,e.clientY)
  s.x=e.clientX;s.y=e.clientY
 }
 const handlers={onPointerDown:down,onPointerMove:move,onPointerUp:(e:Pointer<HTMLDivElement>)=>{if(e.pointerId===gesture.current?.id){move(e);finish(false)}},onPointerCancel:(e:Pointer<HTMLDivElement>)=>{if(e.pointerId===gesture.current?.id)finish(true)},onLostPointerCapture:(e:Pointer<HTMLDivElement>)=>{if(e.pointerId===gesture.current?.id)finish(true)}}
 function choosePreset(preset:Preset){
  if(body.preset===preset)return
  const baseline=body.preset?presets[body.preset]:legacyBody
  if((hasInk||canUndo||canRedo||measurementsDefs.some(({key})=>draft[key]!==String(baseline[key])))&&
    !window.confirm('Заменить мерки стартовыми значениями выбранной формы? Рисунок, пигмент и история сохранятся в тех же ячейках атласа. На фигуре рисунок изменит пропорции.'))return
  const next={...presets[preset]}; setBody(next);setDraft(drafts(next))
 }
 function history(back:boolean){travel(!back);refresh(v=>v+1)}
 function fit(){setCamera(front);setFlatCamera(flatFit)}
 function focus(p:Part){setCamera(v=>({...v,focus:p,panX:0,panY:0,zoom:2.6}))}
 function reset(){if(!window.confirm('Очистить рисунок и историю, оставив мерки? Сначала сохраните проект .tfs, если хотите вернуться к нему.'))return;replace(new Float64Array(field.length).fill(1),body);refresh(v=>v+1);setNotice('Поле очищено. Можно изменить мерки.')}
 async function restore(file?:File){
  if(gesture.current||pending.current)return
  pending.current=true;setLoading(true)
  try{if(file&&file.size>maxProjectBytes)throw Error('Слишком большой файл');const saved=file?decodeSurfaceProject(await file.arrayBuffer()):await (async()=>{const db=await openSurfaceCheckpoint();try{return await readSurfaceCheckpoint(db)}finally{db.close()}})();if(!saved){setNotice('Старой локальной копии нет.');return}if(!window.confirm('Открыть проект и заменить текущее поле, мерки и историю?'))return
   replace(saved.field,saved.body);setDraft(drafts(saved.body));refresh(v=>v+1);fit();setZone(new SurfaceZone(atlasSize));setNotice('Проект поверхности открыт.')
  }catch(e){setNotice(`Не удалось открыть проект: ${e instanceof Error?e.message:'ошибка файла'}. Текущее поле сохранено в редакторе.`)}finally{pending.current=false;setLoading(false)}
 }
 function save(full:boolean){try{download(full?encodeSurfaceProject(field,body):encodeField(field),full?'surface.tfs':'surface.tfd');setNotice(full?'Подготовлен проект с полем и мерками.':'Подготовлено поле без мерок.')}catch(e){setNotice(`Ошибка сохранения: ${e instanceof Error?e.message:'неизвестная ошибка'}`)}}
 return <main className="surface-workspace"><header><div><span className="eyebrow">TRАFARET / SURFACE</span><h1>Рабочая поверхность</h1><p>Условная фигура по меркам · атлас {WIDTH}×{HEIGHT}</p></div><div><span className="tool-row" role="group" aria-label="Геометрия поверхности">{(['body','schematic'] as const).map(g=><button key={g} disabled={busy||loading||locked} aria-pressed={geometry===g} onClick={()=>setGeometry(g)}>{g==='body'?'Тело':'Схема'}</button>)}</span><button disabled={busy||loading||invalid} onClick={leave}>Вернуться в поле</button></div></header>
 <fieldset className="surface-toolbar" aria-label="Панель Surface" disabled={busy||loading||locked}><div className="tool-row" role="group" aria-label="Вид поверхности">{(Object.keys(views) as (keyof typeof views)[]).map(key=><button key={key} aria-label={views[key]} aria-pressed={key===layout} onClick={()=>{setLayout(key);if(key==='atlas'&&mode==='orbit')setMode('pan')}}>{key==='model'?'3D':key==='atlas'?'2D':'Рядом'}</button>)}</div><button onClick={()=>setGroup('Кисть')}>{tools[mode]} · {radius} текс.</button><div className="surface-pigment">{palette}</div><div className="tool-row"><button disabled={!canUndo} onClick={()=>history(true)}>Отменить</button><button disabled={!canRedo} onClick={()=>history(false)}>Повторить</button><button onClick={()=>setGroup('Файл')}>Сохранить…</button></div></fieldset>
 <section className="surface-layout"><div className="surface-views" data-view={layout} data-mode={mode}>
 <div className="surface-stage" ref={stage} hidden={layout==='atlas'} {...handlers}><canvas ref={view} width={size.w} height={size.h} aria-label="3D-модель тела"/><div className="stage-hint">3D · {tools[mode]}</div></div>
 <div className="surface-stage unwrapped" hidden={layout==='model'} {...handlers}><canvas aria-label="Развёртка поля" ref={flat} width={WIDTH} height={HEIGHT} style={{width:`min(100cqw, ${100*WIDTH/HEIGHT}cqh)`,transform:`translate(${flatCamera.x}px, ${flatCamera.y}px) scale(${flatCamera.zoom})`}}/><div className="stage-hint">2D · {mode==='orbit'?'Орбита доступна на фигуре':tools[mode]}</div></div></div>
 <aside className="surface-panel" aria-label="Инспектор поверхности"><nav aria-label="Группы инспектора" className="surface-groups">{groups.map(item=><button key={item} aria-pressed={item===group} onClick={()=>setGroup(item)}>{item}</button>)}</nav>
 <fieldset className="surface-settings" disabled={busy||loading||locked}><legend>{group}</legend>
 {group==='Документ'&&<section><h2>Атлас поверхности</h2><p>{WIDTH} × {HEIGHT} · {projection==='tone'?'Тон':'Трафарет'}</p><p>Общий документ с основной студией. Фигура построена по меркам и не является медицинским сканом.</p></section>}
 {group==='Цвет'&&<section>{palette}<p>Цвет линии и заливки сохраняется в цветном проекте .tfw.</p></section>}
 {group==='Режим'&&<div className="tool-row" role="group" aria-label="Режим жеста">{(Object.keys(tools) as Mode[]).map(key=><button key={key} aria-pressed={key===mode} disabled={key==='orbit'&&layout==='atlas'} onClick={()=>setMode(key)}>{tools[key]}</button>)}</div>}
 {group==='Зона'&&<><p data-zone-active={zone.active}>{zone.active?'Зона ограничивает кисть.':'Всё тело доступно для рисования.'} В режиме «Зона» закрасьте участки на развёртке или фигуре. Маска накапливается при смене ракурса и не входит в файл.</p>
 {mode==='zone'&&<label>Радиус зоны: {zoneRadius} текс.<input type="range" min="1" max="30" value={zoneRadius} onChange={e=>setZoneRadius(+e.target.value)}/></label>}
 <div className="tool-row"><button disabled={!zone.active} onClick={()=>{zone.clear();refresh(v=>v+1)}}>Снять ограничение</button><button onClick={()=>{zone.clear();fit();setMode('draw');refresh(v=>v+1)}}>Всё тело</button></div>
 </>}
 {group==='Камера'&&<><label>Область фокуса 3D<select value={camera.focus??''} onChange={e=>e.target.value?focus(e.target.value as Part):setCamera(front)}><option value="">Всё тело</option>{parts.map(p=><option key={p} value={p}>{names[p]}</option>)}</select></label>
 <div className="tool-row"><button disabled={!camera.focus} onClick={()=>camera.focus&&focus(camera.focus)}>Приблизить область</button><button onClick={fit}>Вся фигура</button><button disabled={layout==='atlas'} onClick={()=>setCamera(v=>({...v,yaw:v.yaw+Math.PI}))}>Разворот 180°</button></div>
 <label>Зум {(layout==='atlas'?flatCamera:camera).zoom.toFixed(1)}×<input type="range" min=".65" max="4" step=".05" value={(layout==='atlas'?flatCamera:camera).zoom} onChange={e=>{const zoom=+e.target.value;if(layout!=='atlas')setCamera(v=>({...v,zoom}));if(layout!=='model')setFlatCamera(v=>({...v,zoom}))}}/></label>
 </>}
 {group==='Кисть'&&<><label>Тонкая линия по участку (мм)<select value={fineMm??''} onChange={e=>setFineMm(e.target.value?+e.target.value:null)}><option value="">Вручную</option>{[.1,.15,.25,.35,.5,1].map(n=><option key={n} value={n}>{n} мм</option>)}</select></label><label>Радиус кисти: {radius} текс.<input type="range" min="2" max="10" value={radius} onChange={e=>{setFineMm(null);setRadius(+e.target.value)}}/></label><output>Оценка ширины — по масштабу в начале участка штриха. Тонкая линия ограничена геометрией атласа; субтексельная глобальная ширина не гарантируется.</output></>}
 {group==='Мерки'&&<section><h2>Форма и мерки</h2><p>Условные взрослые формы. Стартовые пропорции, не анатомический скан.</p><div className="tool-row" role="group" aria-label="Стартовая форма">{(['male','female'] as const).map(p=><button key={p} aria-pressed={body.preset===p} onClick={()=>choosePreset(p)}>{p==='male'?'Мужская':'Женская'}</button>)}</div>{!body.preset&&<small>Исходная форма · пресет не выбран.</small>}<p>{hasInk||canRedo?'Мерки зафиксированы, чтобы сохранить размещение рисунка.':'Введите мерки в сантиметрах до первого штриха.'}</p>
 <div className="surface-measures">{measurementsDefs.map(d=>{const value=draft[d.key],bad=!value.trim()||!validMeasurement(Number(value),d);return <label key={d.key}>{d.label}<input type="number" min={d.min} max={d.max} step={d.step} value={value} disabled={hasInk||canRedo} aria-invalid={bad} onChange={e=>{const text=e.target.value;setDraft(v=>({...v,[d.key]:text}));if(text.trim()&&validMeasurement(Number(text),d)&&Number(text)!==body[d.key]){const next={...body,[d.key]:Number(text)};setBody(next)}}}/>{bad&&<small>От {d.min} до {d.max} см, шаг {d.step}.</small>}</label>})}</div>
 {(hasInk||canRedo)&&<button onClick={reset}>Очистить поле для изменения мерок</button>}</section>}
 {group==='Файл'&&<section className="surface-files"><h2>Локальный проект</h2><p>Файл .tfs содержит только плотность и мерки, без пигмента. Для цветного проекта сохраните .tfw в основной студии. После завершённых действий поле и принятые мерки записываются локально. Поле и мерки общие с основной студией. Скачайте файл для независимой копии.</p><button disabled={invalid||atlasSize!==SMALL} onClick={()=>save(true)}>Сохранить проект .tfs</button><button disabled={atlasSize!==SMALL} onClick={()=>void restore()}>Открыть старую локальную копию Surface</button><label>Открыть проект .tfs<input disabled={atlasSize!==SMALL} type="file" accept=".tfs" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void restore(file)}}/></label><button onClick={()=>save(false)}>Скачать поле .tfd</button><p>.tfd содержит только плотность, без мерок.</p></section>}</fieldset></aside></section>
 <footer className="surface-status" role="status"><strong>SURFACE</strong> · {status}{notice&&` · ${notice}`}</footer>
 </main>
}
