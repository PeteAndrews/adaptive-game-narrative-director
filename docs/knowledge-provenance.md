Implementation update, 7 October: the focused foundation pass is now implemented in engine/knowledge-provenance.mjs. The audit below describes the pre-normalization baseline and proposal. Current exports are version 3 and include knowledge/inferences/world records and source-event links. Acquisition uses snake_case IDs, method and attitude; missing historical origins/timestamps remain null. Final cuts, graphs and inheritance remain proposals only. See STATUS.md for the validated implementation scope.

# Knowledge persistence and provenance audit

Reviewed 7 October 2026. This is a source-based audit and proposed data contract; no engine, saved history, export or graph implementation is changed.

## Current persistence

`data/workspace.json` is the authoritative atomic snapshot: `{library, sessions}`. The internal `sessions[takeId]` records are the working takes in the UI. Each contains `id`, `sceneId` for newer takes, the original `pack` snapshot, `active` branch, `cursor`, `branches[branchId].events`, and an optional uncommitted `candidate`. The authored session ID is `take.pack.start`. There is no game ID or optional final-cut entity yet. Older stores are migration inputs only once workspace.json exists.

Projection replays only the active branch's events before its cursor. Branch creation copies the prefix, preserving event/knowledge IDs. Shared history therefore must not become duplicate learning if later projected into a graph. Other futures remain persisted but are outside the selected projection. New authored sessions/takes start from their pack knowledge; there is no automatic cross-session knowledge carry-forward.

Sources: server.mjs (`saveWorkspace`, creation routes); engine/index.mjs (`createSession`, `append`, `project`, `command`).

## Knowledge record currently stored

Illustrative record using the existing field names; these IDs are examples, not an extracted user history:

```json
{
  "id": "input-event-7:knowledge:0",
  "kind": "belief",
  "subject": "player",
  "predicate": "values",
  "value": "independence",
  "observer": "instructor",
  "source_actor": "player",
  "confidence": 0.9,
  "evidence": "without relying on others",
  "provenance": "input-event-7"
}
```

This means the instructor received an evidence-supported disclosure of the player's stated value. It is not independently verified truth and does not prove the instructor agrees with it. `confidence` describes extraction/support, not an independently calibrated probability of truth or strength of belief. Existing `kind: belief` does not consistently distinguish a speaker's reported belief from the observer endorsing that proposition.

The validator supports claim, belief, suspicion, relationship, fact, contradiction and memory. Adaptive extraction accepts claim/belief/suspicion/relationship proposals, assigns actor/observer/identity in application code, requires exact evidence plus sufficient confidence, and does not promote them to canon. Authoring and legacy paths can supply less complete metadata.

## Learning paths and event provenance

1. **Player disclosure to NPC.** An `input` event and `speech_interpretation` event precede `knowledge_proposed` and `knowledge_committed`. Both knowledge events carry `turnId`, `sourceEvent` (input ID) and actor; proposals record committed/rejected status and reason. Committed items have observer = NPC and source_actor = player. Failed, incomplete, transient, humorous or duplicate proposals remain auditable rather than silently becoming knowledge.
2. **NPC disclosure to player.** Only acceptance records the final `utterance`, followed by `npc_interpretation`, `knowledge_proposed` and `knowledge_committed`. Those events reuse the candidate turn ID and reference the final utterance. Observer = player and source_actor = NPC. Editing/regeneration does not commit draft knowledge. Player input effects/knowledge may already be saved while the answering NPC draft awaits acceptance.
3. **Starting knowledge and canon.** `pack.knowledge` initializes the projection; authored node knowledge and scripted disclosure rules can enter through utterance/input events. Initial records are not normalized into learning events and may have no ID, source actor or evidence. The instructor pack contains beliefs with provenance literally `previous lessons`; there is no event or date behind that phrase. `pack.canon` is separate writer truth and does not mean either actor knows it. Free-text character instructions can contain facts that are not explicit structured knowledge entries.
4. **Social/callback memory.** `memory_committed` carries sourceEvent and turnId. Items have observer/source_actor/evidence/provenance and stable IDs derived from the input event. Remembered slights are policy-derived memories, not neutral facts about the player. Callback memories are evidence-backed nicknames. Neither implies reciprocal awareness automatically.
5. **World claims versus facts.** `player_world_claims` events carry turnId/sourceEvent and assessments. Claims have observer, source actor, evidence, confidence and source-event provenance. Projection keeps them separately in `worldClaims`, assessed PROVISIONAL, CONFIRMED or CONTRADICTED against `worldState`. World facts come from authored opening/world events; later facts can change a claim's projected assessment. The original assessment remains in its event. NPC world assertions can appear as generic extracted claims, but there is no symmetric NPC world-claim assessment stream.
6. **Inferred player information.** `speech_interpretation` persists source, bounded scores and Jev diagnostics. `player_model_delta` stores turnId, per-turn `observations`, the next aggregate model and optional tactic evidence referencing a preceding NPC utterance. Mean/count tendencies and tactic outcomes are separate from `knowledge`. They do not consistently have observer, confidence, source input ID or premise links. They must not be treated as facts or as explicit player disclosures. NPC emotional/state updates are also separate from knowledge.
7. **Contradictions.** Configured exclusive predicates create a contradiction item linking new and old knowledge IDs, with source-event provenance and observer. Both assertions survive; there is no generalized revision/retraction/status history for all propositions. Repeated identical disclosures are rejected as Already known rather than appended as a second acquisition.

