/**
 * Core Mathematical Engine for Kachin Kinship Calculations
 */

// A person's "lineage identity" for alliance-zone purposes is NOT just their
// Clan -- two people can share a Clan name but belong to different Clan
// Branches (sub-clans) and/or Family Names, and are culturally distinct
// lineages that can legitimately marry each other (e.g. a father and mother
// both clan "Marip" but different branch/family). The engine used to key
// everything by bare clanId, which silently merged such pairs into one
// lineage and dropped one side out of its real Mayu/Dama zone. These helpers
// key by the full (clan, sub-clan, family name) triple instead.
export const LINEAGE_KEY_SEP = '::';

// `lineageGroup` is an optional fourth part: a marker that two families are
// known to be different lineages because a marriage links them, even when
// their recorded clan / branch / family name are identical (see
// markMarriageSeparatedLineages below). Keys without one are unchanged
// three-part keys, so stored manual entries and older callers keep working.
export const makeLineageKey = (clanId, subClanId = null, familyNameId = null, lineageGroup = null) =>
  `${clanId}${LINEAGE_KEY_SEP}${subClanId || ''}${LINEAGE_KEY_SEP}${familyNameId || ''}`
  + (lineageGroup ? `${LINEAGE_KEY_SEP}${lineageGroup}` : '');

/** The lineage key of a person (or any object with the lineage fields). */
export const lineageKeyOf = (person) =>
  makeLineageKey(person.clanId, person.subClanId, person.familyNameId, person.lineageGroup);

export const parseLineageKey = (key) => {
  const [clanId, subClanId, familyNameId, lineageGroup] = String(key).split(LINEAGE_KEY_SEP);
  return {
    clanId: clanId || null,
    subClanId: subClanId || null,
    familyNameId: familyNameId || null,
    ...(lineageGroup ? { lineageGroup } : {}),
  };
};

// Two lineages count as "the same" only when they share a clan and nothing
// proves them apart. Missing branch/family data on either side is never
// treated as proof of a split -- a person whose branch hasn't been recorded
// yet must keep behaving exactly like the old clan-only engine, not get
// silently forked into an unintended extra zone.
export const isSameLineage = (a, b) => {
  const aClan = a?.clanId ?? null;
  const bClan = b?.clanId ?? null;
  if (!aClan || !bClan || aClan !== bClan) return false;
  const aSub = a?.subClanId ?? null;
  const bSub = b?.subClanId ?? null;
  if (aSub && bSub && aSub !== bSub) return false;
  const aFam = a?.familyNameId ?? null;
  const bFam = b?.familyNameId ?? null;
  if (aFam && bFam && aFam !== bFam) return false;
  // Two families a marriage has shown to be different lineages stay
  // different, whatever their recorded names. Like the fields above, a
  // missing marker on either side proves nothing.
  const aGroup = a?.lineageGroup ?? null;
  const bGroup = b?.lineageGroup ?? null;
  if (aGroup && bGroup && aGroup !== bGroup) return false;
  return true;
};

// Lineage-aware replacement for `zoneSet.has(person.clanId)` -- does any
// lineage key already in this zone's Set represent the same lineage as
// `person`?
export const zoneHasLineage = (zoneSet, person) => {
  if (!zoneSet || !person?.clanId) return false;
  for (const key of zoneSet) {
    if (isSameLineage(parseLineageKey(key), person)) return true;
  }
  return false;
};

// Does a default-rule's speaker/target side match a given lineage? A rule
// field left blank is a wildcard for that dimension (a clan-wide rule
// applies to every branch); a rule field that IS set only matches a person
// confirmed to be in that exact branch/family, not someone whose branch is
// simply unknown -- a deliberately scoped admin override shouldn't silently
// swallow people with incomplete data.
const ruleSideMatches = (rule, prefix, lineage) => {
  const clanId = rule[`${prefix}ClanId`] ?? rule[`${prefix}_clan_id`] ?? null;
  if (clanId !== (lineage?.clanId ?? null)) return false;
  const subClanId = rule[`${prefix}SubClanId`] ?? rule[`${prefix}_sub_clan_id`] ?? null;
  if (subClanId && subClanId !== lineage?.subClanId) return false;
  const familyNameId = rule[`${prefix}FamilyNameId`] ?? rule[`${prefix}_family_name_id`] ?? null;
  if (familyNameId && familyNameId !== lineage?.familyNameId) return false;
  return true;
};

// How specifically a rule targets one side (0 = clan-wide, up to 2 = exact
// branch + family) -- used so a deliberately narrow override always wins
// over a broader clan-wide rule for the same pair, regardless of priority.
const ruleSideSpecificity = (rule, prefix) => {
  let score = 0;
  if (rule[`${prefix}SubClanId`] ?? rule[`${prefix}_sub_clan_id`]) score += 1;
  if (rule[`${prefix}FamilyNameId`] ?? rule[`${prefix}_family_name_id`]) score += 1;
  return score;
};

// Normalizes either a bare clanId string (old call style, still supported)
// or a full {clanId, subClanId, familyNameId} lineage object.
const asLineage = (speaker) => (typeof speaker === 'string' ? { clanId: speaker } : speaker);

/** Apply explicit speaker-lineage → target-lineage → zone rules (most specific + highest priority wins per target). */
export const applyDefaultKinshipRulesToBoxes = (speaker, boxes, defaultRules = []) => {
  const speakerLineage = asLineage(speaker);
  if (!speakerLineage?.clanId || !defaultRules?.length) return boxes;

  const byTarget = new Map();
  [...defaultRules]
    .filter((r) => ruleSideMatches(r, 'speaker', speakerLineage))
    .sort((a, b) => {
      const specDiff = ruleSideSpecificity(b, 'target') - ruleSideSpecificity(a, 'target');
      if (specDiff !== 0) return specDiff;
      return (b.priority ?? 0) - (a.priority ?? 0);
    })
    .forEach((rule) => {
      const targetClanId = rule.targetClanId ?? rule.target_clan_id;
      const targetSubClanId = rule.targetSubClanId ?? rule.target_sub_clan_id ?? null;
      const targetFamilyNameId = rule.targetFamilyNameId ?? rule.target_family_name_id ?? null;
      const zone = rule.defaultAlliance ?? rule.default_alliance;
      if (!targetClanId || !zone) return;
      const targetKey = makeLineageKey(targetClanId, targetSubClanId, targetFamilyNameId);
      if (byTarget.has(targetKey)) return;
      byTarget.set(targetKey, zone);
    });

  byTarget.forEach((zone, targetKey) => {
    const targetLineage = parseLineageKey(targetKey);
    if (isSameLineage(targetLineage, speakerLineage)) return;
    if (!boxes[zone]) boxes[zone] = new Set();
    boxes[zone].add(targetKey);
  });

  return boxes;
};

export const resolveDefaultAllianceZone = (speaker, target, defaultRules = []) => {
  const speakerLineage = asLineage(speaker);
  const targetLineage = asLineage(target);
  if (!speakerLineage?.clanId || !targetLineage?.clanId || !defaultRules?.length) return null;

  const match = [...defaultRules]
    .filter((r) => ruleSideMatches(r, 'speaker', speakerLineage) && ruleSideMatches(r, 'target', targetLineage))
    .sort((a, b) => {
      const specDiff = (ruleSideSpecificity(b, 'speaker') + ruleSideSpecificity(b, 'target'))
        - (ruleSideSpecificity(a, 'speaker') + ruleSideSpecificity(a, 'target'));
      if (specDiff !== 0) return specDiff;
      return (b.priority ?? 0) - (a.priority ?? 0);
    })[0];

  return match?.defaultAlliance ?? match?.default_alliance ?? null;
};

const isMale = (person) => person?.gender === 'Male' || person?.gender === 'M';

/**
 * "Whatever clan marries into the family is Mayu, whether or not it has the
 * same clan name."
 *
 * Alliance zones are worked out from recorded lineage (clan, branch, family
 * name), and missing data is never taken as proof that two people are
 * different lineages. On its own that loses a marriage between two families
 * whose recorded lineage is the same -- both "Marip" with no branch recorded,
 * say: the wife's family looks like the husband's own, so no Mayu / Dama tie
 * is created. But people do not marry within their own lineage, so the
 * marriage itself is the proof the two families are different.
 *
 * This returns `persons` with a `lineageGroup` marker on everyone in two
 * such families, so the rest of the engine keeps them apart. A family here
 * is a patriline as recorded in the tree: people joined by father-to-child
 * and sibling links (a child belongs to the father's line, not the
 * mother's).
 *
 * Only families joined by a marriage that recorded lineage alone could not
 * tell apart are marked. Everyone else is returned untouched, and when
 * nothing needs marking the very same array is returned -- so trees without
 * such a marriage behave exactly as before.
 *
 * Call it once on a tree's people before any other engine function, and use
 * the result (including for the speaker / root person) everywhere.
 *
 * Not separated: a husband and wife who are in the SAME recorded patriline
 * (e.g. children of two brothers). The tree itself says they are one
 * lineage, so there is nothing to tell apart.
 */
