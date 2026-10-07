// Transient emotional escalation is independent of authored story progression.
// All trigger rules, thresholds, effects and permitted responses come from a pack.
const unit=x=>Math.max(0,Math.min(1,x));
export function initialReaction(policy){return {mode:policy?.levels?.[0]?.id??'CALM',provocation:0,egoThreat:0,conflictFocus:0,incidents:0,streak:0,calmTurns:0,lastTrigger:null,teachingPaused:false};}
export function updateReaction(previous,speech,text,policy){
  if(!policy)return previous;
  const r={...initialReaction(policy),...previous},scores=speech.scores;
  let severity=0;const contributions=[];
  for(const [key,weight] of Object.entries(policy.weights)){const value=(scores[key]??0)*speech.confidence*weight;severity+=value;if(value>0.01)contributions.push({signal:key,value});}
  const matches=[];
  const attackEvidence=Math.max(scores.insult??0,scores.hostility??0,scores.personal_attack??0,scores.relationship_attack??0);
  // Do not turn quoted/rejected insults or neutral questions into attacks when
  // a confident interpreter found no hostile intent. Text rules strengthen an
  // observed attack, or provide a conservative signal during weak fallback.
  for(const rule of policy.triggers??[]){const m=text.match(new RegExp(rule.pattern,'i'));if(m&&(attackEvidence>=0.3||speech.confidence<0.5)){severity=Math.max(severity,rule.minimum);matches.push({id:rule.id,evidence:m[0],sensitive:rule.sensitive===true});}}
  severity=unit(severity);const provoked=severity>=policy.incidentThreshold;
  const friendly=Math.max(scores.praise??0,scores.apology??0,scores.compliance??0,scores.alignment_with_npc??0)*speech.confidence>0.5;
  const decay=provoked?policy.decay.provoked:friendly?policy.decay.friendly:policy.decay.neutral;
  r.provocation=unit(r.provocation*decay+severity+(provoked?Math.min(r.streak,3)*policy.repeatBonus:0));
  r.egoThreat=unit(r.egoThreat*decay+severity*policy.egoGain);
  r.conflictFocus=unit(r.conflictFocus*decay+(provoked?severity*policy.focusGain:0));
  r.incidents+=Number(provoked);r.streak=provoked?r.streak+1:0;r.calmTurns=provoked?0:r.calmTurns+1;
  if(provoked)r.lastTrigger={text,severity,contributions,matches};
  const current=Math.max(0,policy.levels.findIndex(l=>l.id===r.mode));let index=current;
  // A sufficiently strong personal attack can cross several levels in one turn.
  for(let i=current+1;i<policy.levels.length;i++)if(r.provocation>=policy.levels[i].enter)index=i;
  if(index===current&&r.calmTurns>=policy.calmTurnsToRelease&&index>0&&r.provocation<policy.levels[index].exit)index--;
  r.mode=policy.levels[index].id;r.teachingPaused=index>=policy.pauseAtLevel;
  return {...r,lastEvaluation:{severity,provoked,friendly,contributions,matches,from:previous?.mode??policy.levels[0].id,to:r.mode}};
}
export function reactionStateChanges(state,changes,reaction,policy,speech,action){
  if(!policy)return changes;
  const result=structuredClone(changes),level=policy.levels.find(l=>l.id===reaction.mode);
  if(reaction.lastEvaluation.provoked)for(const [key,weight] of Object.entries(policy.stateEffects??{})){
    const previous=state[key]??0,value=unit((result[key]?.value??previous)+reaction.lastEvaluation.severity*weight);
    result[key]={previous,delta:value-previous,value};
  }
  // Apply activation limits after the story phase limits; they allow its mask to slip.
  for(const [key,[low,high]] of Object.entries(level.limits??{})){
    const previous=state[key]??0,value=Math.max(low,Math.min(high,result[key]?.value??previous));
    result[key]={previous,delta:value-previous,value};
  }
  if(!reaction.lastEvaluation.provoked&&(action?.outcome==='COMPLY'||(speech?.scores.compliance??0)>0.6||(reaction.lastEvaluation.friendly&&speech?.scores.apology>0.5))){
    for(const [key,delta] of Object.entries({charm_mask:0.2,rapport:0.07,anger:-0.12,authority_threat:-0.12})){
      const previous=state[key]??0,value=unit((result[key]?.value??previous)+delta);result[key]={previous,delta:value-previous,value};
    }
  }
  return result;
}
export function responseRhythm(p,speech,policy){
  const reactionPolicy=policy.reaction,level=reactionPolicy?.levels.find(l=>l.id===p.reaction?.mode);
  const allowed=level?.rhythms??policy.rhythms??['CONCISE','QUICK'];
  const previous=p.transcript.findLast(e=>e.type==='utterance')?.rhythm?.id;
  const count=p.transcript.filter(e=>e.type==='input').length;
  const options=allowed.filter(id=>id!==previous);const id=(options.length?options:allowed)[count%(options.length||allowed.length)];
  const specs=reactionPolicy?.rhythmDefinitions??{};
  return {id,guidance:specs[id]??'A natural spoken response; vary length. Do not routinely end with a question.'};
}
