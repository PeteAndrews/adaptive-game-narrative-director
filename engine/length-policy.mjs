// Speech budget only: never interpret input or change simulation state here.
export const LENGTH_POLICIES={
 MICRO:{maxWords:6,maxSentences:2,maxOutputTokens:96,constraint:'Maximum one short spoken phrase or two tiny fragments, within 6 words total. Aim for 1–6 words, preferably 2–4. Do not explain. Brief punctuation-separated reactions are valid, for example: "Right. Wait." or "Easy. That is enough."'},
 SHORT:{maxWords:15,maxSentences:1,maxOutputTokens:128,constraint:'One concise spoken sentence. Aim for 5–15 words. Do not add a second thought unless required; keep it within this single sentence.'},
 NORMAL:{maxWords:35,maxSentences:2,maxOutputTokens:192,constraint:'One or two spoken sentences. Aim for 15–35 words. Include only the necessary answer or disclosure.'},
 EXPLAIN:{maxWords:60,maxSentences:4,maxOutputTokens:320,constraint:'Explain only what genuinely requires explanation, in at most 60 words and four sentences.'},
 EXTENDED:{maxWords:150,maxSentences:10,maxOutputTokens:700,constraint:'A longer story, substantial disclosure or necessary longer answer is permitted. Maximum 150 words and ten sentences. No padding.'}
};
export const LENGTH_DEFAULTS={REACT:'MICRO',HOLD:'MICRO',REINFORCE:'MICRO',WITHDRAW:'MICRO',RECOVER:'MICRO',PROBE:'SHORT',REPAIR:'SHORT',MINIMISE:'SHORT',REFRAME:'SHORT',PRESSURE:'SHORT',ANSWER:'SHORT',DISCLOSE:'NORMAL',STORY:'EXTENDED'};
export function validateLengthOverride(value){
 if(value!=='AUTO'&&!Object.hasOwn(LENGTH_POLICIES,value))throw Error('Invalid response length policy');
}
export function selectLengthPolicy(decision,config={},tactic={}){
 if(tactic.lengthPolicy)return {id:tactic.lengthPolicy,reason:tactic.lengthReason??'Authored communication requirement'};
 const work=decision.conversational_work;
 if(work==='story'||work==='disclose')return {id:work==='story'?'EXTENDED':'NORMAL',reason:work==='story'?'Story requires sustained speech':'Substantial disclosure'};
 if(['MODERATE','HIGH'].includes(decision.explanation_need)&&decision.explanation_reason)return {id:'EXPLAIN',reason:decision.explanation_reason};
 const mode=work==='answer'?'ANSWER':decision.responseMode;
 return {id:config.lengthDefaults?.[mode]??LENGTH_DEFAULTS[mode]??'SHORT',reason:`Speech budget for ${mode??'ordinary conversation'}`};
}
export function effectiveLengthPolicy(candidate={},config={},adaptive=true){
 const override=candidate.lengthOverride??'AUTO';validateLengthOverride(override);
 const automatic=candidate.lengthPolicy??(adaptive?selectLengthPolicy(candidate,config):{id:'NORMAL',reason:'Legacy dialogue without a Director decision'});
 const id=override==='AUTO'?automatic.id:override;
 validateLengthOverride(id);
 if(id==='AUTO')throw Error('Director length must be a concrete policy');
 return {id,source:override==='AUTO'?'DIRECTOR':'AUTHOR',reason:override==='AUTO'?automatic.reason:'Author selected response length',...LENGTH_POLICIES[id],targetWords:({MICRO:[1,6],SHORT:[5,15],NORMAL:[15,35],EXPLAIN:[25,60],EXTENDED:[60,150]})[id]};
}
export function lengthInstruction(policy){
 const expanded=policy.source==='AUTHOR'&&['EXPLAIN','EXTENDED'].includes(policy.id);
 const delivery=expanded?` The author explicitly requests ${policy.id==='EXPLAIN'?'a developed explanation in two to four short spoken sentences':'sustained speech for a longer answer, story or disclosure'}. Aim for ${policy.targetWords[0]}–${policy.targetWords[1]} words. This is a delivery request, not merely permission for a larger maximum. It supersedes automatic QUICK/MICRO rhythm, minimal-reaction guidance and explanation_need NONE for this draft's spoken delivery. Develop the content requested by Author Direction, or the existing immediate response if there is no direction. Do not collapse it into a one-line acknowledgement. Preserve facts and the existing local objective unless Author Direction overrides the content. Do not add future stages, invented events or padding. Necessary clarification or repair may remain short; never invent missing information to fill the target.`:'';
 return `STRUCTURED LENGTH POLICY — ${policy.id} (${policy.source}). ${policy.constraint} Hard ceiling: ${policy.maxWords} words, ${policy.maxSentences} sentence/chunk${policy.maxSentences===1?'':'s'}. Shorter is valid; the range is not a minimum. This speech budget applies even with author direction, which controls content/performance rather than length. Never explain the Director objective to fill the budget.${delivery}`;
}
export function measureLength(text){
 const words=text.trim().split(/\s+/).filter(Boolean).length;
 // Familiar titles/initials and decimal points are not sentence boundaries.
 const spoken=text.trim().replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr)\./gi,'$1').replace(/\b([A-Z])\.(?=\s*[A-Z]\.)/g,'$1').replace(/(\d)\.(?=\d)/g,'$1');
 const sentences=spoken.match(/[^.!?]+(?:[.!?]+|$)/g)?.filter(s=>s.trim()).length??0;
 return {words,chunks:sentences};
}
export function exceedsLength(text,policy){
 const {words,chunks}=measureLength(text);
 return words>policy.maxWords||chunks>policy.maxSentences;
}
