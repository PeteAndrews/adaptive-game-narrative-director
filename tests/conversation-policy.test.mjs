import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project,validatePack} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {selectDirection} from '../engine/behaviour.mjs';
import {neutral,keywordInterpret} from '../engine/interpretation.mjs';
import {conversationPolicy} from '../engine/conversation-policy.mjs';
import {dialogueRequest,generationContext,generateReply} from '../engine/dialogue.mjs';
import {relevantCallbacks} from '../engine/conversation-continuity.mjs';
const source=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const speech=(scores={},extra={})=>({...neutral(),confidence:0.95,scores:{...neutral().scores,...scores},...extra});
function actor(){
 const pack=structuredClone(source);pack.id='archive-test';pack.scenario='An archivist discussing a catalogue';pack.characterPrompt='A reserved archivist with dry humour.';
 pack.behaviour={npcActor:'archivist',playerActor:'visitor',initialPhase:'WORKING',initialFacade:'RESERVED',defaults:{rapport:0.3,irritation:0.1},decay:{},effects:{alignment_with_npc:{rapport:0.1},disagreement:{irritation:0.1}},phases:{WORKING:{tactics:['CHECK_INDEX','DISENGAGE'],presentation:'Reserved'}},tactics:{CHECK_INDEX:{base:1,objective:'SECRET_INTERNAL_STATUS_MOTIVE',behaviour:'Offer a small correction.'},DISENGAGE:{base:0.5,objective:'PRIVATE_OBJECTIVE',behaviour:'Become less engaged.'}},conversation:{modeFacades:{REACT:'WARM',REINFORCE:'WARM'},facadeBehaviours:{WARM:'Easy shorthand.',RESERVED:'Composed, restrained.'},stateStyles:[{state:'irritation',above:0.5,behaviour:'Terse replies; little patience for repetition.'}],justificationWeights:{DEFLECTION:1}}};
 pack.initialState={rapport:0.3,irritation:0.1};pack.knowledge=[];return pack;
}
function start(pack=actor()){const s=createSession(pack);s.candidate.text='Have you used this catalogue before?';command(s,{type:'accept'});return s;}
function decide(x,pack=actor()){const s=start(pack),p=project(s);p.audit.action={outcome:'NO_RELEVANT_ACTION'};return selectDirection(p,x,pack.behaviour);}
test('ordinary joke has conversational economy and inert plot/tactic without instructor facade',()=>{
 const d=decide(speech({humour:0.9}));assert.equal(d.responseMode,'REACT');assert.equal(d.tactic,null);assert.equal(d.objectiveAdvancement,'NONE');assert.equal(d.explanation_need,'NONE');assert.equal(d.conversational_work,'joke');assert.equal(d.activeFacade,'WARM');assert.equal(d.justification_style,null);assert.ok(d.rhythm.maxWords<=20);
});
test('explicit why permits more explanation; information needs only a bounded answer',()=>{
 const ordinary=decide(speech()),why=decide(speech({explanation_request:0.9})),info=decide(speech({information_request:0.9}));
 assert.equal(ordinary.explanation_need,'NONE');assert.equal(why.explanation_need,'MODERATE');assert.equal(why.conversational_work,'answer');assert.ok(why.rhythm.maxWords>ordinary.rhythm.maxWords);assert.equal(info.explanation_need,'LOW');assert.equal(why.objectiveAdvancement,'NONE');assert.equal(keywordInterpret('Why is that?').scores.explanation_request,0.8);
});
test('contradiction allows configured imperfect justification without solving hypocrisy',()=>{
 const pack=actor(),d=decide(speech({contradiction_challenge:0.9}),pack);assert.equal(d.justification_style,'DEFLECTION');assert.equal(d.explanation_need,'LOW');assert.match(d.expression.justification_behaviour,/without.*resolving/);
 pack.behaviour.conversation.justificationWeights={SELF_EXCEPTION:1};assert.equal(decide(speech({contradiction_challenge:0.9}),pack).justification_style,'SELF_EXCEPTION');
 delete pack.behaviour.conversation.justificationWeights;assert.equal(decide(speech({contradiction_challenge:0.9}),pack).justification_style,null);
});
test('ambiguity repairs or probes without inventing a rationale or tactic',()=>{
 const repair=decide(speech({semantic_fit:0.1,possible_misunderstanding:0.9,clarification_needed:0.9,explanation_request:0.9}));assert.equal(repair.responseMode,'REPAIR');assert.equal(repair.explanation_need,'NONE');assert.equal(repair.justification_style,null);assert.equal(repair.tactic,null);
 const probe=decide(speech({}, {completion_status:'AMBIGUOUS',unresolved_clause:'Which one?'}));assert.equal(probe.conversational_work,'clarify');assert.equal(probe.objectiveAdvancement,'NONE');
});
test('state and tactics become behaviour while raw motives stay out of generation context',()=>{
 const s=start(),p=project(s);p.state.irritation=0.8;p.audit.action={outcome:'NO_RELEVANT_ACTION'};
 const d=selectDirection(p,speech({authority_challenge:0.9}),s.pack.behaviour);s.candidate={...s.candidate,...d};
 assert.equal(d.expression.tactic_behaviour,'Offer a small correction.');assert.match(d.expression.behavioural_constraints[0],/Terse/);
 const request=dialogueRequest(s,'test').instructions;assert.ok(!request.includes('SECRET_INTERNAL_STATUS_MOTIVE'));assert.ok(!request.includes('PRIVATE_OBJECTIVE'));assert.ok(!request.includes('COMPETENCE_CHALLENGE'));assert.ok(!request.includes('Driving Instructor'));assert.match(request,/Internal|internal motives/);assert.match(request,/Do not explain themes/);
 assert.equal(generationContext(s).performance.state,undefined);
});
test('alignment and disagreement update state without requiring explanatory speech; retry persists economy',async()=>{
 for(const [scores,state] of [[{alignment_with_npc:0.8,humour:0.7},'rapport'],[{disagreement:0.8},'irritation']]){
  const initial=start(),before=project(initial).state[state];let calls=0;
  const config={interpreter:{interpret:async()=>{calls++;return speech(scores);},disclosures:async()=>({proposals:[],source:'fixture'})}};
  let s=await adaptiveCommand(initial,{type:'turn',text:'A brief reaction.'},config,async()=>'A fragment.');assert.ok(project(s).state[state]>before);assert.equal(s.candidate.explanation_need,'NONE');assert.equal(s.candidate.tactic,null);
  const d=structuredClone(s.candidate.expression);s=await adaptiveCommand(s,{type:'retry'},config,async()=>'Another fragment.');assert.equal(calls,1);assert.deepEqual(s.candidate.expression,d);assert.deepEqual(project(s),project(JSON.parse(JSON.stringify(s))));
 }
});
test('callback retrieval expires without promoting it to actor knowledge or deleting social memory',()=>{
 const inputs=Array.from({length:15},(_,i)=>({id:`turn-${i}`,type:'input',text:'The catalogue.'}));
 const callback={id:'cb',kind:'memory',predicate:'conversational_callback',subject:'catalogue',value:'Old Dusty',observer:'archivist',confidence:1,provenance:'turn-0'};
 const p={transcript:inputs,knowledge:[callback],audit:{}},x=speech({}, {targets:{...neutral().targets,humour:'catalogue'}}),policy=actor().behaviour;
 assert.deepEqual(relevantCallbacks(p,x,policy),[]);p.transcript.push({type:'input',text:'Old Dusty again.'});assert.equal(relevantCallbacks(p,x,policy)[0].id,'cb');
 const s=start();s.pack.knowledge.push(callback);const ctx=generationContext(s);assert.ok(!ctx.memory.actor_knowledge.some(k=>k.id==='cb'));
});
test('authored disclosure/justification permits length with a reason, invalid config is rejected',()=>{
 const policy=actor().behaviour,p=project(start()),decision={responseMode:'HOLD',tactic:'DISCLOSE',rhythm:{id:'QUICK',maxWords:10}};
 const d=conversationPolicy(p,speech(),policy,decision,{explanationNeed:'HIGH'});assert.equal(d.explanation_need,'HIGH');assert.match(d.explanation_reason,/Authored/);assert.equal(d.rhythm.maxWords,90);
 for(const config of [{justificationWeights:{UNKNOWN:1}},{stateStyles:[{state:'irritation',above:2,behaviour:'bad'}]},{callbackWindowTurns:0}]){const pack=actor();pack.behaviour.conversation=config;assert.throws(()=>validatePack(pack));}
});

