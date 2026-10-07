import {validatePack} from './index.mjs';
export function sceneForTake(take,library){
 if(take.sceneId)return Object.hasOwn(library.scenes,take.sceneId)?take.sceneId:null;
 const matches=Object.values(library.scenes).filter(s=>s.pack.id===take.pack.id&&s.pack.title===take.pack.title&&Object.hasOwn(s.pack.nodes,take.pack.start));
 return matches.length===1?matches[0].id:null;
}
export function removeScene(library,takes,id){
 if(!Object.hasOwn(library.scenes,id))throw Error('Unknown saved scene');
 const next=structuredClone(library),remaining={...takes};
 for(const take of Object.values(takes))if(sceneForTake(take,library)===id)delete remaining[take.id];
 delete next.scenes[id];if(next.activeSceneId===id)next.activeSceneId=Object.keys(next.scenes)[0]??null;
 return {library:next,takes:remaining};
}
export function removeSection(library,takes,sceneId,nodeId){
 if(!Object.hasOwn(library.scenes,sceneId)||!Object.hasOwn(library.scenes[sceneId].pack.nodes,nodeId))throw Error('Unknown authored session');
 const next=structuredClone(library),p=next.scenes[sceneId].pack,remaining={...takes};
 delete p.nodes[nodeId];const first=Object.keys(p.nodes)[0]??'';if(p.start===nodeId)p.start=first;
 for(const node of Object.values(p.nodes)){if(node.fallback===nodeId)node.fallback=first;node.choices=node.choices.filter(c=>c.target!==nodeId);}
 p.speechRules=p.speechRules.filter(r=>r.target!==nodeId);
 for(const [event,target] of Object.entries(p.worldEvents))if(target===nodeId)delete p.worldEvents[event];
 for(const take of Object.values(takes))if(sceneForTake(take,library)===sceneId&&take.pack.start===nodeId)delete remaining[take.id];
 validatePack(p,{allowEmpty:true});next.scenes[sceneId].updatedAt=new Date().toISOString();
 return {library:next,takes:remaining};
}
