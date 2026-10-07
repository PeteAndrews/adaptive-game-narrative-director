import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project,validatePack} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral,npcDirectedSpeech,keywordInterpret,validateInterpretation,reconcileTargets,supportedProposals} from '../engine/interpretation.mjs';
import {generationContext,dialogueRequest,generateReply} from '../engine/dialogue.mjs';
import {upgradeResponsePolicy} from '../engine/policy-upgrade.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const speech=(scores={},extra={})=>({...neutral(),confidence:0.95,stance:'NEUTRAL',scores:{...neutral().scores,...scores},...extra});
function start(){const s=createSession(pack);s.candidate.text="Look at him, right up your arse. Don't move over just because he's in a BMW.";command(s,{type:'accept'});return s;}
function harness(){let result=speech(),calls=0;const config={interpreter:{interpret:async()=>{calls++;return structuredClone(result);},disclosures:async()=>({source:'test',proposals:[]})}};return {config,set:r=>result=r,calls:()=>calls,run:(s,cmd)=>adaptiveCommand(s,cmd,config,async()=>'Spoken reply')};}
test('A: shared humour targets another driver, needs no tactic or objective advancement',async()=>{
 const h=harness();h.set(speech({humour:0.9,hostility:0.4,alignment_with_npc:0.7},{targets:{hostility:'other_driver',humour:'other_driver',praise:'none',criticism:'other_driver'}}));
 const s=await h.run(start(),{type:'turn',text:'Probably just some suit late for his macchiato.'}),p=project(s),d=s.candidate;
 assert.equal(d.responseMode,'REACT');assert.equal(d.tactic,null);assert.equal(d.objectiveAdvancement,'NONE');assert.equal(d.pressureLevel,0);assert.equal(d.activeFacade,'GOOD_BLOKE');
 assert.ok(p.state.perceived_disrespect<=pack.behaviour.defaults.perceived_disrespect);assert.equal(p.reaction.incidents,0);assert.equal(p.audit.speech.targets.hostility,'other_driver');assert.equal(p.audit.action.outcome,'NO_RELEVANT_ACTION');
 assert.match(d.immediateDirection.direction,/share the joke/);assert.match(dialogueRequest(s,'test').instructions,/Do not explain/);
});
test('B: explicit safety objection chooses minimisation without instant rage',async()=>{
 const h=harness();h.set(speech({resistance:0.85,authority_challenge:0.35,safety_concern:0.95,humour:0.5}));
 const s=await h.run(start(),{type:'turn',text:"Haha, are you joking? That's super dangerous."}),p=project(s);
 assert.equal(s.candidate.responseMode,'MINIMISE');assert.equal(s.candidate.tactic,'MINIMISE_PREVIOUS_PRESSURE');assert.equal(s.candidate.objectiveAdvancement,'LIGHT');assert.equal(p.reaction.mode,'CALM');assert.equal(p.knowledge.filter(k=>k.kind==='memory').length,0);
 assert.match(s.candidate.immediateDirection.direction,/Do not rage/);
});
test('C/D: refusal then explicit physical compliance produces brief, warmer reinforcement',async()=>{
 const h=harness();h.set(speech({resistance:0.9}, {stance:'REFUSE'}));let s=await h.run(start(),{type:'turn',text:'Nah, not worth it.',autoAccept:true});
 assert.equal(project(s).direction.responseMode,'WITHDRAW');assert.equal(project(s).direction.tactic,'SUBTLE_DIG');assert.equal(project(s).direction.rhythm.id,'QUICK');
 h.set(speech({compliance:0.9,alignment_with_npc:0.8,humour:0.7}));s=await h.run(s,{type:'turn',text:"Okay, you're right. Let's push Mr Macchiato.",choice:'PULL_UP_BEHIND_CAR'});
 assert.equal(s.candidate.responseMode,'REINFORCE');assert.equal(s.candidate.activeFacade,'GOOD_BLOKE');assert.equal(s.candidate.objectiveAdvancement,'NONE');assert.equal(project(s).audit.action.outcome,'COMPLY');assert.equal(s.candidate.rhythm.id,'QUICK');
});
test('E: incomplete disclosure keeps only supported evidence and asks one clarification',async()=>{
 const h=harness(),text='She tells me to stand up for myself all the time but when I do...';
 h.set(speech({self_disclosure:0.8},{completion_status:'INCOMPLETE',unresolved_clause:'but when I do...',topic:'relationship / assertiveness',proposals:[{subject:'known_person',predicate:'encourages',value:'assertiveness',kind:'claim',confidence:0.9,evidence:'tells me to stand up for myself'},{subject:'known_person',predicate:'gets_angry',value:'true',kind:'claim',confidence:0.9,evidence:'but when I do...'}]}));
 const s=await h.run(start(),{type:'turn',text}),p=project(s);
 assert.equal(s.candidate.responseMode,'PROBE');assert.equal(s.candidate.tactic,null);assert.equal(s.candidate.objectiveAdvancement,'NONE');assert.equal(p.knowledge.at(-1).predicate,'encourages');assert.ok(!p.knowledge.some(k=>k.predicate==='gets_angry'));assert.equal(p.audit.playerKnowledge.find(d=>d.proposal.predicate==='gets_angry').status,'rejected');
 let calls=0;const reply=await generateReply(s,{apiKey:'test',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'When you do what?'}]}]})};}});
 assert.equal(reply,'When you do what?');assert.equal(calls,1);assert.equal(keywordInterpret(text,pack.behaviour).completion_status,'INCOMPLETE');
});
test('surface warmth returns while salient memories survive replay, retry and branch isolation',async()=>{
 const h=harness();h.set(speech({authority_challenge:0.95,npc_disrespect:0.8,hostility:0.5},{targets:{hostility:'instructor',humour:'none',praise:'none',criticism:'instructor'}}));
 let s=await h.run(start(),{type:'turn',text:'You have no idea how to teach.',autoAccept:true});const injured=project(s),memory=injured.knowledge.find(k=>k.kind==='memory');assert.ok(memory);assert.equal(memory.observer,'instructor');const boundary=s.cursor;
 h.set(speech({compliance:0.9,humour:0.7,alignment_with_npc:0.8}));s=await h.run(s,{type:'turn',text:'Okay then, you win.',choice:'PULL_UP_BEHIND_CAR'});const recovered=project(s);
 assert.equal(s.candidate.activeFacade,'GOOD_BLOKE');assert.ok(recovered.state.charm_mask>injured.state.charm_mask);assert.ok(recovered.state.anger<injured.state.anger);assert.deepEqual(recovered.knowledge.find(k=>k.id===memory.id),memory);
 const calls=h.calls(),retry=await h.run(s,{type:'retry'});assert.equal(h.calls(),calls);assert.deepEqual(project(retry),project(JSON.parse(JSON.stringify(retry))));assert.deepEqual(retry.candidate.immediateDirection,s.candidate.immediateDirection);
 const original=structuredClone(s.branches.main);s=await h.run(s,{type:'seek',cursor:boundary});s=await h.run(s,{type:'branch',name:'Alternate'});assert.equal(h.calls(),calls);assert.deepEqual(s.branches.main,original);assert.equal(project(s).knowledge.find(k=>k.id===memory.id).value,'authority_challenge');
});
test('temporary speech modifiers arise only from authored world state, separate from phase',async()=>{
 const h=harness();h.set(speech({insult:0.95,hostility:0.9,npc_disrespect:0.95}));const angry=await h.run(start(),{type:'turn',text:"You're an idiot."});assert.deepEqual(generationContext(angry).performance.temporary_style,[]);
 let s=start();s.pack.worldModifiers={DRIVER_HONKS:{alcohol_intoxication:0.75,stimulant_effect:0.8}};s=await h.run(s,{type:'world',event:'DRIVER_HONKS'});
 const context=generationContext(s);assert.equal(context.performance.temporary_style.length,2);assert.equal(context.performance.progression_phase,'PLEASANT_FACADE');assert.deepEqual(project(JSON.parse(JSON.stringify(s))).temporaryModifiers,{alcohol_intoxication:0.75,stimulant_effect:0.8});
 const invalid=structuredClone(pack);invalid.temporary_modifiers={alcohol_intoxication:2};assert.throws(()=>validatePack(invalid));
});
test('old pack upgrades preserve custom text and history; invalid new contracts fail validation',()=>{
 const old=structuredClone(pack);delete old.behaviour.effects.npc_disrespect;old.characterPrompt='Author custom voice';const upgraded=upgradeResponsePolicy(old,pack.behaviour);assert.equal(upgraded.characterPrompt,'Author custom voice');assert.deepEqual(upgraded.behaviour.effects.npc_disrespect,pack.behaviour.effects.npc_disrespect);
 const invalid=speech();invalid.completion_status='GUESSED';assert.throws(()=>validateInterpretation(invalid));
 const other=speech({hostility:0.9,insult:0.8},{targets:{hostility:'other_driver',humour:'none',praise:'none',criticism:'other_driver'}});assert.equal(npcDirectedSpeech(other,pack.behaviour).scores.insult,0);
});
test('inconsistent third-party disrespect and uncertain unfinished consequences are corrected visibly',()=>{
 const other=speech({hostility:0.4,npc_disrespect:0.72,authority_challenge:0.65},{targets:{hostility:'other_driver',humour:'other_driver',praise:'none',criticism:'other_driver'}});
 const corrected=reconcileTargets(other,pack.behaviour);assert.equal(corrected.scores.npc_disrespect,0);assert.equal(corrected.scores.authority_challenge,0);assert.equal(corrected.targetCorrections.npc_disrespect,0.72);
 const incomplete=reconcileTargets(speech({npc_disrespect:0.3,provocation:0.26,relationship_attack:0.13},{completion_status:'INCOMPLETE'}),pack.behaviour);assert.equal(incomplete.scores.npc_disrespect,0);assert.equal(incomplete.scores.relationship_attack,0);assert.equal(incomplete.uncertaintyCorrections.provocation,0.26);
 const transient=speech({}, {proposals:[{predicate:'complies_with_request',evidence:'Okay'}]});assert.deepEqual(supportedProposals(transient,'Okay'),[]);
});
test('reinforcement advice and extra PROBE commentary receive one bounded correction',async()=>{
 const h=harness();h.set(speech({compliance:0.9}));const reward=await h.run(start(),{type:'turn',text:'Okay then.',choice:'PULL_UP_BEHIND_CAR'});
 h.set(speech({}, {completion_status:'INCOMPLETE',unresolved_clause:'but then...'}));const probe=await h.run(start(),{type:'turn',text:'I asked but then...'});
 for(const [s,first,final] of [[reward,'Good lad. Keep it steady.','Fair enough.'],[probe,'When? Tell me more.','When?']]){
   let calls=0;const reply=await generateReply(s,{apiKey:'test',fetchImpl:async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:++calls===1?first:final}]}]})})});
   assert.equal(calls,2);assert.equal(reply,final);
 }
});
test('existing author-created action IDs use explicit authored compliance, never guessed labels',async()=>{
 const h=harness();let s=start();s.pack.nodes.lesson.choices.push({id:'custom-action',label:'Pull up behind the car',target:'lesson',stance:'compliant'});
 s=await h.run(s,{type:'turn',text:'Okay then.',choice:'custom-action'});assert.equal(project(s).audit.action.outcome,'COMPLY');assert.equal(s.candidate.responseMode,'REINFORCE');
 let unknown=start();unknown.pack.nodes.lesson.choices.push({id:'unknown-action',label:'Pull up behind the car',target:'lesson',stance:'neutral'});unknown=await h.run(unknown,{type:'turn',choice:'unknown-action'});assert.equal(project(unknown).audit.action.outcome,'NO_RELEVANT_ACTION');
});