export const markMarriageSeparatedLineages = (persons = [], relationships = []) => {
  const byId = new Map(persons.map((p) => [p.id, p]));

  // Union-find over person ids: one set per recorded patriline.
  const parentOf = new Map(persons.map((p) => [p.id, p.id]));
  const find = (id) => {
    let root = id;
    while (parentOf.get(root) !== root) root = parentOf.get(root);
    let cursor = id;
    while (parentOf.get(cursor) !== root) {
      const next = parentOf.get(cursor);
      parentOf.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  // Smaller id becomes the representative, so the marker doesn't depend on
  // the order relationships happen to be stored in.
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (String(ra) < String(rb)) parentOf.set(rb, ra);
    else parentOf.set(ra, rb);
  };

  relationships.forEach((rel) => {
    const p1 = byId.get(rel.person1Id);
    const p2 = byId.get(rel.person2Id);
    if (!p1 || !p2 || !isSameLineage(p1, p2)) return;
    if (rel.type === 'sibling') union(p1.id, p2.id);
    // person1 is the parent; only a father passes his lineage on.
    if (rel.type === 'parent' && isMale(p1)) union(p1.id, p2.id);
  });

  const marked = new Set();
  relationships.forEach((rel) => {
    if (rel.type !== 'spouse') return;
    const p1 = byId.get(rel.person1Id);
    const p2 = byId.get(rel.person2Id);
    if (!p1 || !p2 || !isSameLineage(p1, p2)) return;
    const g1 = find(p1.id);
    const g2 = find(p2.id);
    if (g1 === g2) return;
    marked.add(g1);
    marked.add(g2);
  });

  if (marked.size === 0) return persons;
  return persons.map((p) => {
    const group = find(p.id);
    return marked.has(group) ? { ...p, lineageGroup: `m:${group}` } : p;
  });
};

export const DEFAULT_KINSHIP_BOX_RULES = [
  { sourceBox: 'Kahpu Kanau', targetBox: 'Mayu', sourceGender: 'Male', targetGender: 'Female' },
  { sourceBox: 'Kahpu Kanau', targetBox: 'Dama', sourceGender: 'Female', targetGender: 'Male' },
  { sourceBox: 'Mayu', targetBox: 'Mayu ni a Mayu', sourceGender: 'Male', targetGender: 'Female' },
  { sourceBox: 'Dama', targetBox: 'Dama ni a Dama', sourceGender: 'Female', targetGender: 'Male' },
  // Mayu ni a Dama / Dama ni a Mayu don't get a box of their own -- the marriage
  // chain loops back to the speaker's own side, so both fold into Kahpu Kanau
  // (see the elder-verification dossier's own documented remark on this).
  // `foldBack` lets the Kahpu Kanau guard in getKinshipBoxesForPerson's
  // tryMatch allow through only these two known-correct cascades, not an
  // arbitrary future rule targeting Kahpu Kanau.
  //
  // A Mayu-zone woman marrying out (e.g. mother's sister) makes her husband's
  // clan a wife-taker OF one of our Mayu clans -- "the Dama of my Mayu",
  // i.e. Dama ni a Mayu ("a wife-taker of one of your wife-givers").
  { sourceBox: 'Mayu', targetBox: 'Kahpu Kanau', sourceGender: 'Female', targetGender: 'Male', foldBack: true },
  // A Dama-zone man marrying in makes her clan a wife-giver TO one of our
  // Dama clans -- "the Mayu of my Dama", i.e. Mayu ni a Dama ("a wife-giver
  // of one of your wife-takers").
  { sourceBox: 'Dama', targetBox: 'Kahpu Kanau', sourceGender: 'Male', targetGender: 'Female', foldBack: true },
];

// 1. Calculate Alliance Boxes relative to ANY speaker
export const getKinshipBoxesForPerson = (
  speakerId,
  persons,
  relationships,
  kinshipRules = DEFAULT_KINSHIP_BOX_RULES,
  defaultKinshipRules = null,
) => {
  const effectiveKinshipRules = (kinshipRules && kinshipRules.length > 0) ? kinshipRules : DEFAULT_KINSHIP_BOX_RULES;
  const rootPerson = persons.find(p => p.id === speakerId);
  const rootClanId = rootPerson?.clanId;

  const boxes = {
    'Kahpu Kanau': new Set(),
    'Mayu': new Set(),
    'Dama': new Set(),
    'Mayu ni a Mayu': new Set(),
    'Dama ni a Dama': new Set()
  };

  if (!rootClanId) return boxes;
  boxes['Kahpu Kanau'].add(lineageKeyOf(rootPerson));

  // Propagate to a fixed point. Each pass can only ADD lineage keys to the
  // zone sets, and there are finitely many (zone, lineage) pairs, so the loop
  // always terminates -- no iteration cap needed. (A former cap of 10 passes
  // silently truncated long marriage cascades.)
  let added = false;

  do {
    added = false;

    effectiveKinshipRules.forEach(rule => {
      const sourceLineages = boxes[rule.sourceBox];
      if (!sourceLineages || sourceLineages.size === 0) return;

      relationships.filter(r => r.type === 'spouse').forEach(rel => {
        const p1 = persons.find(p => p.id === rel.person1Id);
        const p2 = persons.find(p => p.id === rel.person2Id);
        if (!p1 || !p2) return;

        const tryMatch = (sourceP, targetP) => {
          // The core bug this engine was shipping: comparing bare clanId
          // meant a same-clan-different-branch spouse (e.g. mother also
          // clan "Marip" but a different branch than the root) could never
          // enter Mayu/Dama at all, since her clanId always equaled the
          // root's. isSameLineage only excludes a spouse CONFIRMED to be
          // the same lineage, not merely the same clan name. (A spouse whose
          // recorded lineage is identical to the root's is told apart by
          // markMarriageSeparatedLineages, when the caller has applied it.)
          if (zoneHasLineage(sourceLineages, sourceP) &&
             (rule.sourceGender === 'Any' || sourceP.gender === rule.sourceGender) &&
             (rule.targetGender === 'Any' || targetP.gender === rule.targetGender) &&
             targetP.clanId && !isSameLineage(targetP, rootPerson)) {

              // In Kachin culture, Kahpu Kanau alliance box is strictly for the root clan,
              // explicit agnatic brother clans, and the Mayu-ni-a-Dama / Dama-ni-a-Mayu
              // fold-back cascades (marked `foldBack` above) -- any other rule that would
              // add a non-root lineage to Kahpu Kanau is still blocked.
              if (rule.targetBox === 'Kahpu Kanau' && !isSameLineage(targetP, rootPerson) && !rule.foldBack) {
                return;
              }

              if (!boxes[rule.targetBox]) boxes[rule.targetBox] = new Set();

              const targetKey = lineageKeyOf(targetP);
              if (!boxes[rule.targetBox].has(targetKey)) {
                 boxes[rule.targetBox].add(targetKey);
                 added = true;
              }
          }
        };

        tryMatch(p1, p2);
        tryMatch(p2, p1);
      });
    });
  } while (added);

  if (defaultKinshipRules?.length) {
    applyDefaultKinshipRulesToBoxes(rootPerson, boxes, defaultKinshipRules);
  }

  return boxes;
};


/**
 * Shared adjacency-list builder for the two BFS traversals below. Both used to
 * build their own near-identical copy of this from `relationships` -- kept in
 * sync only by developer discipline, not by the code. Edge types are lowercase
 * ('child'/'parent'/'spouse'/'sibling'); callers that need a display label
 * (e.g. `findClanConnectionPath`'s educational trace) format it at the point
 * of use rather than duplicating the graph construction with different casing.
 */
const buildRelationshipAdjacency = (relationships) => {
  const graph = {};
  const addEdge = (from, to, type) => {
    if (!graph[from]) graph[from] = [];
    graph[from].push({ to, type });
  };

  relationships.forEach(rel => {
    if (rel.type === 'parent') {
      // person1 is Parent, person2 is Child
      addEdge(rel.person1Id, rel.person2Id, 'child'); // Down a generation
      addEdge(rel.person2Id, rel.person1Id, 'parent');  // Up a generation
    } else if (rel.type === 'spouse') {
      addEdge(rel.person1Id, rel.person2Id, 'spouse');
      addEdge(rel.person2Id, rel.person1Id, 'spouse');
    } else if (rel.type === 'sibling') {
      addEdge(rel.person1Id, rel.person2Id, 'sibling');
      addEdge(rel.person2Id, rel.person1Id, 'sibling');
    }
  });

  return graph;
};

// 2. Graph Traversal for Generation Difference
//
// Shortest-path BFS that tracks generation steps plus Mayu/Dama elevation.
// Path precedence when the target is reachable by more than one path:
//   1. fewest links (shortest path) -- as before;
//   2. among equally short paths, the fewest marriage (spouse) links, i.e. a
//      blood relationship wins over an in-law one;
//   3. any remaining tie keeps relationship order (the old behavior).
// Before, only rule 1 existed: visited-by-person-id kept whichever equally
// short path happened to be explored first, so two paths with different
// generation weights could give an order-dependent answer. The search runs
// level by level and keeps every distinct (person, counters) state within a
// level, so all equally short paths to the target are compared.
export const calculateGenerationDiff = (speakerId, targetId, relationships, persons = []) => {
  if (speakerId === targetId) return 0;

  const graph = buildRelationshipAdjacency(relationships);
  const isMale = (p) => p?.gender === 'M' || p?.gender === 'Male';
  const isFemale = (p) => p?.gender === 'F' || p?.gender === 'Female';
  const personById = new Map(persons.map(p => [p.id, p]));

  let frontier = [{ id: speakerId, parentLinks: 0, childLinks: 0, mayuHops: 0, damaHops: 0, spouseLinks: 0 }];
  // People whose shortest distance is already known (reached on an earlier level).
  const settled = new Set([speakerId]);

  while (frontier.length > 0) {
    const hits = frontier.filter(state => state.id === targetId);
    if (hits.length > 0) {
      const best = hits.reduce((a, b) => (b.spouseLinks < a.spouseLinks ? b : a));
      const genWeight = best.parentLinks - best.childLinks;
      const mayuElevation = Math.max(0, best.mayuHops - 1);
      const damaElevation = Math.max(0, best.damaHops - 1);
      return genWeight + mayuElevation - damaElevation;
    }

    const next = [];
    const seenStates = new Set();
    const reachedThisLevel = new Set();
    for (const current of frontier) {
      for (const neighbor of graph[current.id] || []) {
        if (settled.has(neighbor.to)) continue;

        const nextState = { ...current, id: neighbor.to };
        if (neighbor.type === 'parent') nextState.parentLinks++;
        if (neighbor.type === 'child') nextState.childLinks++;
        if (neighbor.type === 'spouse') {
          nextState.spouseLinks++;
          const fromPerson = personById.get(current.id);
          const toPerson = personById.get(neighbor.to);
          if (isMale(fromPerson) && isFemale(toPerson)) nextState.mayuHops++;
          else if (isFemale(fromPerson) && isMale(toPerson)) nextState.damaHops++;
        }

        const key = `${nextState.id}|${nextState.parentLinks}|${nextState.childLinks}|${nextState.mayuHops}|${nextState.damaHops}|${nextState.spouseLinks}`;
        if (seenStates.has(key)) continue;
        seenStates.add(key);
        next.push(nextState);
        reachedThisLevel.add(neighbor.to);
      }
    }
    reachedThisLevel.forEach(id => settled.add(id));
    frontier = next;
  }

  // Fallback if disconnected
  return null;
};

// 2.5 Educational Path Tracing (Max Depth 6). targetSubClanId/targetFamilyNameId
// are optional -- when omitted, matches any branch/family of targetClanId
// (old behavior, unchanged); when supplied, only a person confirmed to be
// in that exact branch/family satisfies the search. targetLineageGroup
// (optional) narrows it further to one family among several with the same
// recorded lineage -- see markMarriageSeparatedLineages.
export const findClanConnectionPath = (speakerId, targetClanId, relationships, persons, maxDepth = 6, targetSubClanId = null, targetFamilyNameId = null, targetLineageGroup = null) => {
  if (!speakerId || !targetClanId) return null;

  const graph = buildRelationshipAdjacency(relationships);
  const displayLabel = (type) => type.charAt(0).toUpperCase() + type.slice(1);
  const targetLineage = { clanId: targetClanId, subClanId: targetSubClanId, familyNameId: targetFamilyNameId, lineageGroup: targetLineageGroup };

  const queue = [{ id: speakerId, depth: 0, path: [] }];
  const visited = new Set([speakerId]);

  while (queue.length > 0) {
    const { id, depth, path } = queue.shift();
    const currentPerson = persons.find(p => p.id === id);

    // If we found someone in the target clan (and they are not the speaker),
    // `path` already ends with an entry for this exact person -- whichever
    // neighbor-queue push reached them already recorded their real relation
    // (Parent/Spouse/Sibling/Child). Appending another entry for the same
    // person under a generic "Target Clan Member" label used to duplicate
    // them in the returned chain; the real relation already explains how
    // they connect, so just return the path as traced.
    if (currentPerson && id !== speakerId && isSameLineage(currentPerson, targetLineage)) {
      return path;
    }

    if (depth >= maxDepth) continue;

    if (graph[id]) {
      for (const neighbor of graph[id]) {
        if (!visited.has(neighbor.to)) {
          visited.add(neighbor.to);
          const nextPerson = persons.find(p => p.id === neighbor.to);
          queue.push({
            id: neighbor.to,
            depth: depth + 1,
            path: path.concat({ person: nextPerson, relation: displayLabel(neighbor.type) })
          });
        }
      }
    }
  }

  return null; // No connection found within max depth
};


export const areSiblings = (p1Id, p2Id, relationships = []) => {
  if (!p1Id || !p2Id || p1Id === p2Id) return false;
  const direct = relationships.some(r => r.type === 'sibling' && (
    (r.person1Id === p1Id && r.person2Id === p2Id)
    || (r.person1Id === p2Id && r.person2Id === p1Id)
  ));
  if (direct) return true;
  const p1Parents = relationships.filter(r => r.type === 'parent' && r.person2Id === p1Id).map(r => r.person1Id);
  const p2Parents = relationships.filter(r => r.type === 'parent' && r.person2Id === p2Id).map(r => r.person1Id);
  return p1Parents.length > 0 && p1Parents.some(parentId => p2Parents.includes(parentId));
};

// Same day-scale DOB/birth-order unification the app's own sibling reorder
// UI uses (see the app's genealogyRules.js -- getSiblingOrderKey): a DOB
// converts to a day-number and always outranks a manual birthOrder guess;
// a manual birthOrder is anchored onto that same numeric scale by the app's
// own reorder flow whenever a dated sibling exists in the group, so an
// undated and a dated sibling remain meaningfully comparable here. Only
// valid for comparing two people WITHIN the same sibling group -- birthOrder
// alone has no shared meaning across two unrelated sibling groups, which is
// why general (non-sibling) comparisons below stay DOB-only.
const MS_PER_DAY = 86400000;
const getSiblingOrderKey = (p) => {
  if (!p) return null;
  if (p.dob) {
    const ms = new Date(p.dob).getTime();
    if (Number.isFinite(ms)) return Math.floor(ms / MS_PER_DAY);
  }
  const raw = p.birthOrder ?? p.birth_order ?? p.birth_order_num ?? p.birthOrderNum;
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).replace(/[^0-9]/g, '');
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) ? num : null;
};

