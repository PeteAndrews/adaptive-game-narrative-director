// Retrieval/use timing only: disclosure storage, knowledge and events stay intact.
export function disclosureTiming(knowledge,p,policy){
 const inputs=p.transcript.filter(e=>e.type==='input');
 const current=inputs.length-1;
 const source=inputs.findIndex(e=>e.id===knowledge.provenance);
 const personal=knowledge.kind!=='memory'&&knowledge.source_actor===policy.playerActor;
 const age=source<0?null:current-source;
 const delay=policy.conversation?.disclosureDelayTurns??2;
 return {personal,age,deferred:personal&&age!==null&&age<delay};
}
export function disclosureRelevant(knowledge,p,speech=p.audit?.speech){
 const latest=p.transcript.findLast(e=>e.type==='input')?.text??'';
 const tokens=new Set((latest+' '+(speech?.topic??'')).toLowerCase().match(/[\p{L}\p{N}_]{4,}/gu)??[]);
 return `${knowledge.predicate} ${knowledge.value}`.toLowerCase().split(/[\s_]+/).some(t=>tokens.has(t));
}
export function usableKnowledge(knowledge,p,policy,speech){
 const timing=disclosureTiming(knowledge,p,policy);
 return !timing.deferred&&(!timing.personal||disclosureRelevant(knowledge,p,speech));
}