test('question permission needs a reason; explanation and ordinary warmth do not invite follow-ups',()=>{
 const p=project(start()),policy=actor().behaviour;
 for(const x of [speech({humour:0.8}),speech({explanation_request:0.9}),speech({compliance:0.9}),speech()])assert.equal(selectDirection(p,x,policy).question_policy.allowed,false);
 assert.equal(decide(speech({}, {completion_status:'INCOMPLETE'})).question_policy.allowed,true);
 const deliberate=conversationPolicy(p,speech(),policy,{responseMode:'HOLD',tactic:'ASK',rhythm:{}},{questionReason:'Genuine curiosity about the requested archive entry'});
 assert.equal(deliberate.question_policy.allowed,true);assert.match(deliberate.question_policy.reason,/curiosity/);
});

test('unnecessary short questions and maxims get one bounded rewrite; authored questions remain valid',async()=>{
 for(const first of ['Anything else?', 'Kindness is your armour.']){
  const s=start();command(s,{type:'turn',text:'Fine.'});Object.assign(s.candidate,decide(speech()));let calls=0;
  const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?first:'All right.'}]}]})})});
  assert.equal(calls,2);assert.equal(reply,'All right.');assert.match(dialogueRequest(s,'fixture').instructions,/not responsible for maintaining conversation/);assert.match(dialogueRequest(s,'fixture').instructions,/Avoid manufactured wisdom/);
 }
 const s=start();command(s,{type:'turn',text:'An archive entry.'});Object.assign(s.candidate,decide(speech()),{question_policy:{allowed:true,reason:'Genuine curiosity about an entry'}});let calls=0;
 await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Which entry interests you?'}]}]})};}});assert.equal(calls,1);
});

