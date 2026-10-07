import {needsRepair,playerWorldClaims,assessWorldClaims,callbackMemory,resolveContinuationQuestion} from './conversation-continuity.mjs';
import {salientMemory} from './response-mode.mjs';
import {updateReaction,reactionStateChanges} from './reaction.mjs';
import {JevInterpreter} from './jev.mjs';
import {randomUUID} from 'node:crypto';
import {append,command,project} from './index.mjs';
import {LLMInteractionInterpreter,adjudicate,neutral,validateInterpretation,npcDirectedSpeech,supportedProposals,reconcileTargets,authoredWorldClaims,resolveActionSpeech} from './interpretation.mjs';
import {actionInterpretation,evaluate,stateChanges,playerModelUpdate,selectDirection} from './behaviour.mjs';
import {validateLengthOverride} from './length-policy.mjs';

function recordKnowledge(s,proposals,text,actor,observer,eventId,turnId,excluded=[]){
  const p=project(s),policy=s.pack.behaviour;
  const result=adjudicate(proposals,text,actor,observer,eventId,p.knowledge,policy.knowledgeThreshold);
  for(const proposal of excluded)result.decisions.push({proposal:{...proposal,provenance:eventId,observer,source_actor:actor},status:'rejected',reason:'Unresolved-clause evidence, transient interaction signal or humorous speculation'});
  append(s,{type:'knowledge_proposed',actor,channel:actor===policy.playerActor?'player':'npc',turnId,sourceEvent:eventId,decisions:result.decisions});
  const contradictions=[];
  for(const k of result.committed)if(policy.contradictionPredicates?.includes(k.predicate))for(const old of p.knowledge)if(old.observer===observer&&old.subject===k.subject&&old.predicate===k.predicate&&old.value!==k.value){contradictions.push({id:randomUUID(),subject:k.id,predicate:'contradicts',value:old.id??old.provenance,kind:'contradiction',confidence:Math.min(k.confidence,old.confidence),observer,source_actor:actor,evidence:k.evidence,provenance:eventId});}
  append(s,{type:'knowledge_committed',actor,turnId,sourceEvent:eventId,knowledge:[...result.committed,...contradictions]});
}
export async function acceptFinal(s,interpreter){
  if(!s.candidate?.text.trim())throw Error('No candidate to accept');
  const candidate=structuredClone(s.candidate),turnId=candidate.turnId??randomUUID();
  // Record final words before interpretation. Both are persisted atomically by the server.
  const final=append(s,{type:'utterance',...candidate,knowledge:[],turnId});s.candidate=null;
  const policy=s.pack.behaviour,p=project(s);
  const analysis=await interpreter.disclosures(final.text,p.knowledge.filter(k=>k.observer===policy.playerActor),policy);
  if(analysis.source==='keyword fallback')for(const r of policy.npcFallbackRules??[]){const match=final.text.match(new RegExp(r.pattern,'i'));if(match)analysis.proposals.push({subject:r.subject,predicate:r.predicate,value:r.value,kind:r.kind,confidence:r.confidence,evidence:match[0]});}
  append(s,{type:'npc_interpretation',turnId,sourceEvent:final.id,result:analysis});
  recordKnowledge(s,[...analysis.proposals,...(candidate.knowledge??[])],final.text,policy.npcActor,policy.playerActor,final.id,turnId);
}
function persistCandidate(s){append(s,{type:'candidate',turnId:s.candidate.turnId,candidate:structuredClone(s.candidate)});}
function previousUtterance(p){return p.transcript.findLast(e=>e.type==='utterance');}

