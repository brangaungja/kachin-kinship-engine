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

## Install (current apps, local dependency)

Both Kachin-Family and Kachin-Family-Admin depend on this via a local path
for now:

```json
"kachin-kinship-engine": "file:../kachin-kinship-engine"
```

Since it's a `file:` dependency, run `npm install` in the consuming app again
after changing this package to pick up the update.

## What it computes

- **`getKinshipBoxesForPerson(speakerId, persons, relationships, kinshipRules, defaultKinshipRules)`**
  Cascades through the family tree's marriage relationships to work out
  which of the five alliance zones (Kahpu Kanau, Mayu, Dama, Mayu ni a Mayu,
  Dama ni a Dama) every clan falls into, relative to a given speaker.

- **`calculateGenerationDiff(speakerId, targetId, relationships, persons)`**
  BFS between two people; returns how many generations apart they are
  (positive = target is an ancestor-direction relative, negative =
  descendant-direction), including Mayu/Dama alliance elevation.

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