test('fresh personal disclosure is stored but delayed as leverage; later use requires current relevance',async()=>{
 const pack=actor();pack.behaviour.phases.WORKING.tactics=['PERSONAL_LEVERAGE'];pack.behaviour.tactics={PERSONAL_LEVERAGE:{base:1,objective:'Use an established preference',requiresPredicate:'prefers',behaviour:'Refer to an established preference.'}};
 const disclosure={subject:'visitor',predicate:'prefers',value:'quiet_rooms',kind:'belief',confidence:0.95,evidence:'I prefer quiet rooms'};
 let next=speech({self_disclosure:0.8,authority_challenge:0.8},{topic:'quiet rooms',proposals:[disclosure]});
 const config={interpreter:{interpret:async()=>structuredClone(next),disclosures:async()=>({proposals:[],source:'fixture'})}};
 let s=await adaptiveCommand(start(pack),{type:'turn',text:'I prefer quiet rooms',autoAccept:false},config,async()=>'Acknowledgement.');
 const saved=project(s).knowledge.find(k=>k.predicate==='prefers');assert.ok(saved);assert.equal(s.candidate.tactic,null);assert.equal(s.candidate.objectiveAdvancement,'NONE');assert.ok(!generationContext(s).memory.actor_knowledge.some(k=>k.id===saved.id));assert.ok(generationContext(s).memory.deferred_disclosure_ids.includes(saved.id));
 command(s,{type:'accept'});next=speech({authority_challenge:0.8},{topic:'quiet rooms'});s=await adaptiveCommand(s,{type:'turn',text:'What about quiet rooms?'},config,async()=>'Reply.');assert.equal(s.candidate.tactic,null);command(s,{type:'accept'});
 s=await adaptiveCommand(s,{type:'turn',text:'Those quiet rooms again.'},config,async()=>'Reply.');assert.equal(s.candidate.tactic,'PERSONAL_LEVERAGE');assert.ok(generationContext(s).memory.actor_knowledge.some(k=>k.id===saved.id));
 command(s,{type:'accept'});next=speech({}, {topic:'catalogue'});s=await adaptiveCommand(s,{type:'turn',text:'Where is the catalogue?'},config,async()=>'Reply.');assert.ok(!generationContext(s).memory.actor_knowledge.some(k=>k.id===saved.id));assert.ok(project(s).knowledge.some(k=>k.id===saved.id));assert.deepEqual(project(s),project(JSON.parse(JSON.stringify(s))));
});

