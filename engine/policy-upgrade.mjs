// Add only absent policy fields. Historical events and author edits stay intact.
export function upgradeResponsePolicy(pack,defaults){
 if(pack.dialogueMode!=='continuous')return pack;
 pack.behaviour??=structuredClone(defaults);
 const b=pack.behaviour;
 if(b.npcActor===defaults.npcActor)b.conversation??=structuredClone(defaults.conversation??{});
 if(b.npcActor===defaults.npcActor&&defaults.beatProgression){b.beatProgression??=structuredClone(defaults.beatProgression);for(const event of b.beatProgression.deactivationEvents??[])pack.worldEvents[event]??=pack.start;}
 if(b.npcActor===defaults.npcActor){
  b.actionSpeechRules??=structuredClone(defaults.actionSpeechRules??[]);
  if(b.beatProgression?.id===defaults.beatProgression?.id)for(const beat of b.beatProgression?.beats??[]){const authored=defaults.beatProgression.beats.find(x=>x.id===beat.id);if(authored?.actionResponses)beat.actionResponses??=structuredClone(authored.actionResponses);}
 }
 b.reaction??=structuredClone(defaults.reaction);
 b.initialFacade??=defaults.initialFacade??'PROFESSIONAL_INSTRUCTOR';
 b.effects??={};
 for(const k of ['npc_disrespect','alignment_with_npc'])b.effects[k]??=structuredClone(defaults.effects[k]);
 b.actions??={};b.actions.PULL_UP_BEHIND_CAR??='COMPLY';
 b.entities??={other_driver:'Other driver in the current road interaction'};
 b.worldClaimRules??=structuredClone(defaults.worldClaimRules??[]);
 const facts={BMW_PULLS_OVER:[{subject:'other_driver',predicate:'pulled_over',value:'true'}],BMW_MAINTAINS_POSITION:[{subject:'other_driver',predicate:'pulled_over',value:'false'}],BMW_BRAKES:[{subject:'other_driver',predicate:'brakes',value:'true'}],PLAYER_TAILGATES:[{subject:'player',predicate:'tailgates',value:'true'}]};
 pack.worldFacts??={};
 for(const [event,values] of Object.entries(facts)){pack.worldEvents[event]??=pack.start;pack.worldFacts[event]??=values;}
 return pack;
}
