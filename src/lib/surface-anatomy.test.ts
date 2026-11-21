import { expect,it } from 'vitest'
import { anatomyMesh } from './surface-anatomy'
import { body,presets } from './surface-body'
import { scene,front,atlasSize,sceneBuffers } from './surface-model'

it.each(Object.values(presets))('one closed adult shell: $preset',s=>{
 const {vertices,faces}=anatomyMesh(s,body(s)),n=vertices.length,edges=new Map<number,number>(),root=Int32Array.from(vertices,(_,i)=>i)
 const group=(i:number)=>{while(i!==root[i])i=root[i]=root[root[i]];return i}
 for(let t=0;t<faces.length;t+=3)for(let j=0;j<3;j++){
 const a=faces[t+j],b=faces[t+(j+1)%3],key=Math.min(a,b)*n+Math.max(a,b);edges.set(key,(edges.get(key)??0)+1);root[group(a)]=group(b)
 }
 expect([...edges.values()].every(v=>v===2)).toBe(true);expect(new Set(root.map(group)).size).toBe(1)
})
it('picks exactly the visible atlas sample in both projections',()=>{
 for(const yaw of [0,.76]){const b=sceneBuffers(160,300),a=scene(160,300,presets.female,{...front,yaw},b,atlasSize,'body'),old=scene(160,300,presets.female,{...front,yaw});let different=0,seen=0,errors=0
 for(let i=0;i<a.ids.length;i++){const hit=a.hit(i%160,i/160|0);if((a.ids[i]<0)!==(old.ids[i]<0))different++;if(!hit){if(a.indices[i]!==-1)errors++;continue}seen++;if(Math.round(hit.x)+atlasSize.width*Math.round(hit.y)!==a.indices[i]||!Number.isFinite(b.depth[i]))errors++}
 expect(errors).toBe(0);expect(different).toBeGreaterThan(300);expect(seen).toBeGreaterThan(3000)}
})
