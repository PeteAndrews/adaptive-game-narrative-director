import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {sceneForTake,removeScene} from '../engine/scene-management.mjs';
import {sceneManager} from '../public/session-manager.js';
const source=JSON.parse(readFileSync(new URL('../packs/continuous-lesson.json',import.meta.url)));
const esc=x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('legacy matching is conservative; ambiguous takes are preserved outside cascade deletion',()=>{
 const p=structuredClone(source),library={activeSceneId:'a',scenes:{a:{id:'a',pack:p},b:{id:'b',pack:structuredClone(p)}}},legacy={id:'legacy',pack:structuredClone(p)},assigned={id:'assigned',sceneId:'a',pack:structuredClone(p)};
 assert.equal(sceneForTake(legacy,library),null);assert.equal(sceneForTake(assigned,library),'a');const before=structuredClone(library),next=removeScene(library,{legacy,assigned},'a');assert.ok(next.takes.legacy);assert.ok(!next.takes.assigned);assert.deepEqual(library,before);
 delete library.scenes.b;assert.equal(sceneForTake(legacy,library),'a');
});
test('Scene manager exposes scoped scene/session/take deletion with explicit confirmation and escaping',()=>{
 const scenes=[{id:'a',name:'<bad>',sections:[{id:'meet',name:'Meeting'}]}],takes=[{id:'t1',sceneId:'a',nodeId:'meet',sectionName:'Meeting'},{id:'legacy',sceneId:null}];const btn=(text,action)=>`<button data-do="${action}">${text}</button>`;
 const html=sceneManager(scenes,takes,'t1','node:a:meet',btn,esc);assert.match(html,/Scene manager/);assert.match(html,/delete-scene:a/);assert.match(html,/confirm-delete-node:a:meet/);assert.match(html,/delete-session:t1/);assert.match(html,/Unassigned legacy takes/);assert.ok(!html.includes('<bad>'));assert.ok(!html.includes('confirm-delete-scene:a'));
});
test('Director selectors filter takes by both scene and authored session; setup/manager omit the production bar',()=>{
 const elements={'#app':{innerHTML:''}},context=vm.createContext({sceneManager,choices:[],localStorage:{getItem:()=>null},document:{querySelector:id=>elements[id],addEventListener:()=>{}}});let app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');app=app.slice(0,app.lastIndexOf('load().catch'));
 vm.runInContext(app+'\nglobalThis.install=(p)=>{pack=p;editNode=p.start;activeSceneId="a";scenes=[{id:"a",name:"Scene A",sections:[{id:p.start,name:"One"}]},{id:"b",name:"Scene B",sections:[]}];sessions=[{id:"matching",sceneId:"a",nodeId:p.start},{id:"other-node",sceneId:"a",nodeId:"meet"},{id:"other-scene",sceneId:"b",nodeId:p.start}];};globalThis.show=render;',context);context.install(source);context.show();
 const html=elements['#app'].innerHTML;assert.match(html,/production-scene/);assert.match(html,/production-node/);assert.match(html,/production-take/);assert.match(html,/value="matching"/);assert.ok(!html.includes('value="other-node"'));assert.ok(!html.includes('value="other-scene"'));assert.ok(!html.includes('mode:play'));assert.ok(!html.includes('New conversation'));
 vm.runInContext('mode="script";render();',context);assert.ok(!elements['#app'].innerHTML.includes('Current production'));assert.match(elements['#app'].innerHTML,/Delete session/);
 vm.runInContext('mode="sessions";render();',context);assert.ok(!elements['#app'].innerHTML.includes('Current production'));assert.match(elements['#app'].innerHTML,/Scene manager/);
});
