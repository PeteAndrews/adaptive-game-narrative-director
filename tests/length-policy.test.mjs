import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project,validatePack} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {selectLengthPolicy,effectiveLengthPolicy,exceedsLength} from '../engine/length-policy.mjs';
import {dialogueRequest,generationContext,generateReply} from '../engine/dialogue.mjs';
import {lengthControl} from '../public/length-control.js';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const success=text=>async()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]})});
test('length defaults distinguish conversational work without actor/scenario dependencies',()=>{
 for(const mode of ['REACT','HOLD','REINFORCE','WITHDRAW'])assert.equal(selectLengthPolicy({responseMode:mode}).id,'MICRO');
 for(const mode of ['PROBE','REPAIR','MINIMISE','REFRAME','PRESSURE','ANSWER'])assert.equal(selectLengthPolicy({responseMode:mode}).id,'SHORT');
 assert.equal(selectLengthPolicy({responseMode:'DISCLOSE'}).id,'NORMAL');
 assert.equal(selectLengthPolicy({responseMode:'STORY'}).id,'EXTENDED');
 assert.equal(selectLengthPolicy({responseMode:'ANSWER',explanation_need:'MODERATE',explanation_reason:'Explicit why question'}).id,'EXPLAIN');
 assert.equal(selectLengthPolicy({responseMode:'HOLD',explanation_need:'HIGH'}).id,'MICRO');
 assert.equal(selectLengthPolicy({responseMode:'REACT'},{lengthDefaults:{REACT:'SHORT'}}).id,'SHORT');
 assert.equal(selectLengthPolicy({responseMode:'HOLD'},{},{lengthPolicy:'NORMAL',lengthReason:'Necessary detailed answer'}).id,'NORMAL');
});
test('pre-send length applies to first generation, preserves automatic decision and survives retry/idempotency',async()=>{
 let interpretations=0,calls=0,request;
 const config={apiKey:'fixture',interpreter:{interpret:async()=>{interpretations++;return {...neutral(),confidence:0.95,scores:{...neutral().scores,humour:0.9}};}},fetchImpl:async(url,options)=>{calls++;request=JSON.parse(options.body);return success('Yes, I thought that was rather funny too.')();}};
 const s=createSession(pack);command(s,{type:'accept'});const before=structuredClone(s);
 const cmd={type:'turn',text:'What a joke.',lengthOverride:'NORMAL',requestId:'pre-send-test'};
 const next=await adaptiveCommand(s,cmd,config,generateReply);
 assert.equal(next.candidate.lengthPolicy.id,'MICRO');assert.equal(next.candidate.lengthOverride,'NORMAL');assert.equal(calls,1);assert.equal(interpretations,1);
 assert.match(request.instructions,/STRUCTURED LENGTH POLICY — NORMAL \(AUTHOR\)/);assert.equal(request.max_output_tokens,192);assert.deepEqual(s,before);
 const duplicate=await adaptiveCommand(next,cmd,config,generateReply);assert.deepEqual(duplicate,next);assert.equal(calls,1);
 const retried=await adaptiveCommand(next,{type:'retry'},config,generateReply);assert.equal(retried.candidate.lengthOverride,'NORMAL');assert.equal(interpretations,1);assert.equal(calls,2);
 for(const key of ['state','reaction','playerModel','beatProgression','direction','knowledge','audit'])assert.deepEqual(project(retried)[key],project(next)[key]);
 await assert.rejects(adaptiveCommand(s,{...cmd,lengthOverride:'INVALID',requestId:'bad'},config,generateReply),/Invalid response length/);assert.equal(interpretations,1);assert.deepEqual(s,before);
 const control=lengthControl({lengthOverride:'NORMAL'},{composer:true});assert.match(control,/id="reply-length"/);assert.match(control,/value="NORMAL" selected/);assert.match(control,/next instructor reply/);
});
test('strong author override changes budget/token backstop and combines with content direction',()=>{
 const s=createSession(pack);s.candidate.lengthPolicy={id:'NORMAL',reason:'Director answer'};s.candidate.lengthOverride='MICRO';s.candidate.direction='Offer a tiny hint, without explanation.';
 const r=dialogueRequest(s,'fixture');assert.equal(r.max_output_tokens,96);assert.match(r.instructions,/Maximum one short spoken phrase.*1–6 words.*Do not explain/);assert.match(r.instructions,/Hard ceiling: 6 words, 2 sentence/);assert.match(r.instructions,/Offer a tiny hint/);assert.match(r.instructions,/applies even with author direction/);
 assert.equal(effectiveLengthPolicy(s.candidate).source,'AUTHOR');s.candidate.lengthOverride='AUTO';assert.equal(effectiveLengthPolicy(s.candidate).id,'NORMAL');
 s.candidate.lengthOverride='SHORT';assert.match(dialogueRequest(s,'fixture').instructions,/One concise spoken sentence.*5–15 words.*Do not add a second thought/);assert.equal(dialogueRequest(s,'fixture').max_output_tokens,128);
});
test('length regeneration preserves committed interpretation, effects, tactics, progression and knowledge',async()=>{
 let interpretations=0,knowledgeCalls=0;
 const interpreter={interpret:async()=>{interpretations++;return {...neutral(),confidence:0.95,scores:{...neutral().scores,alignment_with_npc:0.8,humour:0.8}};},disclosures:async()=>{knowledgeCalls++;return {source:'fixture',proposals:[]};}};
 const config={apiKey:'fixture',interpreter,fetchImpl:success('Alright.')};
 let s=createSession(pack);command(s,{type:'accept'});
 s=await adaptiveCommand(s,{type:'turn',text:'What a joke.'},config,generateReply);
 assert.equal(s.candidate.lengthPolicy.id,'MICRO');
 const before=project(s),decision=structuredClone(s.candidate),events=s.branches[s.active].events.filter(e=>e.type!=='candidate'&&e.type!=='command_completed');
 for(const override of ['NORMAL','MICRO','AUTO']){
  s=await adaptiveCommand(s,{type:'draft',text:s.candidate.text,direction:'Acknowledge briefly.',lengthOverride:override,knowledge:[]},config,generateReply);
  s=await adaptiveCommand(s,{type:'retry'},config,generateReply);
  for(const key of ['state','reaction','playerModel','beatProgression','direction','knowledge','worldState','audit'])assert.deepEqual(project(s)[key],before[key]);
  assert.deepEqual(s.candidate.lengthPolicy,decision.lengthPolicy);assert.deepEqual(s.candidate.immediateDirection,decision.immediateDirection);
 }
 assert.equal(interpretations,1);assert.equal(knowledgeCalls,0);
 assert.deepEqual(s.branches[s.active].events.filter(e=>e.type!=='candidate'&&e.type!=='command_completed'),events);
 assert.deepEqual(project(JSON.parse(JSON.stringify(s))),project(s));
});
test('overlong author-directed output gets one rewrite and fails safely if still over budget',async()=>{
 const s=createSession(pack);s.candidate.lengthOverride='MICRO';s.candidate.direction='Agree with the remark.';const before=structuredClone(s);let calls=0;
 const long='Yes, I agree with everything you just said, absolutely.';
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(...args)=>success(++calls===1?long:'Yes.')(...args)});
 assert.equal(reply,'Yes.');assert.equal(calls,2);assert.deepEqual(s,before);
 await assert.rejects(adaptiveCommand(s,{type:'retry'},{apiKey:'fixture',fetchImpl:success(long)},generateReply),/exceeded the MICRO speech budget/);assert.deepEqual(s,before);
 assert.equal(exceedsLength('Alright. Watch him.',effectiveLengthPolicy({lengthOverride:'MICRO'})),false);
 assert.equal(exceedsLength('Alright. Watch him. Wait.',effectiveLengthPolicy({lengthOverride:'MICRO'})),true);
 assert.equal(exceedsLength('Alright, watch him.',effectiveLengthPolicy({lengthOverride:'MICRO'})),false);
});
test('Director length control renders six choices, saved selection and lock state; invalid policies rejected',()=>{
 const html=lengthControl({lengthPolicy:{id:'SHORT'},lengthOverride:'MICRO',locked:true});
 assert.match(html,/Response length/);assert.equal((html.match(/<option /g)??[]).length,6);assert.match(html,/value="MICRO" selected/);assert.match(html,/Auto \(short\)/);assert.match(html,/aria-label="Response length" disabled/);
 const s=createSession(pack),before=structuredClone(s);assert.throws(()=>command(s,{type:'draft',text:'x',lengthOverride:'HUGE'}),/Invalid response length/);assert.deepEqual(s,before);
 const invalid=structuredClone(pack);invalid.behaviour.conversation.lengthDefaults={REACT:'HUGE'};assert.throws(()=>validatePack(invalid),/Invalid response length/);
 const old=structuredClone(s.candidate);delete old.lengthPolicy;assert.ok(effectiveLengthPolicy(old).id);assert.equal(lengthControl(old).includes('value="AUTO" selected'),true);
});
test('Micro permits tiny conversational fragments and corrects actual rejected text without changing state',async()=>{
 const s=createSession(pack);s.candidate.lengthOverride='MICRO';const before=structuredClone(s);
 for(const line of ['Easy. That’s enough.','There you go. Watch him.','Mr. Macchiato, then.']){
  let calls=0;assert.equal(await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>{calls++;return success(line)();}}),line);assert.equal(calls,1);
 }
 const rejected='Easy. That is enough now, just leave it there.';let calls=0,lastRequest;
 const reply=await generateReply(s,{apiKey:'fixture',fetchImpl:async(_url,opts)=>{lastRequest=JSON.parse(opts.body);return success(++calls===1?rejected:'Easy. That’s enough.')();}});
 assert.equal(calls,2);assert.equal(reply,'Easy. That’s enough.');assert.ok(lastRequest.instructions.includes(JSON.stringify(rejected)));assert.match(lastRequest.instructions,/9 words and 2 spoken chunks/);assert.match(lastRequest.instructions,/do not simply cut off the text/);assert.deepEqual(s,before);
 assert.equal(exceedsLength('Just leave a little more room there.',effectiveLengthPolicy(s.candidate)),true);
});
test('author Explain replaces Micro delivery on regeneration without changing the committed Director decision',async()=>{
 let s=createSession(pack);s.candidate.responseMode='REACT';s.candidate.lengthPolicy={id:'MICRO',reason:'Reaction'};s.candidate.rhythm={id:'QUICK'};s.candidate.explanation_need='NONE';s.candidate.text='Alright.';
 s=await adaptiveCommand(s,{type:'draft',text:s.candidate.text,direction:'Gives a lecture on control and respect.',lengthOverride:'EXPLAIN',knowledge:[]},{},generateReply);
 const before=structuredClone(s),projection=project(s);let calls=0,request;
 const long='You cannot expect everyone to make room for you. Sometimes you have to decide what you are doing and stick to it. Otherwise you spend the whole drive reacting to somebody else.';
 const next=await adaptiveCommand(s,{type:'retry'},{apiKey:'fixture',fetchImpl:async(_url,opts)=>{request=JSON.parse(opts.body);return success(++calls===1?'Well, you are behind the wheel now.':long)();}},generateReply);
 assert.equal(calls,2);assert.equal(next.candidate.text,long);assert.equal(request.max_output_tokens,320);assert.match(request.instructions,/author explicitly requests a developed explanation/);assert.match(request.instructions,/Aim for 25–60 words/);assert.match(request.instructions,/supersedes automatic QUICK\/MICRO rhythm/);assert.match(request.instructions,/Develop the requested content toward the selected target range/);assert.ok(request.instructions.includes('Gives a lecture on control and respect.'));assert.equal(generationContext(s).constraints.rhythm,null);
 assert.deepEqual(next.candidate.lengthPolicy,before.candidate.lengthPolicy);assert.equal(next.candidate.responseMode,'REACT');assert.equal(next.candidate.explanation_need,'NONE');assert.deepEqual(s,before);
 for(const key of ['state','reaction','beatProgression','direction','knowledge','audit','playerModel'])assert.deepEqual(project(next)[key],projection[key]);
 s.candidate.lengthOverride='AUTO';const auto=dialogueRequest(s,'fixture');assert.equal(auto.max_output_tokens,96);assert.ok(!auto.instructions.includes('author explicitly requests a developed explanation'));assert.equal(generationContext(s).constraints.rhythm.id,'QUICK');
 s.candidate.lengthOverride='EXTENDED';assert.match(dialogueRequest(s,'fixture').instructions,/Aim for 60–150 words/);
});
test('Explain length does not force padding when the saved mode genuinely needs clarification',async()=>{
 const s=createSession(pack);s.candidate.responseMode='PROBE';s.candidate.lengthOverride='EXPLAIN';s.candidate.direction='';s.candidate.question_policy={allowed:true,reason:'Missing information'};let calls=0;
 assert.equal(await generateReply(s,{apiKey:'fixture',fetchImpl:async()=>{calls++;return success('Which one?')();}}),'Which one?');assert.equal(calls,1);
});