test('a clear Director objective compresses expression without changing the decision or requiring a thematic explanation',async()=>{
 const s=start();command(s,{type:'turn',text:'All right.'});Object.assign(s.candidate,decide(speech()),{localObjective:'Encourage the visitor to wait briefly.',localConstraints:['Do not invent a completed action.']});
 const decision=structuredClone(s.candidate),before=project(s);let calls=0,lastRequest;
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(_url,opts)=>{
  lastRequest=JSON.parse(opts.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?'Waiting for the right moment demonstrates the kind of quiet confidence that helps you stay in control of any situation.':'A moment, then.'}]}]})};
 }});
 assert.equal(calls,2);assert.equal(reply,'A moment, then.');assert.match(lastRequest.instructions,/Hard ceiling: 6 words/);assert.match(lastRequest.instructions,/Maximum one short spoken phrase/);assert.match(lastRequest.instructions,/Do not restate the Director objective/);assert.match(lastRequest.instructions,/recorded player action or authoritative world state/);
 assert.deepEqual(s.candidate,decision);assert.deepEqual(project(s),before);
 let shortCalls=0;await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>{shortCalls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'A moment, then.'}]}]})};}});assert.equal(shortCalls,1);
});

test('saved author direction overrides repair and local beat performance on regeneration without advancing simulation',async()=>{
 const interpretation=speech({semantic_fit:0.1,possible_misunderstanding:0.9,clarification_needed:0.9});let interpretationCalls=0,providerCalls=0,request;
 const config={apiKey:'fixture',interpreter:{interpret:async()=>{interpretationCalls++;return interpretation;},disclosures:async()=>({source:'fixture',proposals:[]})},fetchImpl:async(_url,options)=>{providerCalls++;request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Move a little closer to the display.'}]}]})};}};
 let s=await adaptiveCommand(start(),{type:'turn',text:'Who do you mean?'},config,async()=>'Automatic clarification.');assert.equal(s.candidate.responseMode,'REPAIR');
 s=await adaptiveCommand(s,{type:'draft',text:s.candidate.text,direction:'Tell the visitor to move a little closer to the display.',knowledge:[]},config,generateReply);
 const before=project(s),decision=structuredClone(s.candidate.immediateDirection);s=await adaptiveCommand(s,{type:'retry'},config,generateReply);const after=project(s);
 assert.equal(providerCalls,1);assert.equal(interpretationCalls,1);assert.equal(s.candidate.text,'Move a little closer to the display.');assert.ok(request.instructions.lastIndexOf('STRUCTURED LENGTH POLICY')>request.instructions.indexOf('AUTHOR DIRECTION')); assert.match(request.instructions,/overrides the automatic response mode/);assert.ok(!request.instructions.includes('REPAIR is the sole task'));assert.ok(!request.instructions.includes('at most 14 words total'));assert.deepEqual(s.candidate.immediateDirection,decision);
 for(const key of ['state','knowledge','worldState','beatProgression','playerModel','reaction','direction'])assert.deepEqual(after[key],before[key]);
});

test('compliance permits plain regulation without praise, forced callbacks or a thematic explanation',async()=>{
 const s=start();command(s,{type:'turn',text:'All right.'});Object.assign(s.candidate,decide(speech({compliance:0.9})));const before=structuredClone(s.candidate);
 let calls=0,request;const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(_url,options)=>{calls++;request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Steady, enough.'}]}]})};}});
 assert.equal(reply,'Steady, enough.');assert.equal(calls,1);assert.deepEqual(s.candidate,before);
 assert.match(request.instructions,/name the immediate action plainly/);assert.match(request.instructions,/small dismissal, exception or blame claim/);assert.match(request.instructions,/not a requirement to extend its motif/);assert.match(request.instructions,/react to, regulate or acknowledge the recorded action/);assert.match(request.instructions,/predicted partner reaction into personal leverage/);
});

test('a short thematic interpretation receives one rewrite while a genuine requested explanation remains permitted',async()=>{
 const s=start();command(s,{type:'turn',text:'All right.'});Object.assign(s.candidate,decide(speech()));const before=structuredClone(s.candidate);let calls=0,request;
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?"That proves you won't be a pushover.":'Enough, then.'}]}]})};}});
 assert.equal(calls,2);assert.equal(reply,'Enough, then.');assert.match(request.instructions,/Meaning stays with the Director/);assert.match(request.instructions,/remove any explanation whose absence/);assert.deepEqual(s.candidate,before);
 Object.assign(s.candidate,decide(speech({explanation_request:0.9})));let explanationCalls=0;
 await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>{explanationCalls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'By a pushover, I meant someone who always agrees.'}]}]})};}});assert.equal(explanationCalls,1);
});

