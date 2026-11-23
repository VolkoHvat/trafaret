import { parts, type Part, type Settings, type body } from './surface-body'

type Shapes = ReturnType<typeof body>
type Lobe = {id:number;x:number;y:number;z:number;a:number;b:number;c:number;lean:number;sway:number;k:number}
// Compact smooth minimum of anatomical volumes, sampled in millimetres. The atlas
// labels do not participate in the distance field: a chart boundary isn't a crease.
function volumes(s:Settings, g:Shapes) {
 const lobes:Lobe[]=[], female=s.preset==='female'
 const add=(p:Part,x:number,y:number,z:number,a:number,b:number,c:number,k:number,lean=0,sway=0)=>lobes.push({id:parts.indexOf(p),x,y,z,a,b,c,k,lean,sway})
 const C=g.torso.rx,H=g.pelvis.rx,N=g.neck.rx,Q=g.head.rx,L=g.head.ry,head=g.head.cy
 const sh=g.neck.cy-g.neck.ry+14, waist=sh-s.torsoLength*10, groin=g.pelvis.cy-g.pelvis.ry, trunk=sh-waist, hip=waist-groin
 add('pelvis',0,groin+.58*hip,-5,H*.97,hip*.8,H*.67,25)
 add('torso',0,waist+.17*trunk,6,C*(female?.73:.79),trunk*.52,C*.57,30)
 add('torso',0,waist+.61*trunk,-5,C*.98,trunk*.43,C*.65,36)
 add('neck',0,(sh+head-L)/2,-7,N*.87,(head-L-sh)*.5+50,N*.85,24)
 add('head',0,head+.22*L,-4,Q*.94,L*.79,Q*1.08,13)
 add('head',0,head-.18*L,15,Q*.86,L*.76,Q*.86,10)
 add('head',0,head-.59*L,37,Q*.63,L*.40,Q*.53,9)
 add('head',0,head-.14*L,Q*.88,Q*.16,L*.29,Q*.22,5,0,-.32)
 add('head',0,head-.32*L,Q*.96,Q*.20,L*.10,Q*.19,5)
 add('head',0,head-.54*L,Q*.85,Q*.31,L*.075,Q*.095,4)
 for(const sign of [-1,1]){
 const pos=sign>0,U=pos?'upperArmLeft':'upperArm',F=pos?'forearmLeft':'forearm',D=pos?'handLeft':'hand',T=pos?'thigh':'thighRight',S=pos?'shin':'shinRight',P=pos?'foot':'footRight'
 const side=(p:Part,x:number,y:number,z:number,a:number,b:number,c:number,k:number,tilt=0,sway=0)=>add(p,sign*x,y,z,a,b,c,k,sign*tilt,sway)
 side('head',Q*.91,head-.04*L,-3,Q*.13,L*.21,Q*.18,4)
 side('head',Q*.40,head+.05*L,Q*.88,Q*.39,L*.09,Q*.13,5,-.12)
 side('head',Q*.47,head-.20*L,Q*.68,Q*.31,L*.16,Q*.20,8)
 const shoulder=C*(female?.95:1.06), arm=g[U].rx, fore=g[F].rx, upper=s.armLength*10, lower=s.forearmLength*10, hand=s.handLength*10
 const ax=shoulder+arm*.13, el=ax+upper*.22, wr=el+lower*.18, ey=sh-upper, wy=ey-lower
 side('torso',shoulder*.45,sh-18,-13,shoulder*.52,51,C*.37,33,-.7)
 side('torso',C*.45,sh-trunk*(female?.33:.29),C*(female?.40:.36),C*(female?.46:.54),trunk*(female?.185:.17),C*(female?.37:.25),female?33:40,-.10,female?-.23:-.08)
 side('torso',C*.47,sh-trunk*.32,-C*.43,C*.47,trunk*.25,C*.25,23)
 side('pelvis',H*.44,groin+hip*.45,-H*.34,H*.53,hip*.64,H*.43,18)
 side(U,ax,sh-57,-3,arm*1.08,88,arm*1.13,23,-.19)
 side(U,(ax+el)/2,sh-upper*.50,0,arm*.92,upper*.54,arm*1.03,20,-.22,.05)
 side(F,el,ey,-8,fore*.75,fore*1.1,fore*.80,14,-.20)
 side(F,el+lower*.07,ey-lower*.37,0,fore,lower*.48,fore*.93,16,-.18,-.11)
 side(F,wr-lower*.025,wy+lower*.17,9,fore*.63,lower*.30,fore*.53,13,-.18)
 const palm=s.handWidth*5
 side(D,wr+6,wy-hand*.32,11,palm*.76,hand*.43,palm*.56,13,-.09)
 for(let j=0;j<4;j++)side(D,wr+9+(j-1.4)*palm*.32,wy-hand*(.68-.025*Math.abs(j-1)),14+(1.5-j)*palm*.23,palm*.20,hand*(.31-.037*Math.abs(j-1)),palm*.22,3,-.06)
 side(D,wr-palm*.57,wy-hand*.40,20,palm*.26,hand*.23,palm*.27,6,.20)
 const leg=g[T].rx,calf=g[S].rx,knee=g[T].cy-g[T].ry,ankle=g[S].cy-g[S].ry,th=groin-knee,shin=knee-ankle
 const tx=Math.max(H*.53,leg*.92),kx=tx+16,ank=kx+13
 side(T,tx,groin-.28*th,0,leg*1.03,th*.71,leg*1.10,27,-.04,.04)
 side(T,kx-4,knee+.23*th,4,leg*.72,th*.37,leg*.76,17,-.04)
 side(S,kx,knee+4,12,calf*.81,calf*1.13,calf*.85,14)
 side(S,kx+5,knee-.36*shin,-9,calf,shin*.46,calf*1.08,18,-.035,.02)
 side(S,ank-2,ankle+.23*shin,-3,calf*.55,shin*.30,calf*.61,12,-.035)
 const foot=s.footLength*10, fw=s.footWidth*5
 side(P,ank,49,foot*.06,fw*.70,48,foot*.29,16,0,-.34)
 side(P,ank+3,29,foot*.31,fw,28,foot*.48,15)
 }
 return lobes
}

