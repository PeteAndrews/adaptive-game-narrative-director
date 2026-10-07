import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {sessionManager,sceneManager} from '../public/session-manager.js';
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('manager lists identifiable sessions, escapes content and requires explicit per-session confirmation',()=>{
 const items=[{id:'one',name:'<script>bad</script>',branches:2,lines:12,branch:'Alternate',preview:'<unsafe>'},{id:'two',name:'Another scene'}];
 const btn=(text,action)=>`<button data-do="${action}">${text}</button>`;
 const html=sessionManager(items,'one','',btn,esc);assert.match(html,/Current/);assert.match(html,/12 dialogue lines/);assert.match(html,/open-session:one/);assert.match(html,/delete-session:two/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('Delete permanently'));
 const confirming=sessionManager(items,'one','two',btn,esc);assert.match(confirming,/confirm-delete-session:two/);assert.ok(!confirming.includes('confirm-delete-session:one'));assert.match(confirming,/Cancel/);assert.match(sessionManager([],null,'',btn,esc),/No saved sessions/);
});
test('deleting the open session clears browser pointers only after success; deleting another session preserves it',async()=>{
 const elements={'#app':{innerHTML:''},'#toast':{style:{},textContent:''}},listeners={};let removed=0,deletions=0,fail=false;
 const context=vm.createContext({sceneManager,sessionManager,localStorage:{getItem:()=>null,removeItem:()=>removed++},choices:[],document:{querySelector:id=>elements[id]??null,addEventListener:(name,fn)=>listeners[name]=fn},setTimeout:()=>{},fetch:async(url,options)=>{deletions++;assert.equal(options.method,'DELETE');return {ok:!fail,json:async()=>fail?{error:'Save failed'}:{sessions:[{id:'current',name:'Current scene'}]}};}});
 let source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');source=source.slice(0,source.lastIndexOf('load().catch'));
 vm.runInContext(source+'\nglobalThis.install=()=>{pack={title:"Scene"};scenes=[];sessions=[{id:"current",name:"Current scene"},{id:"other",name:"Other"}];session={id:"current",pack:{title:"Scene"}};mode="sessions";};globalThis.state=()=>({session,confirmDeleteId});',context);context.install();
 const click=action=>listeners.click({target:{closest:()=>({dataset:{do:action}})}});
 await click('delete-session:other');assert.equal(deletions,0);await click('cancel-delete-session');assert.equal(deletions,0);
 await click('delete-session:other');await click('confirm-delete-session:other');assert.equal(context.state().session.id,'current');assert.equal(removed,0);
 await click('delete-session:current');fail=true;await click('confirm-delete-session:current');assert.equal(context.state().session.id,'current');assert.equal(removed,0);
 fail=false;await click('confirm-delete-session:current');assert.equal(context.state().session,null);assert.equal(removed,1);
});
