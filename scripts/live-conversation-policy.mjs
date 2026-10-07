// Optional, billable qualitative generation check. Interpretation is explicitly
// a fixture; this script does not test live Jev or save any sessions.
import {readFile} from 'node:fs/promises';
import {createSession,command,project} from '../engine/index.mjs';
import {selectDirection} from '../engine/behaviour.mjs';
import {neutral} from '../engine/interpretation.mjs';
import {generateReply} from '../engine/dialogue.mjs';
import {readConfig} from '../engine/config.mjs';
const pack=JSON.parse(await readFile(new URL('../packs/continuous-lesson.json',import.meta.url),'utf8')),config=await readConfig();
for(const [label,previous,text,scores] of [
 ['ordinary reaction','Been a long morning.','You and me both.',{alignment_with_npc:0.7,humour:0.6}],
 ['why','I prefer doing it this way.','Why do you prefer that?',{explanation_request:0.9,information_request:0.8}],
 ['contradiction','I never make exceptions for anyone.','You just said you made an exception for your friend.',{contradiction_challenge:0.9,disagreement:0.5}]
]){
 const s=createSession(pack);s.candidate.text=previous;command(s,{type:'accept'});
 command(s,{type:'turn',text});const p=project(s),speech={...neutral('deterministic live-check fixture'),confidence:0.95,scores:{...neutral().scores,...scores}};
 p.audit.speech=speech;p.audit.action={outcome:'NO_RELEVANT_ACTION'};
 const decision=selectDirection(p,speech,pack.behaviour);Object.assign(s.candidate,decision);
 const reply=await generateReply(s,config);
 console.log(JSON.stringify({label,interpretation:'fixture, not live Jev',mode:decision.responseMode,tactic:decision.tactic,work:decision.conversational_work,explanationNeed:decision.explanation_need,justification:decision.justification_style,reply}));
}
console.log('Qualitative checks complete. No saved user sessions were changed.');