type Vertex={x:number;y:number;z:number;light:number;id:number}
export function anatomyMesh(s:Settings,shapes:Shapes){
 const lobes=volumes(s,shapes), step=8, pad=6*step
 const extent=(a:Lobe)=>[a.a+Math.abs(a.lean)*a.b,a.b,a.c+Math.abs(a.sway)*a.b]
 const bounds=(axis:0|1|2,sign:number)=>sign*Math.max(...lobes.map(l=>sign*[l.x,l.y,l.z][axis]+extent(l)[axis]+pad))
 const x0=bounds(0,-1),y0=bounds(1,-1),z0=bounds(2,-1), nx=Math.ceil((bounds(0,1)-x0)/step)+1,ny=Math.ceil((bounds(1,1)-y0)/step)+1,nz=Math.ceil((bounds(2,1)-z0)/step)+1, plane=nx*ny,n=plane*nz
 const d=new Float32Array(n).fill(pad),owner=new Uint8Array(n)
 for(const l of lobes){
 const [ex,ey,ez]=extent(l),ia=Math.max(0,Math.floor((l.x-ex-pad-x0)/step)),ib=Math.min(nx-1,Math.ceil((l.x+ex+pad-x0)/step))
 const ja=Math.max(0,Math.floor((l.y-ey-pad-y0)/step)),jb=Math.min(ny-1,Math.ceil((l.y+ey+pad-y0)/step))
 const ka=Math.max(0,Math.floor((l.z-ez-pad-z0)/step)),kb=Math.min(nz-1,Math.ceil((l.z+ez+pad-z0)/step))
 for(let k=ka;k<=kb;k++)for(let j=ja;j<=jb;j++){
 const y=y0+j*step-l.y, y2=(y/l.b)**2,z2=((z0+k*step-l.z-l.sway*y)/l.c)**2
 for(let i=ia;i<=ib;i++){
 const idx=i+j*nx+k*plane,x2=((x0+i*step-l.x-l.lean*y)/l.a)**2,r=Math.sqrt(x2+y2+z2)
 const dist=r*(r-1)/Math.sqrt(x2/l.a**2+y2/l.b**2+z2/l.c**2+1e-10),old=d[idx],overlap=Math.max(0,l.k-Math.abs(dist-old))
 d[idx]=Math.min(old,dist)-overlap*overlap/(4*l.k);if(dist<old)owner[idx]=l.id
 }}}
 const vertices:Vertex[]=[],faces:number[]=[],edges=new Map<number,number>()
 function edge(a:number,b:number){
 const key=Math.min(a,b)*n+Math.max(a,b),cached=edges.get(key);if(cached!==undefined)return cached
 const t=d[a]/(d[a]-d[b]),mix=(x:number,y:number)=>x+(y-x)*t
 const grad=(off:number)=>mix(d[a+off]-d[a-off],d[b+off]-d[b-off]),gx=grad(1),gy=grad(nx),gz=grad(plane)
 const v={x:x0+step*mix(a%nx,b%nx),y:y0+step*mix(Math.floor(a/nx)%ny,Math.floor(b/nx)%ny),z:z0+step*mix(Math.floor(a/plane),Math.floor(b/plane)),light:110+52*(-.42*gx+.48*gy+.75*gz)/(Math.hypot(gx,gy,gz)||1),id:owner[t<.5?a:b]}
 const idx=vertices.push(v)-1;edges.set(key,idx);return idx
 }
 // Consistent body diagonal on every cell; edge intersections are shared vertices.
 const offsets=[0,1,nx,nx+1,plane,plane+1,plane+nx,plane+nx+1],tetra=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]]
 for(let k=1;k<nz-2;k++)for(let j=1;j<ny-2;j++)for(let i=1;i<nx-2;i++){
 const base=i+j*nx+k*plane,inside=d[base]<0;if(offsets.every(o=>(d[base+o]<0)===inside))continue
 for(const tet of tetra){const a:number[]=[],b:number[]=[];for(const o of tet){const q=base+offsets[o];(d[q]<0?a:b).push(q)}if(!a.length||!b.length)continue
 if(a.length===2){const A=edge(a[0],b[0]),B=edge(a[0],b[1]),C=edge(a[1],b[0]),D=edge(a[1],b[1]);faces.push(A,B,C,C,B,D)}else{const [single,three]=a.length===1?[a,b]:[b,a];faces.push(...three.map(v=>edge(single[0],v)))}
 }}return {vertices,faces}
}