// 3. Seniority Calculation
export const calculateSeniority = (
  speaker,
  target,
  relationships = [],
  persons = [],
  visitedSpouses = new Set(),
  visitedSiblingChain = new Set(),
) => {
  if (!speaker || !target || speaker.id === target.id) return 'unknown';

  // A. Check if target is a sibling of speaker's spouse (Wife's Sister / Wife's Brother / Husband's Sister)
  const speakerSpouseIds = relationships
    .filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id))
    .map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

  for (const spouseId of speakerSpouseIds) {
    const spouse = persons.find(p => p.id === spouseId);
    if (!spouse) continue;

    // Check if target is a sibling of this spouse (explicit sibling or shared parents)
    const isSpouseSibling = areSiblings(spouseId, target.id, relationships);
    if (isSpouseSibling) {
      const targetKey = getSiblingOrderKey(target);
      const spouseKey = getSiblingOrderKey(spouse);
      if (targetKey !== null && spouseKey !== null && targetKey !== spouseKey) {
        return targetKey > spouseKey ? 'younger' : 'older';
      }
    }
  }

  // B. Check if target is a direct sibling of speaker
  const isDirectSibling = areSiblings(speaker.id, target.id, relationships);
  if (isDirectSibling) {
    const targetKey = getSiblingOrderKey(target);
    const speakerKey = getSiblingOrderKey(speaker);
    if (targetKey !== null && speakerKey !== null && targetKey !== speakerKey) {
      return targetKey > speakerKey ? 'younger' : 'older';
    }
  }

  // C. General DOB comparison (speaker vs target) -- DOB-only on purpose: a
  // birthOrder value only has meaning within its own sibling group (cases A
  // and B, above), not between two people from different families.
  if (speaker.dob && target.dob) {
    const sDate = new Date(speaker.dob).getTime();
    const tDate = new Date(target.dob).getTime();
    if (sDate < tDate) return 'younger';
    if (sDate > tDate) return 'older';
  }

  // D2. Sibling-chain inheritance: target's own DOB/birth order didn't
  // resolve anything above, but if one of target's OWN siblings already has
  // a resolved seniority relative to speaker, and target's relative
  // position against that specific sibling is known, the same direction
  // carries over -- a sibling born after someone already younger than you
  // is also younger than you (and symmetrically for an elder sibling).
  // Deliberately does NOT fire when the direction would be ambiguous (e.g.
  // someone born before a sibling who is younger than you could be either
  // older OR younger than you) -- unresolved stays unresolved rather than
  // guessing. Cycle protection uses its own visited set, separate from
  // case D's below, so the two recursions don't interfere with each other.
  if (!visitedSiblingChain.has(target.id)) {
    visitedSiblingChain.add(target.id);
    const targetParentIds = relationships
      .filter(r => r.type === 'parent' && r.person2Id === target.id)
      .map(r => r.person1Id);
    const targetSiblingIds = new Set();
    targetParentIds.forEach((pId) => {
      relationships
        .filter(r => r.type === 'parent' && r.person1Id === pId && r.person2Id !== target.id)
        .forEach((r) => targetSiblingIds.add(r.person2Id));
    });

    const targetKey = getSiblingOrderKey(target);
    for (const siblingId of targetSiblingIds) {
      if (visitedSiblingChain.has(siblingId)) continue;
      const sibling = persons.find(p => p.id === siblingId);
      if (!sibling) continue;

      const siblingSeniority = calculateSeniority(speaker, sibling, relationships, persons, visitedSpouses, visitedSiblingChain);
      if (siblingSeniority === 'unknown') continue;

      const siblingKey = getSiblingOrderKey(sibling);
      if (targetKey === null || siblingKey === null || targetKey === siblingKey) continue;

      if (targetKey > siblingKey && siblingSeniority === 'younger') return 'younger';
      if (targetKey < siblingKey && siblingSeniority === 'older') return 'older';
    }
  }

  // D. In-law inheritance (spouse of a relative) with recursion cycle protection
  if (relationships.length > 0 && persons.length > 0 && !visitedSpouses.has(target.id)) {
    visitedSpouses.add(target.id);
    const targetSpouseIds = relationships
      .filter(r => r.type === 'spouse' && (r.person1Id === target.id || r.person2Id === target.id))
      .map(r => r.person1Id === target.id ? r.person2Id : r.person1Id);

    for (const spouseId of targetSpouseIds) {
      if (visitedSpouses.has(spouseId)) continue;
      const spouse = persons.find(p => p.id === spouseId);
      if (spouse) {
        const spouseSeniority = calculateSeniority(speaker, spouse, relationships, persons, visitedSpouses, visitedSiblingChain);
        if (spouseSeniority !== 'unknown') return spouseSeniority;
      }
    }
  }

  return 'unknown';
};


