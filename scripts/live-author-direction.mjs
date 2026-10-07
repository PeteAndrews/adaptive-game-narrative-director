// Optional billable generation check: fixture interpretation, unsaved session.
import {readFile} from 'node:fs/promises';
import {createSession,command} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {generateReply} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8'));
const config={...await readConfig(),interpreter:{interpret:async()=>({...neutral('fixture'),confidence:0.95,topic:'other driver',scores:{...neutral().scores,semantic_fit:0.1,possible_misunderstanding:0.9,clarification_needed:0.9}}),disclosures:async()=>({source:'fixture',proposals:[]})}};
let s=createSession(pack);s.candidate.text='That BMW cut in front. Remind him who you are.';command(s,{type:'accept'});
s=await adaptiveCommand(s,{type:'turn',text:'Who you are?'},config,async()=>'An automatic clarification.');
s=await adaptiveCommand(s,{type:'draft',text:s.candidate.text,direction:'Instructor says to edge closer to the back of his car.',knowledge:[]},config,generateReply);
s=await adaptiveCommand(s,{type:'retry'},config,generateReply);
console.log(JSON.stringify({automaticMode:s.candidate.responseMode,authorDirection:s.candidate.direction,reply:s.candidate.text}));
console.log('Fixture interpretation; live generation only. Saved histories unchanged.');
