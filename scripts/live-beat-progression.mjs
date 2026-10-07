// Optional billable generation check. Unsaved session, fixture interpretation;
// this verifies one spoken sample, not live Jev interpretation quality.
import {readFile} from 'node:fs/promises';
import {createSession,command} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {generateReply} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8')),config=await readConfig();
let interpretation={...neutral('fixture'),confidence:0.95,topic:'other driver',scores:{...neutral().scores,alignment_with_npc:0.8}};
const fixture={interpreter:{interpret:async()=>structuredClone(interpretation),disclosures:async()=>({source:'fixture',proposals:[]})}};
let s=createSession(pack);s.candidate.text='That driver cut right in front of us.';command(s,{type:'accept'});
for(let i=0;i<2;i++)s=await adaptiveCommand(s,{type:'turn',text:'That driver is annoying.',autoAccept:true},fixture,async()=>'Yeah, noticed that.');
interpretation={...neutral('fixture'),confidence:0.95,topic:'other driver',scores:{...neutral().scores,information_request:0.95}};
s=await adaptiveCommand(s,{type:'turn',text:'How would you deal with that?'},fixture,async()=>'Temporary draft');
const reply=await generateReply(s,config);
console.log(JSON.stringify({interpretation:'fixture, not live Jev',stage:s.candidate.beatProgression.stage,transition:s.candidate.beatProgression.transition,localObjective:s.candidate.localObjective,reply}));
console.log('Saved user histories were not changed.');