const normG = (g) => {
  if (!g) return 'ANY';
  const str = String(g).trim().toUpperCase();
  if (str === 'M' || str === 'MALE') return 'M';
  if (str === 'F' || str === 'FEMALE') return 'F';
  return 'ANY';
};

/**
 * Zone-specific term-rule resolution, given an already-decided zone and
 * already-computed generation/seniority. Shared by calculateKinshipTerm
 * (one best-guess zone per call) and calculateAllKinshipTerms' multi-
 * candidate path (one call per zone a clan-only lookup's clan legitimately
 * belongs to, when it's in more than one alliance box at once).
 */
const resolveTermForZone = (targetZone, genDiff, seniority, termRules, sGender, tGender) => {
  // Mayu ni a Dama / Dama ni a Mayu are transient zone labels that were
  // never meant to carry their own term rules (the DB schema doesn't allow
  // it) -- they always fall through to Kahpu Kanau.
  const resolveFallbackZone = (zone) => {
    if (zone === 'Mayu ni a Dama' || zone === 'Dama ni a Mayu') return 'Kahpu Kanau';
    return zone;
  };

  const getZoneSpecificRules = (queryZone) => termRules.filter(r => {
    const rTargetG = normG(r.target_gender);
    const rSpeakerG = normG(r.speaker_gender);

    const matchZone = r.alliance_zone === queryZone;
    const matchTargetGender = rTargetG === 'ANY' || rTargetG === tGender;
    const matchSpeakerGender = rSpeakerG === 'ANY' || rSpeakerG === sGender || r.engine_type === 'independent';
    const matchException = !r.exception_flag || r.exception_flag === 'none';

    return matchZone && matchTargetGender && matchSpeakerGender && matchException;
  });

  let activeZone = targetZone;
  let zoneRules = getZoneSpecificRules(activeZone);

  if (zoneRules.length === 0) {
    activeZone = resolveFallbackZone(targetZone);
  }

  const candidateRules = termRules.filter(r => {
    const rTargetG = normG(r.target_gender);
    const rSpeakerG = normG(r.speaker_gender);

    const matchZone = r.alliance_zone === 'any' || r.alliance_zone === 'Any' || r.alliance_zone === activeZone;
    const matchTargetGender = rTargetG === 'ANY' || rTargetG === tGender;
    const matchSpeakerGender = rSpeakerG === 'ANY' || rSpeakerG === sGender || r.engine_type === 'independent';
    const matchException = !r.exception_flag || r.exception_flag === 'none';

    return matchZone && matchTargetGender && matchSpeakerGender && matchException;
  });

  let exactMatches = [];
  let wildcardMatches = [];

  for (const rule of candidateRules) {
    if (genDiff === null) {
      if (rule.generation === 99 || rule.generation === -99) {
         wildcardMatches.push(rule);
      }
      continue;
    }

    // Normalize generations. Zone-specific terms only go out to +2/-2
    // (grandparent/grandchild); beyond that (great-grandparent and up) Kachin
    // usage drops the alliance-zone distinction and everyone becomes Ji
    // (male)/Dwi (female), so ascending generations past +2 map to the 99
    // "any generation" sentinel already used by the independent engine's
    // wildcard rows, rather than clamping to the grandparent-generation zone
    // term. Descending beyond -2 keeps the existing grandchild-term clamp.
    let normalizedGen = genDiff > 2 ? 99 : (genDiff < -2 ? -2 : genDiff);

    if (rule.generation === normalizedGen) {
       // Exact generation match
       if (rule.relative_age !== 'any' && rule.relative_age !== 'Any') {
          // Unknown seniority (no DOB, birth order, or other signal available)
          // matches EVERY age-specific rule at this generation rather than
          // guessing -- the combine step below joins them with " / " (e.g.
          // "Kahpu / Kanau"), an honest "could be either" instead of a
          // confident but potentially wrong single answer.
          if (seniority === 'unknown' || rule.relative_age === seniority) {
             exactMatches.push(rule);
          }
       } else {
          exactMatches.push(rule);
       }
    } else if (rule.generation === 99 || rule.generation === -99) {
       // Wildcard match
       wildcardMatches.push(rule);
    }
  }

  // Priority: Exact Gen Match > Wildcard Match
  let possibleMatches = exactMatches.length > 0 ? exactMatches : wildcardMatches;

  if (possibleMatches.length === 0) return null;

  // If we matched multiple (e.g. because seniority is unknown), combine them!
  const uniqueTermsYouCallThem = [...new Set(possibleMatches.map(r => r.term_you_call_them))].join(' / ');
  const uniqueTermsTheyCallYou = [...new Set(possibleMatches.map(r => r.term_they_call_you))].join(' / ');
  const uniqueNotes = [...new Set(possibleMatches.map(r => r.cultural_notes))].filter(Boolean).join(' | ');

  return {
    youCallThem: uniqueTermsYouCallThem,
    theyCallYou: uniqueTermsTheyCallYou,
    notes: uniqueNotes,
    zone: targetZone,
    generation: genDiff,
    seniority: seniority
  };
};

