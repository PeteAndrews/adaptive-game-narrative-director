// Opt-in billable generation-only check; interpretation is a deterministic fixture.
import {readFile} from 'node:fs/promises';
import {createSession,command} from '../engine/index.mjs';
import {adaptiveCommand} from '../engine/adaptive.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {generateReply} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8'));
const config=await readConfig();
for(const [text,choice,result] of [
 ["Okay, you're right. Let's push Mr Macchiato.",'PULL_UP_BEHIND_CAR',{scores:{compliance:0.9,humour:0.8,alignment_with_npc:0.8}}],
 ['She tells me to stand up for myself all the time but when I do...',undefined,{completion_status:'INCOMPLETE',unresolved_clause:'but when I do...',scores:{self_disclosure:0.8}}]
]){
 let s=createSession(pack);command(s,{type:'accept'});
 const interpretation={...neutral(),confidence:0.95,...result,scores:{...neutral().scores,...result.scores}};
 s=await adaptiveCommand(s,{type:'turn',text,choice},{...config,interpreter:{interpret:async()=>interpretation,disclosures:async()=>({proposals:[]})}},generateReply);
 console.log(JSON.stringify({mode:s.candidate.responseMode,tactic:s.candidate.tactic,reply:s.candidate.text,interpretationSource:'fixture/mock',generation:'live OpenAI'}));
}
