import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSession,project} from '../engine/index.mjs';
import {exportCurrentTake} from '../public/dialogue-history.js';

function fixture(){
 const pack=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
 const s=createSession(pack);s.sceneId='scene-one';
 s.pack.nodes.deletedSection={title:'Old deleted setup',text:'Old setup text'};
 s.branches.main.events=[{type:'utterance',node:s.pack.start,text:'Discarded old dialogue'}];
 s.branches.alternate={name:'Selected take',events:[
  {type:'utterance',node:s.pack.start,text:'Current opening'},
  {type:'input',text:'Current reply',action:'Keep a safe distance',effects:{control:1}},
  {type:'utterance',node:s.pack.start,text:'Future line after rewind'}
 ]};s.active='alternate';s.cursor=2;s.candidate={text:'Uncommitted draft'};
 return s;
}

test('current-take export excludes other branches, future events, drafts and historical setup without changing the saved take',()=>{
 const s=fixture(),before=structuredClone(s),result=exportCurrentTake(s,project(s));
 assert.deepEqual(result.dialogue,[{type:'utterance',speaker:'NPC',text:'Current opening'},{type:'input',speaker:'Player',text:'Current reply',action:'Keep a safe distance'}]);
 assert.equal(result.take.branch,'alternate');assert.equal(result.scene.id,'scene-one');
 const json=JSON.stringify(result);for(const old of ['Discarded old dialogue','Future line after rewind','Uncommitted draft','Old deleted setup','effects','branches','characterPrompt'])assert.ok(!json.includes(old),old);
 assert.deepEqual(s,before);
 s.cursor=3;assert.equal(exportCurrentTake(s,project(s)).dialogue.length,3);
});

test('actual export button downloads the current-take reading copy rather than the internal session archive',async()=>{
 const listeners={},context=vm.createContext({exportCurrentTake,choices:[],localStorage:{getItem:()=>null},document:{querySelector:()=>null,addEventListener:(name,fn)=>listeners[name]=fn}});
 let source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');source=source.slice(0,source.lastIndexOf('load().catch'));
 vm.runInContext(source+'\nglobalThis.install=(s,p)=>{session=s;projection=p;};download=(value,name)=>{globalThis.downloaded={value,name};};',context);
 const s=fixture();context.install(s,project(s));await listeners.click({target:{closest:()=>({dataset:{do:'export'}})}});
 assert.equal(context.downloaded.name,'take.json');assert.equal(context.downloaded.value.format,'dialogue-laboratory-take');assert.equal(context.downloaded.value.dialogue.length,2);
});

test('export retains current NPC attributes and scoped Jev interpretation diagnostics with no credentials or future decisions',()=>{
 const s=fixture(),turnId='current-turn';
 s.branches.alternate.events.splice(2,0,
  {type:'speech_interpretation',turnId,result:{source:'Jev decisions + extraction',stance:'resistant',confidence:0.9,scores:{provocation:0.7},targets:{insult:'npc'},jev:{enabled:true,keyConfigured:true,liveAPI:true,fallbackUsed:false,decision:'stance=resistant',apiKey:'must-not-export'}}},
  {type:'state_delta',turnId,changes:{control_need:{previous:0.3,delta:0.2,value:0.5}}},
  {type:'director_decision',turnId,decision:{phase:s.pack.behaviour.initialPhase,responseMode:'REACT',tactic:null,reason:'React briefly'}});
 s.branches.alternate.events.push({type:'speech_interpretation',turnId:'future-turn',result:{jev:{decision:'future diagnostic'}}});
 s.cursor=5;const before=structuredClone(s),result=exportCurrentTake(s,project(s));
 assert.equal(result.version,3);assert.equal(result.npc.attributes.control_need,0.5);
 assert.equal(result.npc.phase,s.pack.behaviour.initialPhase);assert.equal(result.diagnostics.length,3);
 assert.equal(result.diagnostics[0].interpretation.scores.provocation,0.7);assert.equal(result.diagnostics[0].jev.liveAPI,true);
 assert.equal(result.diagnostics[1].changes.control_need.delta,0.2);assert.equal(result.diagnostics[2].decision.responseMode,'REACT');
 assert.ok(!JSON.stringify(result).includes('must-not-export'));assert.ok(!JSON.stringify(result).includes('future diagnostic'));assert.deepEqual(s,before);
 s.branches.alternate.events[2].result.jev={enabled:true,keyConfigured:false,liveAPI:false,fallbackUsed:true,decision:'No key; using configured interpreter'};
 const fallback=exportCurrentTake(s,project(s));assert.equal(fallback.diagnostics[0].jev.fallbackUsed,true);assert.equal(fallback.diagnostics[0].jev.liveAPI,false);
 delete s.branches.alternate.events[2].result.jev;assert.equal(exportCurrentTake(s,project(s)).diagnostics[0].jev,null);
});