// Canonical display/tie-break order for the 5 alliance zones -- own clan and
// the two primary zones first, the extended/second-order zones last.
const ZONE_DISPLAY_ORDER = ['Kahpu Kanau', 'Mayu', 'Dama', 'Mayu ni a Mayu', 'Dama ni a Dama'];

// Ranks how confidently a clan's placement in `zone` should be trusted when
// the same clan matches more than one alliance box at once (lower = higher
// priority). Mirrors the priority order documented for elder review: the
// speaker's own clan and the two primary zones first, then anything a person
// deliberately configured (a per-tree manual override, or an admin's global
// default rule), and only last the more speculative extended zones (Mayu ni a
// Mayu / Dama ni a Dama) plus a Kahpu Kanau match that arrived via the
// Mayu-ni-a-Dama / Dama-ni-a-Mayu fold-back cascade rather than being the
// speaker's actual own clan.
const rankZoneMatch = (zone, lineage, speakerLineage, manualZones, defaultKinshipRules) => {
  if (zone === 'Kahpu Kanau' && isSameLineage(lineage, speakerLineage)) return 1;
  if (zone === 'Mayu' || zone === 'Dama') return 1;
  const manualList = manualZones?.[zone];
  if (Array.isArray(manualList) && manualList.some((key) => isSameLineage(parseLineageKey(key), lineage))) return 2;
  const hasDefaultRule = (defaultKinshipRules || []).some((r) =>
    ruleSideMatches(r, 'speaker', speakerLineage)
    && ruleSideMatches(r, 'target', lineage)
    && (r.defaultAlliance ?? r.default_alliance) === zone);
  if (hasDefaultRule) return 3;
  return 4;
};

const sortZonesByPriority = (zones, lineage, speakerLineage, manualZones, defaultKinshipRules) => [...zones].sort((a, b) => {
  const ta = rankZoneMatch(a, lineage, speakerLineage, manualZones, defaultKinshipRules);
  const tb = rankZoneMatch(b, lineage, speakerLineage, manualZones, defaultKinshipRules);
  if (ta !== tb) return ta - tb;
  return ZONE_DISPLAY_ORDER.indexOf(a) - ZONE_DISPLAY_ORDER.indexOf(b);
});

