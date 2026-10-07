import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,command,project} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {resolveContinuationQuestion} from '../engine/conversation-continuity.mjs';
import {JevInterpreter,jevRequest} from '../engine/jev.mjs';
import {dialogueRequest} from '../engine/dialogue.mjs';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const speech=()=>({...neutral(),confidence:0.95,completion_status:'INCOMPLETE',topic:'other driver',scores:{...neutral().scores,semantic_fit:0.49,information_request:0.62,explanation_request:0.61}});
test('contextual continuation questions are answerable; genuine unfinished thoughts and misunderstandings remain unresolved',()=>{
 const x=speech(),before=structuredClone(x),previous={text:'Wait a moment, for now.'};
 for(const text of ['and then...','And then?','then what?','what next?','and after that?']){
  const result=resolveContinuationQuestion(x,text,previous);assert.equal(result.completion_status,'COMPLETE');assert.equal(result.scores.information_request,0.8);assert.equal(result.scores.explanation_request,0);assert.ok(result.continuationCorrection);
 }
 for(const text of ['My partner would go crazy if...','and then my girlfriend...','because...'])assert.deepEqual(resolveContinuationQuestion(x,text,previous),x);
 assert.deepEqual(resolveContinuationQuestion(x,'and then...',null),x);
 assert.deepEqual(resolveContinuationQuestion(x,'and then...',{text:'What does your partner say?'}),x);
 const confused={...x,scores:{...x.scores,possible_misunderstanding:0.9,clarification_needed:0.9}};assert.deepEqual(resolveContinuationQuestion(confused,'and then...',previous),confused);assert.deepEqual(x,before);
});
test('and then keeps the authored local direction without forcing a later beat, and retry preserves effects',async()=>{
 const custom=structuredClone(pack);custom.behaviour.beatProgression.start='discourage_submission';
 let s=createSession(custom);s.candidate.text='Wait a moment, for now.';command(s,{type:'accept'});let calls=0;
 const config={interpreter:{interpret:async()=>{calls++;return speech();}}};
 s=await adaptiveCommand(s,{type:'turn',text:'and then...',lengthOverride:'MICRO'},config,async()=>'Don’t keep dropping back.');
 assert.equal(s.candidate.responseMode,'HOLD');assert.equal(s.candidate.conversational_work,'answer');assert.equal(s.candidate.question_policy.allowed,false);assert.equal(s.candidate.beatProgression.stage,'discourage_submission');assert.equal(s.candidate.beatProgression.transition,'HOLD');assert.match(s.candidate.localObjective,/without continuing to accommodate/);assert.equal(s.candidate.lengthOverride,'MICRO');
 const request=JSON.stringify(dialogueRequest(s,'fixture'));assert.ok(!request.includes('finalDesiredAction'));assert.ok(!request.includes('normalise_retaliation'));assert.ok(!request.includes('tailgating'));
 const before=project(s),retried=await adaptiveCommand(s,{type:'retry'},config,async()=>'Stay there, for now.');assert.equal(calls,1);
 for(const key of ['state','reaction','beatProgression','direction','knowledge','audit','playerModel'])assert.deepEqual(project(retried)[key],before[key]);
});
test('Jev incomplete conflicts are corrected only with confident complete extraction and no unfinished-clause evidence',async()=>{
 const request=jevRequest('What would you do?',[],pack.behaviour),answers=Object.fromEntries(Object.entries(request.questions).map(([k,q])=>[k,q.type==='choice'?{type:'choice',choice:k==='stance'?'QUESTION':k==='completion_status'?'INCOMPLETE':'none',confidence:0.9}:{type:'noul',noul:0}]));
 let base={...neutral(),confidence:0.95},extractions=0,requests=0;const logs=[];
 const interpreter=new JevInterpreter({jevEnabled:true,jevApiKey:'fixture',jevLogger:x=>logs.push(x),jevFetchImpl:async()=>{requests++;return {ok:true,json:async()=>({answers})};}},{interpret:async()=>{extractions++;return structuredClone(base);}});
 let result=await interpreter.interpret('What would you do?',[],pack.behaviour);assert.equal(result.completion_status,'COMPLETE');assert.ok(result.completionCorrection);assert.equal(result.jev.liveAPI,true);assert.match(logs.join(' '),/completion corrected/);
 base={...base,completion_status:'INCOMPLETE',unresolved_clause:'but when I...'};result=await interpreter.interpret('My partner complains but when I...',[],pack.behaviour);assert.equal(result.completion_status,'INCOMPLETE');assert.equal(result.unresolved_clause,'but when I...');
 base={...neutral(),confidence:0.2};result=await interpreter.interpret('Something uncertain',[],pack.behaviour);assert.equal(result.completion_status,'INCOMPLETE');assert.equal(extractions,3);assert.equal(requests,3);
 assert.match(request.questions.completion_status.instructions,/Ellipsis alone does not prove incompleteness/);
});