import type { sceneBuffers } from './surface-model'
import { islandsFor, tau } from './surface-body'
import type { Size } from './field-size'

function texturedMesh(s:Settings,g:Shapes){
 const mesh=anatomyMesh(s,g),vol=volumes(s,g)
 const charts=parts.map((_,id)=>{
 const v=vol.filter(l=>l.id===id),lo=Math.min(...v.map(l=>l.y-l.b)),hi=Math.max(...v.map(l=>l.y+l.b))
 return {lo,hi,vol:v}
 })
 // Sample chart centreline from the generating cross sections, not a screen-space
 // projection. Compute angular UV after interpolation to avoid wrapping across the back.
 const verts=mesh.vertices.map(v=>{const c=charts[v.id];let w=0,x=0,z=0,a=0,b=0
 for(const l of c.vol){const dy=v.y-l.y,weight=Math.max(.001,1-(dy/l.b)**2)*l.a*l.c;w+=weight;x+=(l.x+l.lean*dy)*weight;z+=(l.z+l.sway*dy)*weight;a+=l.a*weight;b+=l.c*weight}
 return {...v,ux:(w*v.x-x)/a,uz:(w*v.z-z)/b,v:Math.acos(Math.max(-1,Math.min(1,2*(v.y-c.lo)/(c.hi-c.lo)-1)))/Math.PI}
 });return {verts,faces:mesh.faces}
}
let cache:{key:string;mesh:ReturnType<typeof texturedMesh>}|undefined
export function anatomyMetric(s:Settings,g:Shapes,id:number,u:number,v:number,w:number,rows:number){
 const key=JSON.stringify(s);if(cache?.key!==key)cache={key,mesh:texturedMesh(s,g)}
 const {verts,faces}=cache.mesh, angle=(u-.5)*tau, cs=Math.cos(angle),sn=Math.sin(angle)
 for(let t=0;t<faces.length;t+=3){
  const a=verts[faces[t]],b=verts[faces[t+1]],c=verts[faces[t+2]]
  if(a.id!==id||b.id!==id||c.id!==id||v<Math.min(a.v,b.v,c.v)||v>Math.max(a.v,b.v,c.v))continue
  const cross=(p:typeof a)=>p.ux*cs-p.uz*sn, k=cross(a), k1=cross(b)-k,k2=cross(c)-k,h1=b.v-a.v,h2=c.v-a.v,det=k1*h2-k2*h1
  if(Math.abs(det)<1e-10)continue
  const q=(-k*h2-k2*(v-a.v))/det,r=(k1*(v-a.v)+k*h1)/det
  if(Math.min(q,r,1-q-r)<-1e-6)continue
  const radial=(a.ux+q*(b.ux-a.ux)+r*(c.ux-a.ux))*sn+(a.uz+q*(b.uz-a.uz)+r*(c.uz-a.uz))*cs
  if(radial<=0)continue
  const length=(i:number,j:number)=>Math.hypot(...(['x','y','z'] as const).map(axis=>i*(b[axis]-a[axis])+j*(c[axis]-a[axis])))
  return {u:length(h2,-h1)*radial*tau/(Math.abs(det)*w),v:length(-k2,k1)/(Math.abs(det)*rows)}
 }
 return null
}
export function drawAnatomy(w:number,h:number,s:Settings,g:Shapes,atlas:Size,buffers:ReturnType<typeof sceneBuffers>,project:(x:number,y:number,z:number)=>{x:number;y:number;z:number}){
 const key=JSON.stringify(s);if(cache?.key!==key)cache={key,mesh:texturedMesh(s,g)}
 const {verts,faces}=cache.mesh,p=verts.map(v=>project(v.x,v.y,v.z)),{depth,ids,indices,uv,shade}=buffers,islands=parts.map(part=>islandsFor(atlas)[part])
 for(let t=0;t<faces.length;t+=3){const i=faces[t],j=faces[t+1],k=faces[t+2],a=p[i],b=p[j],c=p[k],A=verts[i],B=verts[j],C=verts[k]
 const dx=b.x-a.x,dy=b.y-a.y,ex=c.x-a.x,ey=c.y-a.y,det=dx*ey-dy*ex;if(Math.abs(det)<1e-9)continue
 const left=Math.max(0,Math.ceil(Math.min(a.x,b.x,c.x)-.5)),right=Math.min(w-1,Math.floor(Math.max(a.x,b.x,c.x)-.5)),top=Math.max(0,Math.ceil(Math.min(a.y,b.y,c.y)-.5)),bottom=Math.min(h-1,Math.floor(Math.max(a.y,b.y,c.y)-.5))
 for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
 const px=x+.5-a.x,py=y+.5-a.y,q=(px*ey-py*ex)/det,r=(dx*py-dy*px)/det,f=1-q-r;if(Math.min(f,q,r)<-1e-8)continue
 const idx=y*w+x,z=f*a.z+q*b.z+r*c.z;if(z<=depth[idx])continue
 const id=(f>=q&&f>=r?A:q>=r?B:C).id,island=islands[id],fa=A.id===id?f:0,fb=B.id===id?q:0,fc=C.id===id?r:0
 const u=(.5+Math.atan2(fa*A.ux+fb*B.ux+fc*C.ux,fa*A.uz+fb*B.uz+fc*C.uz)/tau)%1,v=(fa*A.v+fb*B.v+fc*C.v)/(fa+fb+fc)
 depth[idx]=z;ids[idx]=id;shade[idx]=Math.round(f*A.light+q*B.light+r*C.light);uv[2*idx]=u;uv[2*idx+1]=v;indices[idx]=Math.round(island.x+uv[2*idx]*island.w)+atlas.width*Math.round(island.y+uv[2*idx+1]*island.rows)
 }}
}
