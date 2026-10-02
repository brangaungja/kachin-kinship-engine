# kachin-kinship-engine

Core mathematical engine for Kachin kinship calculations. Extracted from the
Kachin-Family user app so it can be shared with the Kachin-Family-Admin app
(and, eventually, other consumers) instead of being kept as two hand-synced
copies.

The engine is pure computation -- no React, no Supabase, no framework
dependencies. It takes a family tree's raw `persons`/`relationships` arrays
plus admin-configured rule tables (`kinshipRules`, `termRules`,
`defaultKinshipRules`) as plain data, and returns kinship terms. All the
actual Kachin vocabulary (`Kani`, `Kawa`, `Hkau`, ...) lives in the caller's
rule data, not in this code -- the engine itself is "alliance-zone +
generation + seniority math," with the vocabulary layered on top.

## Install (pinned by commit)

Both Kachin-Family and Kachin-Family-Admin depend on this GitHub repo,
pinned to an exact commit so both apps always build the same engine:

```json
"kachin-kinship-engine": "github:brangaungja/kachin-kinship-engine#<commit-hash>"
```

To ship an engine change: push it here (CI runs the tests), update the hash
in **both** apps' `package.json`, run `npm install`, and restart the app's
dev server (Vite caches pre-bundled dependencies). Releases are tagged
(`v2.0.0`, ...) and listed in `CHANGELOG.md`; pin to a tagged commit when
you can.

## Lineage model

A person's lineage is the triple **clan + clan branch (`subClanId`) +
family name (`familyNameId`)**. Alliance-zone sets hold lineage keys
(`makeLineageKey(clanId, subClanId, familyNameId)` -> `"clan::sub::fam"`),
not bare clan ids. Two lineages are the same (`isSameLineage`) unless they
differ in clan, or *both* record a branch (or family name) and those differ:
missing data never proves a split.

## What it computes

- **`getKinshipBoxesForPerson(speakerId, persons, relationships, kinshipRules, defaultKinshipRules)`**
  Cascades through the family tree's marriage relationships to work out
  which of the five alliance zones (Kahpu Kanau, Mayu, Dama, Mayu ni a Mayu,
  Dama ni a Dama) every clan falls into, relative to a given speaker.

- **`calculateGenerationDiff(speakerId, targetId, relationships, persons)`**
  BFS between two people; returns how many generations apart they are
  (positive = target is an ancestor-direction relative, negative =
  descendant-direction), including Mayu/Dama alliance elevation. When
  several paths connect them: the shortest wins; among equally short paths,
  the one with the fewest marriage links (blood over in-law).

- **`calculateSeniority(speaker, target, relationships, persons)`**
  Returns `'older'`, `'younger'`, or `'unknown'`, including in-law
  inheritance (a relative's spouse takes on the relative's seniority when
  there's no direct birth-order/DOB comparison available).

- **`calculateKinshipTerm(speaker, target, persons, relationships, kinshipRules, termRules, ...)`**
  The main entry point. Combines the zone, generation, seniority, and both
  people's genders against the caller-supplied `termRules` table to produce
  `{ youCallThem, theyCallYou, notes, zone, generation, seniority }`.

- **`calculateAllKinshipTerms`**, **`computeAllianceZoneBoxes`**,
  **`allianceBoxesToRecords`** / **`allianceRecordsToBoxes`** -- batch/glue
  helpers built on the above, used for admin tooling (e.g. computing a whole
  tree's alliance-zone map at once).

- **`validateFamilyGraph(persons, relationships)`** -- opt-in data check.
  The functions above are tolerant (broken links are skipped, so broken data
  looks like "not related"); this returns `{ ok, issues }` listing dangling
  or unknown relationships, self-links, conflicting relationships, people
  who are their own ancestor, and warnings (duplicates, >2 parents, a
  marriage with unknown gender). It never changes a calculation.

- **`findClanConnectionPath`**, **`isSameLineage`**, **`makeLineageKey`** /
  **`parseLineageKey`**, **`zoneHasLineage`** -- lineage helpers (see above).

See `src/KinshipEngine.js` for full function signatures and inline comments
on the less obvious rules (multi-box tie-break priority, the great-grandparent
generation clamp, etc.).

## Testing

```
npm install
npm test
```

`src/KinshipEngine.test.js` covers generation/seniority math, the alliance-box
cascade (including the Mayu-ni-a-Dama/Dama-ni-a-Mayu fold-back rules), and
`calculateKinshipTerm`'s structural branches (direct relations, aunt/uncle,
in-laws, cousins, ancestor/descendant chains). Run `npm run test:watch` while
editing.

## Status

Internal-use package shared between Kachin-Family and Kachin-Family-Admin.
Not yet published or documented as a public API -- that's a deliberate future
step (API stability guarantees, licensing decision, and possibly a hosted
HTTP wrapper for non-JS consumers) not taken yet.