// 4. Kinship Term Resolution
export const calculateKinshipTerm = (
  speaker,
  target,
  persons,
  relationships,
  kinshipRules,
  termRules,
  manualGenDiff = null,
  manualSeniority = null,
  manualZones = null,
  defaultKinshipRules = null,
) => {
  if (!speaker || !target || speaker.id === target.id) return null;

  // 1. Calculate Alliance Zone
  const boxes = getKinshipBoxesForPerson(
    speaker.id,
    persons,
    relationships,
    kinshipRules,
    defaultKinshipRules,
  );
  if (manualZones) {
    Object.entries(manualZones).forEach(([zone, lineageKeys]) => {
      if (!boxes[zone] || !Array.isArray(lineageKeys)) return;
      lineageKeys.forEach((key) => boxes[zone].add(key));
    });
  }
  let targetZone = null;

  // 1. Structural Zone Inference from Family Tree (tried first). A real,
  // direct family-tree relationship (parent, sibling, spouse, parent's
  // sibling, etc.) always outranks the generic clan-level cascade below --
  // the clan boxes summarize marriages across the *whole* tree, so a clan
  // can legitimately end up in more than one box (e.g. a completely
  // unrelated marriage elsewhere puts it in "Mayu ni a Mayu" too). That's
  // fine for a clan you have no direct link to, but for someone you're
  // actually, individually connected to -- your mother's own sister is Mayu
  // to you regardless of what some other branch's marriage did to her
  // clan's box membership -- the direct path is the ground truth and must
  // win. (Only reachable with a real target -- calculateAllKinshipTerms
  // handles the clan-only lookup case, with no individual to trace, itself.)
  {
    // A. Direct Parent
    const isDirectParent = relationships.some(r => r.type === 'parent' && r.person1Id === target.id && r.person2Id === speaker.id);
    if (isDirectParent) {
      targetZone = target.gender === 'Female' ? 'Mayu' : 'Kahpu Kanau';
    }

    // B. Direct Child
    if (!targetZone) {
      const isDirectChild = relationships.some(r => r.type === 'parent' && r.person1Id === speaker.id && r.person2Id === target.id);
      if (isDirectChild) targetZone = 'Kahpu Kanau';
    }

    // C. Direct Sibling
    if (!targetZone) {
      const isDirectSibling = areSiblings(speaker.id, target.id, relationships);
      if (isDirectSibling) targetZone = 'Kahpu Kanau';
    }

    // D. Direct Spouse
    if (!targetZone) {
      const isDirectSpouse = relationships.some(r => r.type === 'spouse' && ((r.person1Id === speaker.id && r.person2Id === target.id) || (r.person2Id === speaker.id && r.person1Id === target.id)));
      if (isDirectSpouse) {
        targetZone = speaker.gender === 'Male' ? 'Mayu' : 'Dama';
      }
    }

    // E. Sibling of a Parent (Parent's Brother / Parent's Sister)
    if (!targetZone) {
      const parents = relationships.filter(r => r.type === 'parent' && r.person2Id === speaker.id).map(r => r.person1Id);
      for (const pId of parents) {
        const parent = persons.find(p => p.id === pId);
        const isParentSibling = areSiblings(pId, target.id, relationships);
        if (isParentSibling && parent) {
          targetZone = parent.gender === 'Female' ? 'Mayu' : 'Kahpu Kanau';
          break;
        }
      }
    }

    // F. Spouse of a Sibling or Spouse of a Parent's Sibling
    if (!targetZone) {
      const targetSpouses = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === target.id || r.person2Id === target.id))
        .map(r => r.person1Id === target.id ? r.person2Id : r.person1Id);

      for (const spouseId of targetSpouses) {
        const spouse = persons.find(p => p.id === spouseId);
        if (!spouse) continue;

        // Is spouse a direct sibling of speaker?
        const isSibling = areSiblings(speaker.id, spouseId, relationships);
        if (isSibling) {
          targetZone = spouse.gender === 'Male' ? 'Mayu' : 'Dama';
          break;
        }

        // Is spouse a sibling of speaker's parent?
        const parents = relationships.filter(r => r.type === 'parent' && r.person2Id === speaker.id).map(r => r.person1Id);
        for (const pId of parents) {
          const parent = persons.find(p => p.id === pId);
          const isParentSibling = areSiblings(pId, spouseId, relationships);
          if (isParentSibling && parent) {
            if (parent.gender === 'Female') {
              // Mother's side:
              // Mother's Brother's Wife -> Mayu ni a Mayu (Ni)
              // Mother's Sister's Husband -> Kahpu Kanau (Kawa)
              targetZone = spouse.gender === 'Male' ? 'Mayu ni a Mayu' : 'Kahpu Kanau';
            } else {
              // Father's side: Father's Brother's Wife -> Mayu (Kanu), Father's Sister's Husband -> Dama (Gu)
              targetZone = spouse.gender === 'Male' ? 'Mayu' : 'Dama';
            }
            break;
          }
        }
        if (targetZone) break;
      }
    }

    // G. Sibling of a Spouse
    if (!targetZone) {
      const speakerSpouses = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id))
        .map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

      for (const spouseId of speakerSpouses) {
        const isSpouseSibling = areSiblings(spouseId, target.id, relationships);
        if (isSpouseSibling) {
          targetZone = speaker.gender === 'Male' ? 'Mayu' : 'Dama';
          break;
        }
      }
    }

    // H. Spouse of Mother's Brother (Mother's Brother's Wife)
    if (!targetZone) {
      const targetSpouses = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === target.id || r.person2Id === target.id))
        .map(r => r.person1Id === target.id ? r.person2Id : r.person1Id);

      const parents = relationships.filter(r => r.type === 'parent' && r.person2Id === speaker.id).map(r => r.person1Id);
      for (const spouseId of targetSpouses) {
        for (const pId of parents) {
          const parent = persons.find(p => p.id === pId);
          if (parent?.gender === 'Female') {
            const isMomBrother = areSiblings(pId, spouseId, relationships);
            if (isMomBrother) {
              targetZone = 'Mayu ni a Mayu';
              break;
            }
          }
        }
        if (targetZone) break;
      }
    }

    // I. Child of a Relative (Wife's Sister's Child, Brother's Child, Sister's Child, etc.)
    if (!targetZone) {
      const speakerSpouses = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id))
        .map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

      const targetParents = relationships
        .filter(r => r.type === 'parent' && r.person2Id === target.id)
        .map(r => r.person1Id);

      for (const pId of targetParents) {
        // Child of Wife's Sister or Husband's Sister
        for (const spouseId of speakerSpouses) {
          const isSpouseSibling = areSiblings(spouseId, pId, relationships);
          if (isSpouseSibling) {
            targetZone = speaker.gender === 'Male' ? 'Mayu ni a Dama' : 'Dama ni a Mayu';
            break;
          }
        }

        // Child of Direct Sibling
        const isDirectSibling = areSiblings(speaker.id, pId, relationships);
        if (isDirectSibling) {
          const parent = persons.find(p => p.id === pId);
          targetZone = parent?.gender === 'Female' ? (speaker.gender === 'Male' ? 'Dama' : 'Kahpu Kanau') : 'Kahpu Kanau';
        }

        // Child of a Parent's Sibling (a true first cousin via an aunt/uncle --
        // e.g. mother's sister's child) -- mirrors cases E/F's own logic for
        // resolving the aunt/uncle (or their spouse) directly, since a cousin's
        // patrilineal clan comes from whichever of their two parents is male.
        if (!targetZone) {
          const speakerParents = relationships
            .filter(r => r.type === 'parent' && r.person2Id === speaker.id)
            .map(r => r.person1Id);

          for (const linkedParentId of speakerParents) {
            const isParentSibling = areSiblings(linkedParentId, pId, relationships);
            if (!isParentSibling) continue;

            const linkedParent = persons.find(p => p.id === linkedParentId);
            const auntUncle = persons.find(p => p.id === pId);
            if (auntUncle?.gender === 'Male') {
              // The aunt/uncle themself carries the cousin's clan forward.
              targetZone = linkedParent?.gender === 'Female' ? 'Mayu' : 'Kahpu Kanau';
            } else if (auntUncle?.gender === 'Female') {
              // The aunt's husband carries the cousin's clan forward, not the
              // aunt herself -- same fold-back as case F's "Spouse of a
              // Parent's Sibling" (Mother's Sister's Husband -> Kahpu Kanau,
              // Father's Sister's Husband -> Dama).
              targetZone = linkedParent?.gender === 'Female' ? 'Kahpu Kanau' : 'Dama';
            }
            if (targetZone) break;
          }
        }
        if (targetZone) break;
      }
    }

    // J. Spouse of a Spouse's Sibling
    if (!targetZone) {
      const speakerSpouses = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id))
        .map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

      const targetSpouses = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === target.id || r.person2Id === target.id))
        .map(r => r.person1Id === target.id ? r.person2Id : r.person1Id);

      for (const spId of speakerSpouses) {
        for (const tSpId of targetSpouses) {
          const isSpouseSib = areSiblings(spId, tSpId, relationships);
          if (isSpouseSib) {
            const spPerson = persons.find(p => p.id === spId);
            const tSpPerson = persons.find(p => p.id === tSpId);
            if (spPerson && tSpPerson) {
              if (spPerson.gender === tSpPerson.gender) {
                // Two brothers' wives or two sisters' husbands are Kahpu Kanau
                targetZone = 'Kahpu Kanau';
              } else {
                // Wife's Brother's Wife -> Mayu ni a Mayu
                // Husband's Sister's Husband -> Dama ni a Dama
                targetZone = speaker.gender === 'Male' ? 'Mayu ni a Mayu' : 'Dama ni a Dama';
              }
              break;
            }
          }
        }
        if (targetZone) break;
      }
    }

    // K. Ancestor or Descendant via a pure parent-chain (grandparent,
    // great-grandparent, grandchild, ...). Unlike the direct-parent/child
    // case (A/B), a multi-hop ancestor has no explicit rule of its own and
    // used to fall through to the clan cascade below -- but that cascade can
    // only classify someone's clan via a RECORDED SPOUSE relationship
    // chaining back to the root's own clan. A grandparent added before their
    // spouse exists in the tree (e.g. "add mother's mother" before "add
    // mother's father") has no such chain yet, so targetZone stayed null and
    // calculateKinshipTerm bailed out at the `if (!targetZone) return null`
    // below -- even though the term at 2+ generations out doesn't actually
    // depend on which zone is picked (every zone maps generation ±2 to the
    // same Ji/Dwi/Kashu terms, and 3+ generations collapses to the
    // zone-agnostic "any" sentinel). So we only need SOME valid zone here to
    // unblock resolution, not the "correct" one -- assign it the same way
    // branch A does for a direct parent, walking through whichever immediate
    // parent leads toward the target.
    if (!targetZone) {
      const findChainZone = (fromId, toId, throughGender) => {
        let frontier = relationships
          .filter(r => r.type === 'parent' && r.person2Id === fromId)
          .map(r => ({ id: r.person1Id, gender: persons.find(p => p.id === r.person1Id)?.gender }));
        const seen = new Set(frontier.map(f => f.id));
        let depth = 0;
        while (frontier.length && depth < 8) {
          for (const node of frontier) {
            if (node.id === toId) {
              return throughGender === 'Female' ? 'Mayu' : 'Kahpu Kanau';
            }
          }
          const next = [];
          for (const node of frontier) {
            relationships
              .filter(r => r.type === 'parent' && r.person2Id === node.id)
              .forEach(r => {
                if (!seen.has(r.person1Id)) {
                  seen.add(r.person1Id);
                  next.push({ id: r.person1Id, gender: node.gender });
                }
              });
          }
          frontier = next;
          depth++;
        }
        return null;
      };

      const speakerParents = relationships
        .filter(r => r.type === 'parent' && r.person2Id === speaker.id)
        .map(r => ({ id: r.person1Id, gender: persons.find(p => p.id === r.person1Id)?.gender }));

      for (const parent of speakerParents) {
        if (parent.id === target.id) continue; // already handled by branch A
        const zone = findChainZone(parent.id, target.id, parent.gender);
        if (zone) {
          targetZone = zone;
          break;
        }
      }

      // Descendant direction (grandchild, great-grandchild, ...): the
      // Kachin term for a descendant doesn't vary by zone at any depth
      // (Kahpu Kanau/Mayu/Dama all resolve to the same term at generation
      // -2, and beyond that the "any zone" sentinel takes over), so
      // Kahpu Kanau is a safe, zone-agnostic default.
      if (!targetZone) {
        const isDescendant = (fromId, toId) => {
          let frontier = relationships.filter(r => r.type === 'parent' && r.person1Id === fromId).map(r => r.person2Id);
          const seen = new Set(frontier);
          let depth = 0;
          while (frontier.length && depth < 8) {
            if (frontier.includes(toId)) return true;
            const next = [];
            frontier.forEach(id => {
              relationships
                .filter(r => r.type === 'parent' && r.person1Id === id)
                .forEach(r => {
                  if (!seen.has(r.person2Id)) {
                    seen.add(r.person2Id);
                    next.push(r.person2Id);
                  }
                });
            });
            frontier = next;
            depth++;
          }
          return false;
        };
        if (isDescendant(speaker.id, target.id)) {
          targetZone = 'Kahpu Kanau';
        }
      }
    }

    // L. Parent of a Spouse (Wife's Father / Mother, Husband's Father /
    // Mother). The parent who heads the spouse's own clan (their father, in
    // this patrilineal system) shares the spouse's own zone (see D. Direct
    // Spouse). The other parent married INTO that clan from their own natal
    // clan -- same "in-marrying spouse" pattern as branches F/H -- one hop
    // further out, hence "ni a" (Mayu ni a Mayu / Dama ni a Dama) instead of
    // the direct zone.
    if (!targetZone) {
      const speakerSpouseIds = relationships
        .filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id))
        .map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

      for (const spouseId of speakerSpouseIds) {
        const isSpousesParent = relationships.some(r => r.type === 'parent' && r.person2Id === spouseId && r.person1Id === target.id);
        if (!isSpousesParent) continue;

        const headsSpousesClan = target.gender !== 'Female';
        targetZone = speaker.gender === 'Male'
          ? (headsSpousesClan ? 'Mayu' : 'Mayu ni a Mayu')
          : (headsSpousesClan ? 'Dama' : 'Dama ni a Dama');
        break;
      }
    }
  }

  // 1.5 Alliance Zone from clan cascade (fallback: only used when no direct
  // family-tree relationship was found above -- e.g. a real target you have
  // no individual link to, so the generic clan-level cascade is all that's
  // left to go on).
  //
  // A clan can legitimately belong to more than one box at once -- e.g. a wife's
  // brother's wife's clan is both Mayu (direct) and Mayu ni a Mayu (via the cascade),
  // simultaneously and correctly. When that happens, `sortZonesByPriority` picks the
  // most-trustworthy match: the speaker's own clan and the two primary zones first,
  // then a manual override, then an admin default rule, and only last the extended
  // zones (Mayu ni a Mayu / Dama ni a Dama) or a fold-back Kahpu Kanau match -- still
  // a tie-break, not the full ambiguity design (see calculateAllKinshipTerms, which
  // surfaces every matching zone instead of silently picking one for a clan-only
  // lookup).
  if (!targetZone) {
    if (target.clanId) {
      const matchingZones = ZONE_DISPLAY_ORDER.filter((zoneName) => zoneHasLineage(boxes[zoneName], target));
      if (matchingZones.length > 0) {
        targetZone = sortZonesByPriority(matchingZones, target, speaker, manualZones, defaultKinshipRules)[0];
      }
    }

    // Lineage-aware, not clanId-aware: a confirmed-different branch/family
    // of the same clan must NOT be forced into Kahpu Kanau here -- if
    // nothing else resolved it, the honest answer is "no term found", not a
    // guess. A genuinely same-lineage target (or one with no branch/family
    // recorded, so not provably different) still correctly lands here.
    if (!targetZone && speaker.clanId && isSameLineage(target, speaker)) {
      targetZone = 'Kahpu Kanau';
    }

    if (!targetZone && speaker.clanId && target.clanId) {
      targetZone = resolveDefaultAllianceZone(speaker, target, defaultKinshipRules);
    }
  }

  // 2. Pre-calculate direct relations for exceptions
  let isDirectSpouse = false;

  const speakerSpouses = relationships.filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id)).map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

  if (speakerSpouses.includes(target.id)) {
    isDirectSpouse = true;
  }

  const sGender = normG(speaker.gender);
  const tGender = normG(target.gender);

  // 3. Evaluate Direct Exception Rules First (Bypasses Zone requirement)
  const exceptionMatches = termRules.filter(r => {
    if (!r.exception_flag || r.exception_flag === 'none') return false;
    const rTargetG = normG(r.target_gender);
    const rSpeakerG = normG(r.speaker_gender);

    if (rTargetG !== 'ANY' && rTargetG !== tGender) return false;
    if (rSpeakerG !== 'ANY' && rSpeakerG !== sGender && r.engine_type !== 'independent') return false;

    if (r.exception_flag === 'direct_spouse' && isDirectSpouse) return true;

    return false;
  });

  if (exceptionMatches.length > 0) {
    const uniqueTermsYouCallThem = [...new Set(exceptionMatches.map(r => r.term_you_call_them))].join(' / ');
    const uniqueTermsTheyCallYou = [...new Set(exceptionMatches.map(r => r.term_they_call_you))].join(' / ');
    const uniqueNotes = [...new Set(exceptionMatches.map(r => r.cultural_notes))].filter(Boolean).join(' | ');
    return {
      youCallThem: uniqueTermsYouCallThem,
      theyCallYou: uniqueTermsTheyCallYou,
      notes: uniqueNotes,
      zone: targetZone || 'Direct',
      generation: manualGenDiff !== null ? manualGenDiff : calculateGenerationDiff(speaker.id, target.id, relationships, persons),
      seniority: 'unknown'
    };
  }

  // If not an exception, we MUST have a targetZone to proceed with cultural mapping
  if (!targetZone) return null;

  // 4. Calculate Generation and Seniority
  let genDiff = manualGenDiff !== null ? manualGenDiff : calculateGenerationDiff(speaker.id, target.id, relationships, persons);
  const seniority = manualSeniority !== null ? manualSeniority : calculateSeniority(speaker, target, relationships, persons);

  // Apply the Respect Elevation Override Rule (>= +2 for Mayu ni a Mayu -> 99)
  if (targetZone === 'Mayu ni a Mayu' && genDiff >= 2) {
    genDiff = 99;
  }

  // 5. Evaluate Normal Rules with Fallback Cascade
  return resolveTermForZone(targetZone, genDiff, seniority, termRules, sGender, tGender);
};

