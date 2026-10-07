# Dialogue Laboratory

A continuous OpenAI conversation with the fictional **Narcissistic Driving Instructor**. One authored opening, then replies to your actual questions, without automatically advancing through scene scripts.

## Start

Requires Node.js 22+. No dependency installation needed. Put your API key after `OPENAI_API_KEY=` in the local `.env` file and save. Do not commit or paste the key into chat. `.env` is ignored by Git and Docker builds and is not served by the app.

Run `npm start`, open http://localhost:3000, and select a scene and authored session in **Director**. Choose **New take**, then **Start take**. Type a question and Send. The server rereads `.env` per request, so key changes need no restart. Environment variables take precedence. `OPENAI_MODEL` defaults to `gpt-4.1-mini` and can be changed to a Responses-compatible model in your API project.

The active conversation and character instructions are sent to OpenAI through the Responses API with `store: false`. API usage is billed to your API account. Without a key, the opening works but replies show a setup error. API failures leave the session unchanged and the typed message available to retry.

## Authoring

**Scene setup** saves scenes and their authored sessions: each session has its own opening, direction, phase and optional actions. Add and select sessions in its list, or delete a session with confirmation. **Director** is the dialogue workspace, with scene/session/take selectors in Current production. It retains draft editing, regeneration, world events, state, knowledge, rewind and branches; drafts require approval. Play and the separate New conversation button have been removed. Rejected drafts and discarded branch futures never enter model context.

**Scene manager**, in the top navigation, groups scenes, authored sessions and working takes. Deleting a scene removes its sessions and associated takes; deleting one authored session removes its takes; deleting a take removes its conversation and branches. Each operation has an inline confirmation. Empty scenes remain editable. Takes are currently working dialogue histories; an optional final-cut entity and automatic chaining of authored sessions remain future work.

**Export current take** downloads only dialogue from the selected branch up to the timeline position, with identifying details, current NPC attributes, the observer-scoped knowledge/inference/world ledger with acquisition provenance and source events, and scoped per-turn state/interpretation/Jev diagnostics. Jev live/fallback status is recorded explicitly, with no credentials or new model calls. It excludes uncommitted NPC drafts, other branches and historical setup. This is a reading copy, not an importable replay archive. **Export game pack** separately downloads authored setup.

Persistence uses an atomic `data/workspace.json` snapshot containing both the scene library and takes. Existing `data/scenes.json` and `data/sessions.json` are read as migration inputs when no workspace snapshot exists; `data/continuous-pack.json` can seed the initial scene. Original files are retained. New takes carry explicit scene identity. Older histories are associated only when their scene matches uniquely; ambiguous records remain accessible as Unassigned legacy takes and are preserved during scene/session deletion. Existing take snapshots remain reproducible after setup edits.

## Architecture

- `engine/index.mjs`: deterministic state, events and branches.
- `engine/dialogue.mjs`: Responses provider, branch context and transactional generation.
- `engine/config.mjs`: server-only secrets; public status returns readiness and model only.
- `packs/continuous-lesson.json`: one scene and character instructions.
- `server.mjs`: HTTP API and atomic JSON persistence.
- `public/`: Director, Scene setup and Scene manager interfaces.

Player speech now goes through a structured LLM interpreter. Physical actions are interpreted independently from authored action mappings. Deterministic game-pack rules apply state changes, recovery, player-model observations and phase-constrained objective/tactic selection. The opening remains `PLEASANT_FACADE`; accumulated irritation cannot advance its phase. Scene setup controls the authored phase for new sessions.

The current director chooses **response mode → objective advancement → active facade → optional tactic** after committing valid player effects. REACT and HOLD are ordinary conversation; PROBE asks for missing meaning. These can have `tactic: null` and no objective advancement. MINIMISE can soften previous pressure after a safety objection. Compliance can restore a friendly facade without deleting observer-scoped remembered slights. Targets distinguish mockery of another driver from instructor disrespect. Incomplete thoughts remain unresolved, with only supported evidence stored; rejected proposals are visible in Director.

Generation context separates permanent character/voice, current performance and strongest immediate direction. Speech rules favour under-explanation and contemporary conversation over theme speeches. PROBE overrides short-rhythm restrictions on questions. Authored `temporary_modifiers` and `worldModifiers` can affect speech style; aggression never infers intoxication. Delivery metadata remains deferred. See `STATUS.md` for current verification and limitations.

