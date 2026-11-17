# Changelog

Versions follow [semantic versioning](https://semver.org/): a **major**
bump means consuming apps may need code changes, **minor** adds something
without breaking callers, **patch** is a fix.

## 2.1.7 — 2026-11-17

### Fixed
- **A same-clan family whose branch is not recorded no longer passes a
  group on.** `getKinshipBoxesForPerson` passed an alliance box on through
  any marriage of someone who *could* be of a family in the box: a missing
  branch or family name proved nothing. So when a Lahpai family (branch Ntap
  Htingnu) was Mayu, a Lahpai man whose branch was not recorded was taken
  for that family, and the family he took a wife from (Kareng) became Mayu ni
  a Mayu too, although it was only Dama. Kachin families of one clan, even of
  one family name, are often different families, and a clan is often both a
  wife-giver and a wife-taker through different families (owner). Now only
  the speaker's own side (Kahpu Kanau) passes a box on through such a match,
  since one's own records are often incomplete; every other box passes on
  only through a family that is in it by its recorded lineage. On the
  owner's staging tree this changed no kinship term (all 812 pairs) and
  removed only the groups that came through such a match.

## 2.1.6 — 2026-11-12

### Fixed
- **A wife's brother's child is Mayu.** Every child of a spouse's sibling
  was labelled "Mayu ni a Dama" (a woman speaking: "Dama ni a Mayu") and so
  took Kahpu Kanau terms, whatever the sibling's gender. A wife's brother's
  child carries the wife's clan: now Mayu ("Kanam", who answers "Kagu"). A
  wife's sister's child carries her husband's clan: Kahpu Kanau ("Kasha" /
  "Kawa"), now under that name. For a woman, a husband's brother's child is
  Dama and a husband's sister's child Dama ni a Dama (her husband's sister's
  husband already was, see J).

### Changed
- **"Mayu ni a Dama" and "Dama ni a Mayu" are no longer given.** The owner
  counts both as Kahpu Kanau ("they are us"). `resolveTermForZone` still
  folds either into Kahpu Kanau if a caller passes one.

## 2.1.5 — 2026-11-12

### Fixed
- **The husband of a Dama woman is Dama ni a Dama.** A father's sister's
  daughter's husband had no family-tree rule, so his zone came from the
  clan cascade, and when his clan was also Mayu through some other marriage
  he came out as Mayu ("Kahkau") instead of Dama ni a Dama ("Kashu", who
  calls the speaker "Ji"). A man whose wife the family tree itself shows to
  be Dama is now Dama ni a Dama, and so are the children who carry his clan,
  down the father's line. The family-tree rules are now one inner function
  (`inferStructuralZone`) so the same question can be asked about the wife.

## 2.1.4 — 2026-10-06

### Fixed
- **Two default rules that disagree could give different answers in two
  places.** `applyDefaultKinshipRulesToBoxes` ranked rules by how specific
  the target side was and then by priority; `resolveDefaultAllianceZone`
  counted both sides. So a rule written for one family of the speaker's clan
  lost, in the boxes, to a clan-wide rule with a higher priority, while the
  direct answer correctly chose it. Both now use one comparison: the more
  specific rule on speaker and target sides together wins, then priority.

## 2.1.3 — 2026-10-05

### Added
- **An order set by hand can settle what the birth dates cannot.** A date
  known only to the year or month ("1985", "1985-03") allows a range of
  days; a `birthOrder` that falls inside that range is now the person's
  place within it. Two siblings born the same full day (twins) are told
  apart by a `birthOrder` set on both. An order never overrides what the
  dates do say: outside the allowed range it is ignored, as before.
- `dobDayRange(dob)`, `siblingOrderKey(person)`,
  `compareSiblingOrder(a, b)` -- the sibling ordering the engine uses,
  exported so apps sort siblings exactly the same way.

### Fixed
- A `birthOrder` below zero lost its minus sign. Orders are anchored on the
  days-since-1970 scale, so a sibling placed before someone born before
  1970 has a negative order and was treated as the younger one.

## 2.1.2 — 2026-10-05

### Fixed
- **Fold-back rules loaded from a database were ignored.** The two rules that
  fold a "Dama of your Mayu" / "Mayu of your Dama" family into Kahpu Kanau
  were only honoured when the rule object carried `foldBack: true`. The apps
  load rules from the `kinship_rules` table, which has no such column, so
  both rules were silently dropped and anyone reached only through them (e.g.
  a mother's father's sister's husband) got no kinship term. They are now
  recognised by their shape (source zone + genders); the flag still works.

### Added
- `isFoldBackRule(rule)`.

## 2.1.1 — 2026-10-05

### Added
- `findClanConnectionPath` takes an optional eighth argument,
  `targetLineageGroup`, to trace to one family among several with the same
  recorded lineage (existing calls are unchanged).

## 2.1.0 — 2026-10-05

### Added
- **A marriage always creates the Mayu / Dama tie, even between two families
  of the same clan.** `markMarriageSeparatedLineages(persons, relationships)`
  marks the two families joined by a marriage that recorded lineage alone
  cannot tell apart (same clan, and no differing branch / family name
  recorded on both sides) with a `lineageGroup`. Call it once on a tree's
  people and pass the result to the other functions. Before this, such a
  marriage produced no Mayu / Dama tie at all: the wife's family looked like
  the husband's own.
- `isSameLineage` treats two different `lineageGroup` markers as different
  lineages (a missing marker, like a missing branch, proves nothing).
- `makeLineageKey` takes an optional fourth argument and `parseLineageKey`
  returns `lineageGroup` when a key has one; `lineageKeyOf(person)` builds a
  person's key. Three-part keys are unchanged, so stored entries and existing
  callers keep working.

### Unchanged
- Callers that don't use `markMarriageSeparatedLineages` get exactly the
  2.0.0 results, and so does any tree without such a marriage (the function
  then returns the same array it was given).

## 2.0.0 — 2026-10-02

### Breaking
- **Lineage-aware alliance zones.** Zone sets returned by
  `getKinshipBoxesForPerson` (and used across the engine) now hold lineage
  keys from `makeLineageKey(clanId, subClanId, familyNameId)` instead of bare
  clan ids, so two families of the same clan with different Clan Branches or
  Family Names can sit in different zones. Use `parseLineageKey` /
  `zoneHasLineage` instead of `boxes[zone].has(clanId)`.
  `allianceBoxesToRecords` / `allianceRecordsToBoxes` records gain
  `subClanId` / `familyNameId`.

### Added
- `makeLineageKey`, `parseLineageKey`, `isSameLineage`, `zoneHasLineage`.
- `findClanConnectionPath` accepts optional `targetSubClanId` /
  `targetFamilyNameId` (existing 5-argument calls are unchanged).
- Default kinship rules can target a branch/family; the most specific
  matching rule wins.
- `validateFamilyGraph(persons, relationships)`: an opt-in check that
  reports data problems the tolerant calculations silently skip.

### Fixed
- Alliance-zone propagation runs to a fixed point. A cap of 10 passes
  silently truncated long marriage cascades.
- `calculateGenerationDiff` resolves equally short paths deterministically,
  preferring the fewest marriage links (blood over in-law), instead of
  depending on the order relationships were stored.
- `findClanConnectionPath` no longer lists the matched person twice.
- `areSiblings`: removed a malformed, never-true comparison (no behavior
  change for valid data).

## 1.0.0

Initial extraction of the engine from the Kachin-Family app (clan-only
alliance zones). Not tagged at the time.