export const calculateAllKinshipTerms = (
  speaker,
  target,
  persons,
  relationships,
  kinshipRules,
  termRules,
  manualGenDiff = null,
  manualSeniority = null,
  manualZones = null,
  defaultKinshipRules = null,
) => {
  // A clan-only lookup (Kinship Lookup's synthetic target: a clan/gender with
  // no real person behind it) is resolved purely from the same alliance
  // boxes the Kinship Alliances dashboard shows -- marriage cascade + manual
  // overrides -- rather than tracing an individual family-tree path (that's
  // what calculateKinshipTerm's structural resolution is for, and it needs a
  // real target with real relationship records to trace). This can
  // legitimately match more than one box at once -- the same clan may have
  // taken a wife from the root clan in one marriage and given a "Mayu ni a
  // Mayu" wife in a separate, unrelated one -- in which case every matching
  // zone is returned so the user can pick which one actually applies.
  if (target?.id === 'stranger' && target.clanId) {
    // Built WITHOUT the admin default-rule merge (getKinshipBoxesForPerson
    // would otherwise bake those directly into the same boxes) so a genuine
    // cascade/manual match can be distinguished from "nothing matched, so
    // fall back to the default rule" below.
    const boxes = getKinshipBoxesForPerson(
      speaker.id,
      persons,
      relationships,
      kinshipRules,
      null,
    );
    if (manualZones) {
      Object.entries(manualZones).forEach(([zone, lineageKeys]) => {
        if (!boxes[zone] || !Array.isArray(lineageKeys)) return;
        lineageKeys.forEach((key) => boxes[zone].add(key));
      });
    }
    const matchedZones = Object.keys(boxes).filter((zone) => zoneHasLineage(boxes[zone], target));

    const genDiff = manualGenDiff !== null ? manualGenDiff : calculateGenerationDiff(speaker.id, target.id, relationships, persons);
    const seniority = manualSeniority !== null ? manualSeniority : calculateSeniority(speaker, target, relationships, persons);
    const sGender = normG(speaker.gender);
    const tGender = normG(target.gender);
    // Same Respect Elevation Override Rule calculateKinshipTerm applies.
    const effectiveGenDiff = (zone) => (zone === 'Mayu ni a Mayu' && genDiff !== null && genDiff >= 2) ? 99 : genDiff;

    if (matchedZones.length > 0) {
      // Higher-priority zones (own clan, Mayu/Dama, then manual, then admin
      // default rules) come first -- see sortZonesByPriority's own comment.
      const orderedZones = sortZonesByPriority(matchedZones, target, speaker, manualZones, defaultKinshipRules);
      const results = orderedZones
        .map((zone) => resolveTermForZone(zone, effectiveGenDiff(zone), seniority, termRules, sGender, tGender))
        .filter(Boolean);
      if (results.length > 0) return results;
    }

    // No box match at all -- fall back to the admin-configured default rule
    // for this exact lineage pair, if one exists.
    const defaultZone = resolveDefaultAllianceZone(speaker, target, defaultKinshipRules);
    if (defaultZone) {
      const res = resolveTermForZone(defaultZone, effectiveGenDiff(defaultZone), seniority, termRules, sGender, tGender);
      if (res) return [res];
    }
    return [];
  }

  const res = calculateKinshipTerm(
    speaker,
    target,
    persons,
    relationships,
    kinshipRules,
    termRules,
    manualGenDiff,
    manualSeniority,
    manualZones,
    defaultKinshipRules,
  );
  return res ? [res] : [];
};