Player disclosure proposals require sufficient confidence and an exact evidence span before being committed as observer-scoped claims/beliefs. Accepted NPC lines are separately interpreted for disclosures to the player. Unapproved drafts never update knowledge. Contradictions are conservatively linked for configured exclusive predicates; canon remains unchanged. Director shows proposals, decisions, sources and evidence.

The implementation records each stage of the turn as events. Regeneration preserves the previous interpretation, effects and director decision; it changes only the candidate. Editing supports author direction for the next regeneration. Timeline navigation snaps to complete command boundaries, and pending drafts are restored from events. Browser requests carry idempotency IDs so retrying a completed command cannot apply effects twice. Generation failure rolls back the whole command; interpretation/extraction failure uses a visibly labelled conservative fallback.

Saved continuous sessions gain the new policy on load; old history is not reinterpreted. Legacy `charm` and `control` states and deltas are projected as `charm_mask` and `control_need`. Existing custom character text is retained. New sessions use the updated voice guidance. All active-branch committed dialogue is supplied as context; very long conversations can hit model limits. No compaction yet. Each OpenAI call times out after 45 seconds. A normal Play turn can make three calls (interpretation, dialogue, final-line extraction), so it can take longer and cost more than the earlier prototype. Requests are serialized for this single-user prototype.

With Jev enabled, its bounded decision call adds a fourth provider request; OpenAI still extracts knowledge. A short-rhythm violation can add one correction call. Jev now supports target attribution and completion status as well as scores. `node scripts/live-response-mode.mjs` runs the five dialogue fixtures against configured providers in isolated, unsaved histories. It is billable and is never run by automated tests.

## Test

`npm test` includes deterministic praise/resistance/challenge fixtures, recovery, action/speech contradictions, knowledge provenance, actual-tactic attribution, regeneration idempotency, replay, migration and Director rendering. It never calls OpenAI. Optional billable live checks: `node scripts/live-adaptive.mjs` and `node scripts/live-disclosure.mjs`. `INTERPRETER_MODE=keyword` explicitly selects the conservative fallback for development. `npm run cli` retains the original offline scripted experiment.

## Hosting

Default: localhost only. For a trusted LAN set `HOST=0.0.0.0` and use the computer's LAN address. Always-on phone access needs deployment; not deployed yet.

```sh
docker build -t dialogue-lab .
docker run --env-file .env -p 3000:3000 -v dialogue-data:/app/data dialogue-lab
```

Use authenticated HTTPS access for public hosting: there is no built-in authentication and author controls are shared. Back up the data volume. `PORT` defaults to 3000.

## API

`GET /api/bootstrap`, `POST /api/pack`, `POST /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id`. Commands: `turn`, `world`, `accept`, `draft`, `lock`, `retry`, `seek`, `branch`, `checkout`, `checkpoint`. `autoAccept: true` on a generated turn commits the input and reply together; failure commits neither. Keys are never returned.

