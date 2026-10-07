import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSession,project} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {dialogueBoundaries} from '../public/dialogue-history.js';
const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
test('selected dialogue restores complete before/after states, pending drafts and preserves original futures',async()=>{
 let interpretations=0,extractions=0;
 const config={interpreter:{interpret:async()=>{interpretations++;return {...neutral(),confidence:0.9};},disclosures:async()=>{extractions++;return {source:'fixture',proposals:[]};}}};
 const run=(s,cmd)=>adaptiveCommand(s,cmd,config,async()=>'Wait here.');
 let s=await run(createSession(pack),{type:'accept'});const opening=project(s),openingCursor=s.cursor;
 s=await run(s,{type:'turn',text:'What would you do?'});const pending=structuredClone(s),pendingCursor=s.cursor;
 s=await run(s,{type:'accept'});const first=project(s),committedCursor=s.cursor;
 s=await run(s,{type:'turn',text:'Then what?',autoAccept:true});const original=structuredClone(s),counts=[interpretations,extractions];
 const input=first.transcript.find(e=>e.type==='input'),npc=first.transcript.at(-1),points=dialogueBoundaries(s);
 assert.equal(points[input.id].before,openingCursor);assert.equal(points[input.id].after,pendingCursor);assert.equal(points[npc.id].before,pendingCursor);assert.equal(points[npc.id].after,committedCursor);
 for(const [cursor,expected,name] of [[points[input.id].before,opening,'Restart player line'],[points[npc.id].before,project(pending),'Restart NPC draft'],[points[npc.id].after,first,'Branch after NPC']]){
  let next=await run(s,{type:'seek',cursor});next=await run(next,{type:'branch',name});
  assert.deepEqual(project(next),expected);assert.deepEqual(next.branches.main.events,original.branches.main.events);assert.equal(next.cursor,next.branches[next.active].events.length);
  if(name==='Restart NPC draft')assert.deepEqual(next.candidate,pending.candidate);
 }
 assert.deepEqual([interpretations,extractions],counts);assert.deepEqual(s,original);
});
