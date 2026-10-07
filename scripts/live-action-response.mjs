// Optional billable generation-only regression. Interpretation is a fixture.
import {readFile} from 'node:fs/promises';
import {createSession,command} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {generateReply} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8'));
const config={...await readConfig(),interpreter:{interpret:async()=>({...neutral('fixture'),confidence:0.95,completion_status:'AMBIGUOUS',topic:'other driver behavior'}),disclosures:async()=>({source:'fixture',proposals:[]})}};
let s=createSession(pack);s.candidate.text='That driver was right behind us and just cut in front.';command(s,{type:'accept'});
s=await adaptiveCommand(s,{type:'turn',choice:'distance',text:'Gonna ease off a bit'},config,generateReply);
console.log(JSON.stringify({mode:s.candidate.responseMode,stage:s.candidate.beatProgression.stage,localObjective:s.candidate.localObjective,reply:s.candidate.text}));
console.log('Fixture interpretation; live generation only. Saved histories unchanged.');
