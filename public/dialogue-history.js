// Map visible dialogue to complete commands, never half-applied turns.
export function dialogueBoundaries(session){
 const events=session.branches[session.active].events;
 const boundaries=[0];let adaptive=false;
 events.forEach((event,i)=>{
  if(['speech_interpretation','candidate','director_decision'].includes(event.type))adaptive=true;
  if(!adaptive||event.type==='command_completed'||(i===0&&event.type==='candidate')||event.type==='checkpoint')boundaries.push(i+1);
 });
 return Object.fromEntries(events.flatMap((event,i)=>['input','utterance'].includes(event.type)?[[event.id,{before:boundaries.findLast(n=>n<=i)??0,after:boundaries.find(n=>n>=i+1)??null}]]:[]));
}

// A scoped reading/diagnostic copy, not the internal replay/archive record.
export function exportCurrentTake(session,projection){
 return {
  format:'dialogue-laboratory-take',version:3,
  scene:{id:session.sceneId??null,name:session.pack.title},
  session:{id:session.pack.start,name:session.pack.nodes[session.pack.start]?.title??''},
  take:{id:session.id,branch:session.active,name:session.branches[session.active].name},
  npc:{attributes:structuredClone(projection.state),phase:projection.phase,
   activeFacade:projection.activeFacade,reaction:structuredClone(projection.reaction)},
  knowledge:{records:structuredClone(projection.knowledge??[]),inferences:structuredClone(projection.inferences??[]),
   world_claims:structuredClone(projection.worldClaims??[]),world_facts:structuredClone(projection.worldState??[]),
   events:session.branches[session.active].events.slice(0,session.cursor).filter(e=>['input','utterance','world','knowledge_committed','memory_committed','player_world_claims','player_model_delta','knowledge_proposed'].includes(e.type)).map(e=>selectFields(e,
    ['id','type','turnId','timestamp','sourceEvent','text','actor','channel','decisions','knowledge','assessments','facts','inferences','observations','evidence']))},
  diagnostics:exportDiagnostics(session),
  dialogue:projection.transcript.map(line=>({
   ...(line.id?{id:line.id}:{}),...(line.turnId?{turn_id:line.turnId}:{}),...(line.timestamp?{timestamp:line.timestamp}:{}),type:line.type,speaker:line.type==='input'?'Player':line.type==='utterance'?'NPC':'World',
   text:line.text??'',...(line.action?{action:line.action}:{})
  }))
 };
}

function selectFields(value,fields){
 return Object.fromEntries(fields.filter(key=>value?.[key]!==undefined).map(key=>[key,structuredClone(value[key])]));
}
function exportDiagnostics(session){
 return session.branches[session.active].events.slice(0,session.cursor).flatMap(event=>{
  const base={type:event.type,...(event.turnId?{turnId:event.turnId}:{})};
  if(event.type==='speech_interpretation')return [{...base,interpretation:selectFields(event.result,
   ['source','stance','confidence','scores','social_signals','targets','completion_status','unresolved_clause','topic','completionCorrection']),
   jev:event.result?.jev?selectFields(event.result.jev,['enabled','keyConfigured','liveAPI','decision','fallbackUsed']):null}];
  if(event.type==='state_delta')return [{...base,changes:structuredClone(event.changes)}];
  if(event.type==='director_decision')return [{...base,decision:selectFields(event.decision,
   ['responseMode','objectiveAdvancement','activeFacade','tactic','reason','lengthPolicy','beatProgression'])}];
  return [];
 });
}