test('direct answers do not become counterquestions even when a deliberate question is permitted',async()=>{
 const s=start();command(s,{type:'turn',text:'How would you deal with that?'});Object.assign(s.candidate,decide(speech({information_request:0.9})),{question_policy:{allowed:true,reason:'Deliberate probing'}});const before=structuredClone(s.candidate);let calls=0,request;
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(_url,options)=>{request=JSON.parse(options.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?'What would you do?':'I would wait here a moment.'}]}]})};}});
 assert.equal(calls,2);assert.equal(reply,'I would wait here a moment.');assert.match(request.instructions,/Answer the player’s direct question first/);assert.match(request.instructions,/briefly minimise or reframe the intensity/);assert.match(request.instructions,/If the player can infer meaning from behaviour/);assert.deepEqual(s.candidate,before);
});
test('fresh predicted personal reactions stay claims, without immediate judgement or leverage',async()=>{
 let s=start();s=await adaptiveCommand(s,{type:'turn',text:'My partner would go crazy.'},{interpreter:{interpret:async()=>speech({}, {topic:'partner'})}},async()=>'Best not tell them, then.');
 const before=structuredClone(s),request=dialogueRequest(s,'fixture');
 assert.match(request.instructions,/player’s claim, not evidence of that person’s character/);assert.match(request.instructions,/Do not immediately compare them with the player/);assert.match(request.instructions,/bank it for later/);assert.match(request.instructions,/generally manipulative personality or scenario objective is not permission/);
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Best not tell them, then.'}]}]})})});
 assert.equal(reply,'Best not tell them, then.');assert.deepEqual(s,before);
});
test('short Director concept paraphrases receive a concrete rewrite without changing policy or progression',async()=>{
 const s=start();command(s,{type:'turn',text:'All right.'});Object.assign(s.candidate,decide(speech()),{localObjective:'Stay at the current position.'});const before=structuredClone(s);
 for(const line of ['Hold firm.','Not giving in.','Show your nerve.']){
  let calls=0;const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?line:'Stay there.'}]}]})})});assert.equal(reply,'Stay there.');assert.equal(calls,2);assert.deepEqual(s,before);
 }
});
test('existing REPAIR accepts brief puzzlement and corrects empty agreement instead of forcing flow',async()=>{
 let s=start();s=await adaptiveCommand(s,{type:'turn',text:'PCP?'},{interpreter:{interpret:async()=>speech({semantic_fit:0.1,possible_misunderstanding:0.9,clarification_needed:0.9})}},async()=>'What?');assert.equal(s.candidate.responseMode,'REPAIR');const before=structuredClone(s);let calls=0,request;
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(_url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?'Exactly.':'PCP?'}]}]})};}});
 assert.equal(reply,'PCP?');assert.equal(calls,2);assert.match(request.instructions,/Semantic coherence comes before conversational flow/);assert.match(request.instructions,/Do not invent what the term means or agree with it/);assert.deepEqual(s,before);
 for(const line of ['What?','How d’you mean?']){let calls=0;assert.equal(await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:line}]}]})};}}),line);assert.equal(calls,1);}
});
