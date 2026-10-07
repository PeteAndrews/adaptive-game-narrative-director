export function needsRepair(speech){
 const s=speech.scores;
 return speech.confidence>=0.5&&s.clarification_needed>=0.65&&s.possible_misunderstanding>=0.6&&s.semantic_fit<0.5&&s.intentional_topic_change<0.6&&(s.humour<0.6||s.possible_misunderstanding>=0.85);
}
export function resolveContinuationQuestion(speech,text,previous){
 const followup=/^(?:and\s+then|then\s+what|what\s+next|and\s+after\s+that)[\s?.!…]*$/i.test(text.trim());
 if(!followup||!previous?.text?.trim()||previous.text.trim().endsWith('?')||needsRepair(speech)||speech.scores.possible_misunderstanding>=0.6||speech.scores.intentional_topic_change>=0.6)return speech;
 return {...speech,completion_status:'COMPLETE',unresolved_clause:'',scores:{...speech.scores,information_request:Math.max(speech.scores.information_request,0.8),explanation_request:0},continuationCorrection:{previous:speech.completion_status,reason:'Contextual follow-up asks the NPC to continue their preceding statement'}};
}

export function applyWorldFacts(previous,facts,provenance){
 const next=structuredClone(previous);
 for(const raw of facts){const fact={...raw,source:'authoritative world',provenance};const index=next.findIndex(f=>f.subject===fact.subject&&f.predicate===fact.predicate);if(index>=0)next[index]=fact;else next.push(fact);}
 return next;
}

export function assessWorldClaims(claims,facts){
 return claims.map(claim=>{
   const fact=facts.find(f=>f.subject===claim.subject&&f.predicate===claim.predicate);
   const status=!fact||fact.value==='unknown'?'PROVISIONAL':fact.value===claim.value?'CONFIRMED':'CONTRADICTED';
   return {...claim,status,authoritative:fact??null};
 });
}

export function playerWorldClaims(speech,text,policy,eventId){
 return speech.world_claims.filter(c=>c.confidence>=(policy.knowledgeThreshold??0.7)&&c.evidence.trim()&&text.includes(c.evidence)).map((c,i)=>({...c,id:`${eventId}:world-claim:${i}`,kind:'claim',source_actor:policy.playerActor,observer:policy.npcActor,provenance:eventId}));
}

export function callbackMemory(speech,text,policy,eventId,known){
 // Retain explicit nicknames or genuinely repeated shared labels, not every joke.
 if(needsRepair(speech)||speech.completion_status!=='COMPLETE')return [];
 const result=[];
 for(const c of speech.callbacks.slice(0,3)){
   const display=c.label.replaceAll('_',' '),start=c.evidence.toLowerCase().indexOf(display.toLowerCase());
   if(c.confidence<0.8||!c.label.trim()||c.label.length>60||!c.evidence.trim()||!text.includes(c.evidence)||start<0)continue;
   const label=c.evidence.slice(start,start+display.length);
   const old=known.find(k=>k.kind==='memory'&&k.observer===policy.npcActor&&k.predicate==='conversational_callback'&&k.value.toLowerCase()===label.toLowerCase()&&k.subject===c.target);
   if(old)continue;
   if(!c.explicit_nickname)continue;
   result.push({id:`${eventId}:callback:${result.length}`,kind:'memory',subject:c.target,predicate:'conversational_callback',value:label,observer:policy.npcActor,source_actor:policy.playerActor,confidence:c.confidence,evidence:c.evidence,provenance:eventId});
 }
 return result;
}

export function relevantCallbacks(p,speech,policy){
 const last=p.transcript.filter(e=>e.type==='input'||e.type==='utterance').slice(-8).map(e=>e.text).join(' ').toLowerCase();
 const targets=Object.values(speech.targets);
 const subjects=new Set((p.audit.worldClaims??[]).map(c=>c.subject));
 const inputs=p.transcript.filter(e=>e.type==='input'),window=policy.conversation?.callbackWindowTurns??12;
 return p.knowledge.filter(k=>{
  if(k.kind!=='memory'||k.observer!==policy.npcActor||k.predicate!=='conversational_callback')return false;
  const mentioned=last.includes(k.value.toLowerCase()),index=inputs.findIndex(e=>e.id===k.provenance);
  const recent=index<0||inputs.length-index<=window;
  return mentioned||(recent&&(targets.includes(k.subject)||subjects.has(k.subject)));
 }).slice(-3);
}