Reference: [OpenAI Responses text generation](https://developers.openai.com/api/docs/guides/text).

## Cumulative reaction and Jev update

The reusable reaction policy now tracks provocation, ego threat, conflict focus, incidents, insult streaks and calm turns independently of authored story phase. Repeated insults escalate through defensive, ego-threatened, hostile and mask-slipping modes; relationship humiliation can jump levels. Reaction-specific tactic eligibility and state limits override early charm. Teaching stays paused during a charged conflict, with gradual recovery after sustained calmer speech. Candidate rhythm is selected and persisted; regeneration does not reapply provocation. Director exposes reaction, remembered slight, rhythm and Jev diagnostics. Existing sessions acquire this policy for future turns; past speech is not retrospectively interpreted.

Jev adapter uses the documented https://jevtypesafeai.com/api/v1/decide gateway. Set JEV_ENABLED=true and JEV_API_KEY in .env to activate it. Without a key (or on network, HTTP or validation failure), bounded interpretation falls back to the configured OpenAI/keyword interpreter and logs the reason. Startup and each speech decision print [JEV] enabled, live API, decision and fallback used. Successful Jev decisions control stance and bounded scores; OpenAI still extracts evidence-based knowledge and writes NPC dialogue. Thus Jev currently adds a call rather than eliminating the knowledge interpretation call. Secrets stay server-side. This gateway is independently operated, as identified on its site; a key from another Jev provider is not interchangeable.

Live Jev checks with the configured gateway key have succeeded with fallback disabled. Automated mock transport tests also verify request shape, response validation, no-key behavior and fallbacks.

## Conversation continuity update

REPAIR handles likely misunderstanding before persuasion or reinforcement. Interpretation records relevance, semantic fit, misunderstanding, clarification need and intentional topic changes. Jokes and explicit topic changes do not automatically trigger repair. A repair restates the original meaning or corrects a contradicted world claim, with no tactic or objective advancement. Interpretation is probabilistic; conservative offline fallback cannot resolve every ambiguous word sense.

Reinforcement permits tiny acknowledgements and shared humour without coaching, explicit praise or declaring the player correct. Explicit shared nicknames are retained selectively as observer-scoped callback memories; recall is optional. One bounded generation correction checks short-response constraints. Literal empty provider output remains an error; silence/delivery metadata is deferred.

Authoritative world facts and player world claims are separate. Packs can define `worldState` as an array of `{subject, predicate, value}` string fields and `worldFacts` as an event-name map of those arrays. A `world` command applies authored facts; speech only records claims assessed as CONFIRMED, PROVISIONAL or CONTRADICTED. For example, `BMW_PULLS_OVER` sets `other_driver / pulled_over / true`; `BMW_MAINTAINS_POSITION` sets that value to `false`. `BMW_BRAKES` and `PLAYER_TAILGATES` also have authored facts. These are reusable event contracts for a later world/Unity integration; this prototype does not observe or simulate a live driving world. Unconfirmed claims can be used provisionally in conversation but never set world truth. Facts, claims and callbacks persist through replay and branches, and Director exposes them.

`node scripts/live-continuity.mjs` runs isolated, billable checks for misunderstanding, a deliberate topic change, confirmed/contradicted pull-over claims and nickname/compliance continuity. Automated tests remain offline. See [STATUS.md](STATUS.md) for observed results and limitations.

## Generic conversation policy

The Director now persists the minimum conversational work, explanation need and optional justification style before generation. Most turns require no explanation. Explicit requests for reasons permit more; factual questions need an answer; hypocrisy can receive a weak justification without being logically reconciled. Repair/clarification stays focused even when the player also asks why. Length ceilings allow short replies and permit longer ones only with an explanation reason.

Actor configuration belongs in `behaviour.conversation`: `stateStyles` maps state thresholds to observable behaviour; `modeFacades` and `facadeBehaviours` select presentation; `tacticBehaviours` expresses HOW a tactic behaves; `modeTactics` optionally selects a tactic for a response mode. A tactic can also author `behaviour`, `explanationNeed` (NONE/LOW/MODERATE/HIGH) or `justify`. Internal tactic objectives remain available to the Director but are not fed into spoken generation. Stable character instructions are preserved.

`justificationWeights` ranks configured styles deterministically; zero disables a style. Supported styles are MINIMISE, DENY, EXTERNALISE_BLAME, SELF_EXCEPTION, MISUNDERSTANDING_DEFENCE, BENEFICIAL_INTENT, RECIPROCITY, RETALIATION and DEFLECTION. There is no universal instructor reasoning style. Instructor defaults are in `packs/instructor-conversation.json` and embedded in its behaviour packs; saved instructor sessions acquire missing configuration on load. Custom configuration is preserved.

Generation separates stable identity, observable performance, interpreted interaction, Director decision, relevant knowledge/memory and immediate constraints. It receives behavioural cues rather than raw state numbers or tactic objectives. Short-term callback retrieval uses `callbackWindowTurns` (default 12 player inputs); explicitly mentioning an old callback can retrieve it again. Callback memory remains distinct from factual knowledge and remembered social injuries without changing event storage.

`node scripts/live-conversation-policy.mjs` is a separate, billable qualitative generation check with clearly labelled interpretation fixtures. It does not use live Jev or save sessions. Offline policy tests include a different actor with custom state and tactic names; they assert contracts rather than preferred scene-specific lines.

Question economy defaults to statements/minimal reactions. Director records `question_policy`; PROBE/REPAIR have a reason, and a tactic may author `questionReason` for deliberate probing or genuine curiosity. Questions are optional even when permitted. A response is not responsible for keeping the player talking. The existing bounded correction checks unnecessary questions and a narrow set of aphoristic constructions; general plain-speech constraints remain in the prompt.

Player-origin disclosures are retained but deferred from generation retrieval and predicate-dependent leverage for two subsequent player inputs by default (`behaviour.conversation.disclosureDelayTurns`). Later use must match the current input/topic. Lightweight callbacks are exempt. Fresh facts can be acknowledged or used to answer an explicit question, without immediate leverage. Full transcript continuity is preserved; this is a use policy, not a secrecy mechanism. Blank API output still fails; minimal acknowledgements remain valid.

## Authored scenario beats

Optional `behaviour.beatProgression` keeps the scenario's dramatic direction in the Director. It contains a private `direction` and optional `finalDesiredAction`, a `start` beat, activation/deactivation events, authored topics/patterns, and `beats`. Each beat supplies `id`, `objective`, optional `constraints`, `minTurns`, and `advance`/`retreat` rules with a target `to` and `anyScores` thresholds. Rules can also match authored events, action IDs or outcomes. An optional `decision` rule selects its `stage` when the player makes a decision; beats can set `acceptDecision`. This is one lightweight active sequence per pack.

Transitions require evidence; they do not occur every turn. Repair, probing, personal conflict and deliberate topic changes suspend direction. Holding can still answer a strategy question within the current stance, instead of rushing to the target or drifting in the opposite direction. An end event leaves progression inactive until explicit reactivation.

Only the chosen local objective and local constraints reach generation. Future beats, overall direction and final desired action stay out of its prompt. Keep those future goals out of actor/scene text as well. Current beat state is visible in Director and persists through retry, replay and branches. Instructor defaults are authored in `packs/instructor-beats.json` and embedded in its behaviour packs; migrations preserve custom progression and past events.

`node scripts/live-beat-progression.mjs` performs one isolated, billable qualitative generation check with fixture interpretation. Automated tests verify progression and prompt isolation for both the instructor and a separate negotiation fixture.

Spoken expression now favours natural chunks and fragments, including one or two short sentences. Clear decisions with no explanation need receive a generation-only ceiling of 14 words or the tighter existing limit. Clarification/repair and required explanations retain their budgets. The Director's decision and progression are unchanged. Generation must not paraphrase its objective as a thematic explanation or invent physical behaviour that contradicts recorded actions/world facts.


### Structured response length

Director decisions now persist a generic `lengthPolicy` (`id`, `reason`), independently of `ResponseMode`. Ordinary REACT/HOLD/REINFORCE/WITHDRAW turns default to MICRO; PROBE/REPAIR/MINIMISE/REFRAME/PRESSURE/ANSWER to SHORT; DISCLOSE to NORMAL and STORY to EXTENDED. An explicit explanation requirement with a reason permits EXPLAIN. Packs can customize `behaviour.conversation.lengthDefaults`; a tactic can specify `lengthPolicy` and `lengthReason` for a communication requirement.

Director's **Response length** control offers Auto, Micro, Short, Normal, Explain and Extended. Auto uses the persisted Director budget; an explicit selection overrides it for this candidate's regeneration. Author direction continues to control content/performance, but cannot bypass the structured length budget. Existing pending drafts derive a budget from their saved decision without reinterpreting input. This replaces the earlier generation-only 14-word rule and numeric rhythm guidance; historical rhythm records remain unchanged.

MICRO permits at most 6 words/one phrase or two tiny fragments; SHORT 15 words/one sentence; NORMAL 35 words/two sentences; EXPLAIN 60 words/four sentences; EXTENDED 150 words/ten sentences. Lower targets are guidance, not minimums. Concrete prompt constraints and per-policy output-token ceilings work together. A word/punctuation check permits one corrective generation; a second length violation fails the command transaction rather than clipping or saving overlong speech. Manual line editing is unrestricted. Changing length or regenerating does not repeat interpretation, state changes, beat advancement, tactic evidence or knowledge commitment. These deterministic checks constrain length; spoken naturalness still needs playtesting.

The message composer also offers **Response length** before Send in both Play and Director. Its selection is remembered in this browser until changed and applies to the first generated candidate; the automatic Director policy is preserved separately. After a failed generation, change this selection and send again. Draft regeneration can still use its own length override.

Micro corrective regeneration now receives the actual rejected draft and measured word/chunk counts, with instructions to rewrite rather than continue or truncate it. Two tiny punctuation-separated fragments are accepted within six words; a few words like “Easy. That’s enough.” no longer fail the one-chunk check. Word limits, token backstops and transactional failure after a second length violation remain enforced.

Generation treats a predicted partner/personal-contact reaction as a player claim, not permission to invent or compare that person’s behaviour. Immediate acknowledgements and small non-judgemental jokes are valid; personal leverage still requires explicit Director behaviour and disclosure timing. Internal resolve/compliance concepts stay implicit in concrete local speech. Existing REPAIR can clarify the NPC’s original meaning or briefly query the player’s actual puzzling term; it need not agree to preserve flow. These refinements leave mode selection, progression and length budgets unchanged.

Completion is conversational, not grammatical. Contextual follow-ups like “and then...” following an NPC statement request continuation, so they can retain the current local beat objective instead of selecting PROBE. Genuine unfinished disclosures, strong misunderstandings and missing context retain existing handling. Jev INCOMPLETE decisions are reconciled when existing confident semantic extraction says COMPLETE and supplies no unresolved clause; the correction is recorded/logged without another model call. Saved candidate decisions are never silently reinterpreted on retry.

Explicit author Explain/Extended selections now request developed speech rather than merely a larger maximum: Explain aims for 25-60 words in two to four sentences; Extended for 60-150 words. They supersede stale terse-generation cues while preserving the saved Director decision. A very short single-chunk attempt receives the existing corrective rewrite; targets remain soft, and necessary clarification is not padded. Auto behaviour and all upper limits remain unchanged. Changing the dropdown takes effect when you click Generate another reply.


### Saved scenes and dialogue branches

Scene setup now has a **Saved scene name**, **Save scene setup**, and **Save as new scene**. Save updates the selected scene; Save as new scene creates an independent variant. The **Saved scenes** sidebar reopens a scene for adaptation. The selected scene supplies new sessions; existing sessions keep their captured pack. The library persists in `data/scenes.json` (or the configured data directory). Existing `continuous-pack.json` seeds the library on first use; after saving, the library holds the active scene and variants.

In **Director**, click any committed dialogue line. **Restart before this line** creates a branch before that player's turn, or restores the pending NPC draft before it was committed. **Branch after this line** starts an alternate continuation after the selected line's complete command. The original future stays in its branch. Dialogue navigation restores the recorded state, knowledge and progression without replaying model calls or player effects.

**Session manager**, in the top bar after Scene setup, lists saved conversations with their scene name, short ID, current branch and recent dialogue preview. Open a session in Director, or click Delete and confirm permanent deletion. Deletion removes that session and all its branches from the saved store; scene templates and other sessions remain. Deleting the open session returns the manager to a state with no active conversation.


### Authored sessions inside a scene

In Scene setup, **Sessions in this scene** lists authored sections (the existing Tailgating entry is one). **+ Add session** adds another entry beneath it. Select an entry to edit its **Session name**, opening, optional actions, direction and starting phase. Direction/phase are stored per section, with inherited scene defaults until edited. Save scene setup preserves all entries.

**Start in Director** saves the setup and opens a working conversation at the selected authored session. Conversation snapshots inherit that section's opening/direction/phase without changing the shared scene or older conversations. New conversation/Saved conversations refer to these working histories. Sections are currently selected and developed independently; automatic linear chaining and optional final-cut Takes are not implemented yet.

## Knowledge foundation

Knowledge keeps its existing triples and event commits, with an acquisition envelope separating method from observer attitude. Hearing a disclosure defaults to heard, not accepted. New learning records preserve exact source/commit/turn/take/session/scene/branch origin and timestamps; copied branches retain original IDs. Authored starting information has stable source records. Inferences remain a separate ledger, with support links and unknown inference confidence rather than invented truth probabilities. Older histories load with unknown dates/origins left null. Export v3 includes scoped knowledge and its supporting events. Sidebar Technical details contains the underlying schema. Graphs, Writer Canon and context inheritance remain later work.