Sources: engine/adaptive.mjs (`recordKnowledge`, `acceptFinal`, `adaptiveCommand`); engine/interpretation.mjs (`adjudicate`, `supportedProposals`); engine/conversation-continuity.mjs; engine/response-mode.mjs (`salientMemory`); engine/behaviour.mjs (`playerModelUpdate`).

## Provenance available today

- **Source event:** explicit on adaptive knowledge items (`provenance`) and their enclosing events (`sourceEvent`). The knowledge commit event has its own ID, distinct from the speaking event ID.
- **Turn:** enclosing adaptive events have turnId; knowledge items generally do not. Initial/legacy/scripted entries can lack a turn. Recover it by joining the item to its commit/source events where possible.
- **Scene/authored session/working take:** derived from enclosing saved take's sceneId, pack.start and id, rather than embedded on every knowledge item. Legacy scene association may be ambiguous.
- **Branch:** implicit in event-array membership. Copied prefix events can belong to several branches; no stored branch-parent/fork metadata.
- **When learned:** recover event position/order in a given branch. There are no event timestamps or stable numbered player-turn fields. Evidence stores an exact substring but not occurrence offsets.
- **Final take:** not represented. A working take/branch is not a designated final cut, and learning origin is not the same as inclusion in a later final cut.
- **Export:** current take export v2 contains dialogue, NPC state and selected interpretation/Director diagnostics. It excludes `projection.knowledge`, proposal/commit events, world-claim ledger and player-model updates; exported dialogue also omits event/turn IDs. Local persistence is richer than the downloaded file.

## Minimal proposed additions — not implemented

Keep the existing event log and triples. Add a normalized acquisition envelope; do not replace replay storage or introduce a graph database. Preserve `observer` as the knower and `source_actor` as the speaker, distinct from the proposition subject.

```json
{
  "id": "input-event-7:knowledge:0",
  "kind": "belief",
  "subject": "player",
  "predicate": "values",
  "value": "independence",
  "observer": "instructor",
  "source_actor": "player",
  "confidence": 0.9,
  "evidence": "without relying on others",
  "provenance": "input-event-7",
  "acquisition": {
    "method": "disclosure",
    "epistemicStatus": "heard",
    "origin": {
      "sceneId": "scene-a",
      "authoredSessionId": "session-meet",
      "takeId": "take-a",
      "branchId": "main"
    },
    "sourceEventId": "input-event-7",
    "recordedEventId": "knowledge-commit-event-9",
    "turnId": "turn-3",
    "eventIndex": 9,
    "recordedAt": "2026-10-07T14:00:00.000Z",
    "evidenceSpan": {"start": 38, "end": 63},
    "extractor": {"provider": "openai", "model": "configured-model"},
    "supports": []
  }
}
```

Offsets are illustrative, zero-based and end-exclusive in the source string; validate them against the exact source text. `recordedEventId` is when the engine committed the acquisition, while `sourceEventId` is where the actor encountered the evidence. Use null for unavailable old IDs/times; do not invent historical timestamps. Add a timestamp at append for new events. Preserve original origin through branching; branch membership must be derived separately, not rewrite the learning location.

Use acquisition methods `authored`, `disclosure`, `observation`, `inference`. Use observer attitudes such as `heard`, `accepted`, `suspected`, `rejected`, `unknown` separately from assertion kind and world assessment. Default disclosure to heard, not accepted. Only supported authored/Director decisions should change an actor's attitude; do not infer acceptance just because a claim was extracted. Authored starting knowledge gets a deterministic ID scoped to pack revision/observer/proposition and `method: authored`, with its original provenance text retained as a label. Canon remains external truth; seed actor knowledge only explicitly.

For inferences, reuse the envelope with method inference, explicit observer and support references to input/interpretation/action events or knowledge IDs. Include rule/model/version and distinguish extraction confidence from a justified inference confidence; leave the latter null if unavailable. Existing player-model means are observations/aggregates, not probabilities of truth. The same shape can represent future NPC-about-player and player-about-NPC inferences without making reciprocal edges automatically.

Add evidence links for reaffirmation/revision: repeated disclosures can reference the existing assertion ID rather than become a duplicate assertion. Keep assessment/attitude changes as new events pointing to assertion IDs; optional relation types contradicts, supports, supersedes avoid overwriting history.

Add branch lineage metadata (`parentBranchId`, `forkCursor`) for newly created branches. Existing histories can expose memberships from shared event IDs without guessing lineage.

A future optional final-cut record should reference its selection, not become the original learning source:

```json
{
  "id": "final-cut-a",
  "sceneId": "scene-a",
  "authoredSessionId": "session-meet",
  "sourceTakeId": "take-a",
  "branchId": "branch-selected",
  "cursor": 142,
  "createdAt": "2026-10-07T14:30:00.000Z",
  "includedEventIds": ["input-event-7", "knowledge-commit-event-9"]
}
```

For a cut assembled from multiple sessions, use ordered selections of the same shape. Freeze the selected event content or a scoped immutable snapshot when finalizing, because working take deletion would otherwise destroy referenced evidence. Graph projection should deduplicate acquisitions by stable ID, respect cut/branch/cursor membership, and keep each observer's perspective separate. The player hearing an NPC claim does not imply the NPC knows the player believes it; higher-order awareness needs its own explicit record.

Finally, extend export with scoped `knowledge`, world claims/facts, inference observations, proposal decisions and source events. Preserve dialogue event/turn IDs and provenance joins. Include only the chosen branch/cursor, never inactive futures, and label whether this is a working export or frozen final cut. This closes the export gap without building the graph.