export async function adaptiveCommand(session,cmd,config,generate){
  const s=structuredClone(session),policy=s.pack.behaviour;
  if(cmd.requestId&&s.branches[s.active].events.slice(0,s.cursor).some(e=>e.type==='command_completed'&&e.requestId===cmd.requestId))return s;
  const interpreter=config.interpreter??new JevInterpreter(config,new LLMInteractionInterpreter(config));
  if(['seek','checkout','branch','checkpoint'].includes(cmd.type)){
    if(cmd.type==='seek'){
      const target=Number(cmd.cursor),events=s.branches[s.active].events;
      if(!Number.isInteger(target)||target<0||target>events.length)throw Error('Invalid timeline position');
      // Expose complete commands as navigable history, never half-applied player turns.
      let boundary=0,adaptiveStarted=false;
      for(let i=0;i<target;i++){
        const e=events[i];if(['speech_interpretation','candidate','director_decision'].includes(e.type))adaptiveStarted=true;
        if(!adaptiveStarted||e.type==='command_completed'||(i===0&&e.type==='candidate')||e.type==='checkpoint')boundary=i+1;
      }
      cmd={...cmd,cursor:boundary};
    }
    command(s,cmd);if(['seek','checkout'].includes(cmd.type))s.candidate=project(s).pendingCandidate;return s;
  }
  if(s.cursor!==s.branches[s.active].events.length)throw Error('Create a branch before changing the past.');
  if(cmd.type==='draft'||cmd.type==='lock'){
    command(s,cmd);if(s.candidate)persistCandidate(s);
  }else if(cmd.type==='accept')await acceptFinal(s,interpreter);
  else if(['turn','world','retry'].includes(cmd.type)){
    if(cmd.type==='retry'){
      if(s.candidate?.locked)throw Error('Draft is locked');
      if(!s.candidate)throw Error('No candidate to regenerate');
      // Preserve decision and turn identity; regeneration never reevaluates player input.
    }else{
      if(s.candidate)throw Error('Commit the current draft first.');
      const turnId=randomUUID(),p=project(s);let speech=neutral('no speech');
      if(cmd.type==='turn'){
        validateLengthOverride(cmd.lengthOverride??'AUTO');
        const text=String(cmd.text??'').trim(),choice=s.pack.nodes[p.node].choices.find(c=>c.id===cmd.choice);
        if(cmd.choice&&!choice)throw Error('This action is not available here');
        if(!text&&!choice)throw Error('Write a response or choose an action');
        const input=append(s,{type:'input',turnId,text,action:choice?.label??null,actionId:choice?.id??null});
        speech=reconcileTargets(validateInterpretation(await interpreter.interpret(text,p.transcript.slice(-12),{...policy,knownInformation:p.knowledge.filter(k=>k.observer===policy.npcActor)})),policy);
        // Preserve an explicit authored world-claim match even if an interpreter
        // drops a claim because the world contradicts it. A false claim is still
        // a claim; this cannot update authoritative facts.
        for(const c of authoredWorldClaims(text,policy))if(!speech.world_claims.some(old=>old.subject===c.subject&&old.predicate===c.predicate&&old.value===c.value))speech.world_claims.push(c);
        speech=resolveActionSpeech(speech,text,choice?.id,policy);
        speech=resolveContinuationQuestion(speech,text,previousUtterance(p));
        speech.source??='fixture/mock';
        const directed=npcDirectedSpeech(speech,policy),action=actionInterpretation(choice,policy),evaluation=evaluate(directed,action);
        append(s,{type:'speech_interpretation',turnId,sourceEvent:input.id,result:speech});
        append(s,{type:'action_interpretation',turnId,sourceEvent:input.id,result:action});
        append(s,{type:'interaction_evaluated',turnId,result:evaluation});
        const reaction=updateReaction(p.reaction,directed,text,policy.reaction);
        append(s,{type:'reaction_updated',turnId,reaction});
        append(s,{type:'state_delta',turnId,changes:reactionStateChanges(p.state,stateChanges(p.state,directed,action,policy,p.phase),reaction,policy.reaction,directed,action)});
        const model=playerModelUpdate(p.playerModel,directed,action,evaluation,previousUtterance(p),policy);
        append(s,{type:'player_model_delta',turnId,...model});
        const supported=needsRepair(speech)?[]:supportedProposals(speech,text);
        recordKnowledge(s,supported,text,policy.playerActor,policy.npcActor,input.id,turnId,speech.proposals.filter(p=>!supported.includes(p)));
        const claims=playerWorldClaims(speech,text,policy,input.id);
        append(s,{type:'player_world_claims',turnId,sourceEvent:input.id,assessments:assessWorldClaims(claims,p.worldState)});
        const memory=[...salientMemory(directed,text,policy,input.id,p.knowledge),...callbackMemory(speech,text,policy,input.id,p.knowledge)];
        append(s,{type:'memory_committed',turnId,sourceEvent:input.id,knowledge:memory});
      }else{
        if(!s.pack.worldEvents[cmd.event])throw Error('Unknown world event');
        append(s,{type:'world',turnId,text:cmd.event,temporaryModifiers:s.pack.worldModifiers?.[cmd.event]??{},facts:s.pack.worldFacts?.[cmd.event]??[]});
      }
      const now=project(s),decision=selectDirection(now,npcDirectedSpeech(speech,policy),policy);
      append(s,{type:'director_decision',turnId,decision});
      s.candidate={node:now.node,text:'',...decision,lengthOverride:cmd.type==='turn'?(cmd.lengthOverride??'AUTO'):'AUTO',direction:'',locked:false,knowledge:[],turnId};
    }
    s.candidate.text=await generate(s,config);s.candidate.provider='openai';s.candidate.knowledge=[];persistCandidate(s);
    if(cmd.autoAccept===true)await acceptFinal(s,interpreter);
  }else throw Error('Unknown command');
  append(s,{type:'command_completed',requestId:cmd.requestId??randomUUID(),command:cmd.type});
  return s;
}
