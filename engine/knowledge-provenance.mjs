import {createHash} from 'node:crypto';
export const METHODS=['authored','disclosure','observation','inference'];
export const ATTITUDES=['heard','accepted','suspected','rejected','unknown'];
const clone=x=>structuredClone(x);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0,24);
export function authoredKnowledge(s,items=s.pack.knowledge,category='knowledge'){
 return items.map(raw=>{
  const id=raw.id??`authored:${hash([s.pack.id,s.pack.start,category,raw.observer,raw.subject,raw.predicate,raw.value,raw.provenance??null])}`;
  return {...clone(raw),id,acquisition:raw.acquisition??{
   method:'authored',attitude:category==='world'?'accepted':'unknown',scene_id:s.sceneId??null,session_id:s.pack.start,take_id:s.id,
   branch_id:'main',turn_id:null,source_event_id:null,knowledge_commit_event_id:null,timestamp:s.createdAt??null,
   evidence:raw.evidence??null,extractor:'authored/imported initial knowledge',
   authored_source_id:id,source_label:raw.provenance??'authored setup',supporting_event_ids:[]
  }};
 });
}
export function normalizeItem(s,event,raw,{method,attitude,branchId=null,force=false}={}){
 if(raw.acquisition&&!force)return clone(raw);
 const events=s.branches[s.active].events;
 const sourceId=event.sourceEvent??(typeof raw.provenance==='string'&&events.some(e=>e.id===raw.provenance)?raw.provenance:event.id);
 const source=events.find(e=>e.id===sourceId)??event;
 const analysis=events.findLast(e=>e.sourceEvent===sourceId&&['speech_interpretation','npc_interpretation'].includes(e.type));
 method??=raw.kind==='contradiction'||raw.predicate==='remembered_slight'?'inference':event.type==='world'?'observation':'disclosure';
 attitude??=method==='disclosure'?'heard':method==='inference'?'suspected':'accepted';
 return {...clone(raw),id:raw.id??`${event.id}:${hash([raw.subject,raw.predicate,raw.value,raw.observer])}`,
  provenance:raw.provenance??sourceId,acquisition:{method,attitude,
   scene_id:s.sceneId??null,session_id:s.pack.start,take_id:s.id,branch_id:branchId,
   turn_id:event.turnId??source.turnId??null,source_event_id:sourceId,knowledge_commit_event_id:event.id,
   timestamp:event.timestamp??null,evidence:raw.evidence??source.text??null,
   extractor:method==='inference'?'deterministic policy/player-model v1':analysis?.result?.source??(method==='observation'?'authored world event':'legacy/scripted source'),
   supporting_event_ids:[sourceId,...(analysis?[analysis.id]:[]),...events.filter(e=>e.type==='action_interpretation'&&e.turnId===event.turnId).map(e=>e.id)],source_label:raw.provenance??null
  }};
}
export function normalizeEvent(s,event,{branchId=null,force=false}={}){
 const result=clone(event);
 if(result.knowledge)result.knowledge=result.knowledge.map(k=>normalizeItem(s,event,k,{branchId,force}));
 if(result.assessments)result.assessments=result.assessments.map(k=>normalizeItem(s,event,k,{method:'disclosure',attitude:'heard',branchId,force}));
 if(result.facts)result.facts=result.facts.map(k=>normalizeItem(s,event,k,{method:'observation',attitude:'accepted',branchId,force}));
 if(result.type==='player_model_delta'){
  const source=s.branches[s.active].events.findLast(e=>e.type==='input'&&e.turnId===event.turnId);
  const speech=s.branches[s.active].events.findLast(e=>e.type==='speech_interpretation'&&e.turnId===event.turnId);
  result.inferences=result.inferences??Object.entries(result.observations??{}).map(([predicate,value])=>normalizeItem(s,{...event,sourceEvent:source?.id},
   {id:`${event.id}:inference:${predicate}`,kind:'suspicion',subject:s.pack.behaviour?.playerActor??'player',predicate,value,
    observer:s.pack.behaviour?.npcActor??'npc',source_actor:source?s.pack.behaviour?.playerActor??'player':null,
    confidence:null,extraction_confidence:speech?.result?.confidence??null,evidence:source?.text??null},
   {method:'inference',attitude:'suspected',branchId,force}));
  if(result.evidence?.utteranceId)for(const k of result.inferences)if(!k.acquisition.supporting_event_ids.includes(result.evidence.utteranceId))k.acquisition.supporting_event_ids.push(result.evidence.utteranceId);
 }
 return result;
}

export function validateAcquisition(a){
 if(!a||!METHODS.includes(a.method)||!ATTITUDES.includes(a.attitude))throw Error('Invalid knowledge acquisition method or attitude');
 for(const key of ['scene_id','session_id','take_id','branch_id','turn_id','source_event_id','knowledge_commit_event_id','timestamp','evidence','extractor'])if(a[key]!==null&&typeof a[key]!=='string')throw Error('Invalid knowledge acquisition '+key);
 if(a.timestamp!==null&&!Number.isFinite(Date.parse(a.timestamp)))throw Error('Invalid knowledge acquisition timestamp');
 if(!Array.isArray(a.supporting_event_ids)||a.supporting_event_ids.some(id=>typeof id!=='string'))throw Error('Invalid knowledge acquisition supporting events');
}
