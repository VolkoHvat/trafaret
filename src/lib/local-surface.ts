export const sections = {
  forearm: {name:'Предплечье', hint:'Два обхвата: у локтя и запястья. Длина — по коже между отметками.', mm:[270,165,245]},
  elbow: {name:'Локоть', hint:'Рука выпрямлена. Измерьте обхваты выше и ниже локтя и расстояние по наружной стороне.', mm:[280,250,120]},
  back: {name:'Спина', hint:'Измерьте ширину и высоту выбранного прямоугольника на спине.', mm:[340,0,430]},
  thigh: {name:'Бедро / нога', hint:'Обхват вверху, над коленом и на половине длины между метками.', mm:[560,400,400,490]},
  shin: {name:'Голень', hint:'Обхват ниже колена, над лодыжкой и ровно на половине длины по коже.', mm:[340,225,340,365]},
} as const
export type Section = keyof typeof sections
const tau = 2*Math.PI
export function makeSection(kind:Section, m:readonly number[]) {
  const flat=kind==='back', mid=kind==='thigh'||kind==='shin'
  if(m.length!==(mid?4:3)||m.some((n,i)=>!(flat&&i===1)&&(!Number.isFinite(n)||n<10||n>1500))) throw Error('Введите мерки от 10 до 1500 мм.')
  const length=m[2], rings=(flat?[0,0]:mid?[m[0],m[3],m[1]]:[m[0],m[1]]).map(c=>c/tau)
  const slant=length/(rings.length-1), bands=rings.slice(1).map((r,i)=>{
    const slope=(r-rings[i])/slant
    if(Math.abs(slope)>=1) throw Error('Для такой разницы обхватов длина слишком мала.')
    return {r:rings[i],slope,height:slant*Math.sqrt(1-slope*slope)}
  })
  const height=bands.reduce((sum,b)=>sum+b.height,0),width=flat?m[0]:2*Math.max(...rings)
  // Orthographic front intersection. Local chart: circumferential arc and distance along the central generator.
  function sample(x:number,y:number,yaw:number){
    if(y<0||y>height)return null
    if(flat){const c=Math.cos(yaw);if(c<1e-6||Math.abs(x/c)>width/2)return null;return {x:x/c,y:y-length/2,light:.95}}
    const i=bands.length===2&&y>bands[0].height?1:0, b=bands[i], s=(y-(i?bands[0].height:0))/b.height*slant,r=b.r+s*b.slope
    if(Math.abs(x)>r)return null
    const a=Math.asin(x/r), angle=Math.atan2(Math.sin(a+yaw),Math.cos(a+yaw))
    return {x:r*angle,y:i*slant+s-length/2,light:.63+.34*Math.cos(a+.35)}
  }
  return {width,height,sample}
}
export function tattooUV(x:number,y:number,dx:number,dy:number,cos:number,sin:number,widthMm:number){
  x-=dx;y-=dy
  return {u:.5+(x*cos+y*sin)/widthMm,v:.5+(-x*sin+y*cos)/widthMm}
}