export const emptyKinshipBoxes = () => ({
  'Kahpu Kanau': new Set(),
  Mayu: new Set(),
  Dama: new Set(),
  'Mayu ni a Mayu': new Set(),
  'Dama ni a Dama': new Set(),
});

/**
 * Full zone map: marriage rules + each person in tree assigned to a zone.
 */
export const computeAllianceZoneBoxes = ({
  rootPerson,
  persons,
  relationships,
  kinshipRules,
  kinshipTermRules,
  defaultKinshipRules = null,
}) => {
  if (!rootPerson?.clanId) return emptyKinshipBoxes();

  const boxes = getKinshipBoxesForPerson(
    rootPerson.id,
    persons,
    relationships,
    kinshipRules,
    defaultKinshipRules,
  );

  persons.forEach((person) => {
    if (!person.clanId) return;

    // Lineage-aware, not clanId-aware: this had the identical bug to the
    // one fixed in getKinshipBoxesForPerson's tryMatch -- a same-clan
    // different-branch relative must not be unconditionally shortcut into
    // Kahpu Kanau.
    if (isSameLineage(person, rootPerson)) {
      boxes['Kahpu Kanau'].add(lineageKeyOf(person));
      return;
    }

    const kinship = calculateKinshipTerm(
      rootPerson,
      person,
      persons,
      relationships,
      kinshipRules,
      kinshipTermRules,
      null,
      null,
      null,
      defaultKinshipRules,
    );

    if (kinship?.zone && boxes[kinship.zone]) {
      // In Kachin culture, Kahpu Kanau alliance box is strictly for the patrilineal root clan
      // and explicit agnatic brother clans. Do not allow indirect tree paths to add non-root lineages to Kahpu Kanau.
      if (kinship.zone === 'Kahpu Kanau' && !isSameLineage(person, rootPerson)) {
        return;
      }
      boxes[kinship.zone].add(lineageKeyOf(person));
    }
  });

  return boxes;
};

export const allianceBoxesToRecords = (boxes, { treeId, anchorClanId, source = 'engine' }) => {
  const records = [];
  Object.entries(boxes).forEach(([zone, lineageSet]) => {
    lineageSet.forEach((lineageKey) => {
      const { clanId, subClanId, familyNameId } = parseLineageKey(lineageKey);
      records.push({ treeId, anchorClanId, clanId, subClanId, familyNameId, zone, source });
    });
  });
  return records;
};

export const allianceRecordsToBoxes = (records, anchorClanId) => {
  const boxes = emptyKinshipBoxes();
  records
    .filter((r) => r.anchorClanId === anchorClanId)
    .forEach((r) => {
      if (boxes[r.zone]) boxes[r.zone].add(makeLineageKey(r.clanId, r.subClanId, r.familyNameId));
    });
  return boxes;
};


// ---------------------------------------------------------------------------
// Graph validation (opt-in "strict" check)
// ---------------------------------------------------------------------------
//
// The calculation functions above are deliberately tolerant: a relationship
// pointing at a missing person is skipped, an unknown relationship type is
// ignored, and a disconnected graph just yields `null` / empty boxes. That
// keeps the UI working on imperfect data, but it also makes "these two people
// aren't related" indistinguishable from "the data is broken". Callers that
// need to tell the difference (imports, admin data checks, tests) can run this
// first. It never changes any calculation result.

const KNOWN_RELATIONSHIP_TYPES = new Set(['parent', 'spouse', 'sibling']);
const isGenderKnown = (p) => ['M', 'Male', 'F', 'Female'].includes(p?.gender);

/**
 * Check a family graph for data problems the tolerant engine would silently
 * skip. Returns `{ ok, issues }`; `ok` is false when any issue is an error.
 * Each issue: `{ code, severity: 'error' | 'warning', message, personIds,
 * relationshipIndex? }`.
 *
 * Errors (results may be wrong): duplicate_person_id, unknown_relationship_type,
 * dangling_relationship, self_relationship, conflicting_relationship
 * (e.g. both parent and spouse of the same person), parent_cycle (someone is
 * their own ancestor).
 * Warnings (results may be incomplete): duplicate_relationship,
 * too_many_parents (more than two), missing_gender_in_marriage (Mayu/Dama
 * direction can't be worked out).
 */
export const validateFamilyGraph = (persons = [], relationships = []) => {
  const issues = [];
  const add = (severity, code, message, personIds, extra = {}) => {
    issues.push({ code, severity, message, personIds, ...extra });
  };

  const personById = new Map();
  persons.forEach((p) => {
    if (personById.has(p.id)) {
      add('error', 'duplicate_person_id', `Person id ${p.id} appears more than once.`, [p.id]);
    } else {
      personById.set(p.id, p);
    }
  });

  const seenPairs = new Map(); // pairKey -> relationship type
  const parentsOf = new Map(); // childId -> Set(parentId)
  const childrenOf = new Map(); // parentId -> Set(childId)
  const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  relationships.forEach((rel, relationshipIndex) => {
    const { type, person1Id: a, person2Id: b } = rel;
    const at = { relationshipIndex };

    if (!KNOWN_RELATIONSHIP_TYPES.has(type)) {
      add('error', 'unknown_relationship_type', `Unknown relationship type "${type}".`, [a, b], at);
      return;
    }
    const missing = [a, b].filter((id) => !personById.has(id));
    if (missing.length) {
      add('error', 'dangling_relationship', `A ${type} relationship points at a missing person (${missing.join(', ')}).`, [a, b], at);
      return;
    }
    if (a === b) {
      add('error', 'self_relationship', `${a} has a ${type} relationship with themselves.`, [a], at);
      return;
    }

    const key = pairKey(a, b);
    const previous = seenPairs.get(key);
    if (previous === type) {
      const sameDirection = type !== 'parent' || parentsOf.get(b)?.has(a);
      if (sameDirection) {
        add('warning', 'duplicate_relationship', `${a} and ${b} have the same ${type} relationship recorded twice.`, [a, b], at);
        return;
      }
    }
    if (previous && previous !== type) {
      add('error', 'conflicting_relationship', `${a} and ${b} are recorded as both ${previous} and ${type}.`, [a, b], at);
    }
    seenPairs.set(key, type);

    if (type === 'parent') {
      if (!parentsOf.has(b)) parentsOf.set(b, new Set());
      parentsOf.get(b).add(a);
      if (!childrenOf.has(a)) childrenOf.set(a, new Set());
      childrenOf.get(a).add(b);
    }
    if (type === 'spouse') {
      const unknown = [a, b].filter((id) => !isGenderKnown(personById.get(id)));
      if (unknown.length) {
        add('warning', 'missing_gender_in_marriage', `Gender is missing for ${unknown.join(', ')}, so Mayu/Dama direction for this marriage can't be determined.`, unknown, at);
      }
    }
  });

  parentsOf.forEach((parents, childId) => {
    if (parents.size > 2) {
      add('warning', 'too_many_parents', `${childId} has ${parents.size} recorded parents.`, [childId, ...parents]);
    }
  });

  // Parent cycles: depth-first search over parent -> child edges, coloring
  // nodes in progress; reaching an in-progress node again is a cycle.
  const IN_PROGRESS = 1;
  const DONE = 2;
  const state = new Map();
  const reportedCycles = new Set();
  childrenOf.forEach((_, startId) => {
    if (state.get(startId)) return;
    const stack = [[startId, [...(childrenOf.get(startId) || [])]]];
    const path = [startId];
    state.set(startId, IN_PROGRESS);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const nextId = top[1].pop();
      if (nextId === undefined) {
        state.set(top[0], DONE);
        stack.pop();
        path.pop();
        continue;
      }
      const nextState = state.get(nextId);
      if (nextState === IN_PROGRESS) {
        const cycle = path.slice(path.indexOf(nextId));
        const cycleKey = [...cycle].sort().join('|');
        if (!reportedCycles.has(cycleKey)) {
          reportedCycles.add(cycleKey);
          add('error', 'parent_cycle', `${cycle.join(' -> ')} -> ${nextId} makes someone their own ancestor.`, cycle);
        }
      } else if (!nextState) {
        state.set(nextId, IN_PROGRESS);
        path.push(nextId);
        stack.push([nextId, [...(childrenOf.get(nextId) || [])]]);
      }
    }
  });

  return { ok: !issues.some((issue) => issue.severity === 'error'), issues };
};