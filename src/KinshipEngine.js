/**
 * Core Mathematical Engine for Kachin Kinship Calculations
 */

/** Apply explicit speaker-clan → target-clan → zone rules (highest priority wins per target). */
export const applyDefaultKinshipRulesToBoxes = (speakerClanId, boxes, defaultRules = []) => {
  if (!speakerClanId || !defaultRules?.length) return boxes;

  const byTarget = new Map();
  [...defaultRules]
    .filter((r) => (r.speakerClanId ?? r.speaker_clan_id) === speakerClanId)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .forEach((rule) => {
      const targetId = rule.targetClanId ?? rule.target_clan_id;
      const zone = rule.defaultAlliance ?? rule.default_alliance;
      if (!targetId || !zone || byTarget.has(targetId)) return;
      byTarget.set(targetId, zone);
    });

  byTarget.forEach((zone, clanId) => {
    if (clanId === speakerClanId) return;
    if (!boxes[zone]) boxes[zone] = new Set();
    boxes[zone].add(clanId);
  });

  return boxes;
};

export const resolveDefaultAllianceZone = (speakerClanId, targetClanId, defaultRules = []) => {
  if (!speakerClanId || !targetClanId || !defaultRules?.length) return null;

  const match = [...defaultRules]
    .filter((r) => (r.speakerClanId ?? r.speaker_clan_id) === speakerClanId
      && (r.targetClanId ?? r.target_clan_id) === targetClanId)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))[0];

  return match?.defaultAlliance ?? match?.default_alliance ?? null;
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
  boxes['Kahpu Kanau'].add(rootClanId);

  let added = false;
  let iterations = 0;

  do {
    added = false;
    iterations++;

    effectiveKinshipRules.forEach(rule => {
      const sourceClans = boxes[rule.sourceBox];
      if (!sourceClans || sourceClans.size === 0) return;

      relationships.filter(r => r.type === 'spouse').forEach(rel => {
        const p1 = persons.find(p => p.id === rel.person1Id);
        const p2 = persons.find(p => p.id === rel.person2Id);
        if (!p1 || !p2) return;

        const tryMatch = (sourceP, targetP) => {
          if (sourceClans.has(sourceP.clanId) &&
             (rule.sourceGender === 'Any' || sourceP.gender === rule.sourceGender) &&
             (rule.targetGender === 'Any' || targetP.gender === rule.targetGender) &&
             targetP.clanId && targetP.clanId !== rootClanId) {

              // In Kachin culture, Kahpu Kanau alliance box is strictly for the root clan,
              // explicit agnatic brother clans, and the Mayu-ni-a-Dama / Dama-ni-a-Mayu
              // fold-back cascades (marked `foldBack` above) -- any other rule that would
              // add a non-root clan to Kahpu Kanau is still blocked.
              if (rule.targetBox === 'Kahpu Kanau' && targetP.clanId !== rootClanId && !rule.foldBack) {
                return;
              }

              if (!boxes[rule.targetBox]) boxes[rule.targetBox] = new Set();

              if (!boxes[rule.targetBox].has(targetP.clanId)) {
                 boxes[rule.targetBox].add(targetP.clanId);
                 added = true;
              }
          }
        };

        tryMatch(p1, p2);
        tryMatch(p2, p1);
      });
    });
  } while (added && iterations < 10);

  if (defaultKinshipRules?.length) {
    applyDefaultKinshipRulesToBoxes(rootClanId, boxes, defaultKinshipRules);
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
export const calculateGenerationDiff = (speakerId, targetId, relationships, persons = []) => {
  if (speakerId === targetId) return 0;

  const graph = buildRelationshipAdjacency(relationships);

  // BFS to find shortest path tracking Mayu/Dama elevation
  const queue = [{ id: speakerId, parentLinks: 0, childLinks: 0, mayuHops: 0, damaHops: 0 }];
  const visited = new Set([speakerId]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.id === targetId) {
      const genWeight = current.parentLinks - current.childLinks;
      const mayuElevation = Math.max(0, current.mayuHops - 1);
      const damaElevation = Math.max(0, current.damaHops - 1);
      return genWeight + mayuElevation - damaElevation;
    }

    if (graph[current.id]) {
      for (const neighbor of graph[current.id]) {
        if (!visited.has(neighbor.to)) {
          visited.add(neighbor.to);

          let nextState = { ...current, id: neighbor.to };
          if (neighbor.type === 'parent') nextState.parentLinks++;
          if (neighbor.type === 'child') nextState.childLinks++;

          if (neighbor.type === 'spouse') {
            const fromPerson = persons.find(p => p.id === current.id);
            const toPerson = persons.find(p => p.id === neighbor.to);
            if (fromPerson && toPerson) {
              if ((fromPerson.gender === 'M' || fromPerson.gender === 'Male') && (toPerson.gender === 'F' || toPerson.gender === 'Female')) {
                nextState.mayuHops++;
              } else if ((fromPerson.gender === 'F' || fromPerson.gender === 'Female') && (toPerson.gender === 'M' || toPerson.gender === 'Male')) {
                nextState.damaHops++;
              }
            }
          }

          queue.push(nextState);
        }
      }
    }
  }

  // Fallback if disconnected
  return null;
};

// 2.5 Educational Path Tracing (Max Depth 6)
export const findClanConnectionPath = (speakerId, targetClanId, relationships, persons, maxDepth = 6) => {
  if (!speakerId || !targetClanId) return null;

  const graph = buildRelationshipAdjacency(relationships);
  const displayLabel = (type) => type.charAt(0).toUpperCase() + type.slice(1);

  const queue = [{ id: speakerId, depth: 0, path: [] }];
  const visited = new Set([speakerId]);

  while (queue.length > 0) {
    const { id, depth, path } = queue.shift();
    const currentPerson = persons.find(p => p.id === id);

    // If we found someone in the target clan (and they are not the speaker)
    if (currentPerson && currentPerson.clanId === targetClanId && id !== speakerId) {
      return path.concat({ person: currentPerson, relation: 'Target Clan Member' });
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
  const direct = relationships.some(r => r.type === 'sibling' &&
    ((r.person1Id === p1Id && r.person2Id === p2Id) || (r.person2Id === p1Id && r.person1Id === p1Id || (r.person1Id === p2Id && r.person2Id === p1Id)))
  );
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
const rankZoneMatch = (zone, clanId, speakerClanId, manualZones, defaultKinshipRules) => {
  if (zone === 'Kahpu Kanau' && clanId === speakerClanId) return 1;
  if (zone === 'Mayu' || zone === 'Dama') return 1;
  if (manualZones?.[zone]?.includes?.(clanId)) return 2;
  const hasDefaultRule = (defaultKinshipRules || []).some((r) =>
    (r.speakerClanId ?? r.speaker_clan_id) === speakerClanId
    && (r.targetClanId ?? r.target_clan_id) === clanId
    && (r.defaultAlliance ?? r.default_alliance) === zone);
  if (hasDefaultRule) return 3;
  return 4;
};

const sortZonesByPriority = (zones, clanId, speakerClanId, manualZones, defaultKinshipRules) => [...zones].sort((a, b) => {
  const ta = rankZoneMatch(a, clanId, speakerClanId, manualZones, defaultKinshipRules);
  const tb = rankZoneMatch(b, clanId, speakerClanId, manualZones, defaultKinshipRules);
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
    Object.entries(manualZones).forEach(([zone, clanIds]) => {
      if (!boxes[zone] || !Array.isArray(clanIds)) return;
      clanIds.forEach((clanId) => boxes[zone].add(clanId));
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
      const matchingZones = ZONE_DISPLAY_ORDER.filter((zoneName) => boxes[zoneName]?.has(target.clanId));
      if (matchingZones.length > 0) {
        targetZone = sortZonesByPriority(matchingZones, target.clanId, speaker.clanId, manualZones, defaultKinshipRules)[0];
      }
    }

    if (!targetZone && speaker.clanId && target.clanId === speaker.clanId) {
      targetZone = 'Kahpu Kanau';
    }

    if (!targetZone && speaker.clanId && target.clanId) {
      targetZone = resolveDefaultAllianceZone(speaker.clanId, target.clanId, defaultKinshipRules);
    }
  }

  // 2. Pre-calculate direct relations for exceptions
  let isSpouseParent = false;
  let isDirectSpouse = false;

  const speakerSpouses = relationships.filter(r => r.type === 'spouse' && (r.person1Id === speaker.id || r.person2Id === speaker.id)).map(r => r.person1Id === speaker.id ? r.person2Id : r.person1Id);

  if (speakerSpouses.includes(target.id)) {
    isDirectSpouse = true;
  }

  if (speakerSpouses.length > 0) {
    isSpouseParent = relationships.some(r => r.type === 'parent' && speakerSpouses.includes(r.person2Id) && r.person1Id === target.id);
  }

  // A sister's child gets its own distinct term (maternal uncle vs. paternal
  // uncle) -- unlike a brother's child, who stays inside the speaker's own
  // patrilineal line and is already covered by the generation-based engines.
  const speakerSiblingIds = persons.filter(p => p.id !== speaker.id && areSiblings(speaker.id, p.id, relationships)).map(p => p.id);
  const speakerSisterIds = speakerSiblingIds.filter(id => persons.find(p => p.id === id)?.gender === 'Female');
  const isSistersChild = speakerSisterIds.length > 0 && relationships.some(r => r.type === 'parent' && speakerSisterIds.includes(r.person1Id) && r.person2Id === target.id);

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
    if (r.exception_flag === 'direct_mother_in_law' && isSpouseParent && tGender === 'F') return true;
    if (r.exception_flag === 'direct_female_sibling_child' && isSistersChild) return true;

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
      Object.entries(manualZones).forEach(([zone, clanIds]) => {
        if (!boxes[zone] || !Array.isArray(clanIds)) return;
        clanIds.forEach((clanId) => boxes[zone].add(clanId));
      });
    }
    const matchedZones = Object.keys(boxes).filter((zone) => boxes[zone]?.has(target.clanId));

    const genDiff = manualGenDiff !== null ? manualGenDiff : calculateGenerationDiff(speaker.id, target.id, relationships, persons);
    const seniority = manualSeniority !== null ? manualSeniority : calculateSeniority(speaker, target, relationships, persons);
    const sGender = normG(speaker.gender);
    const tGender = normG(target.gender);
    // Same Respect Elevation Override Rule calculateKinshipTerm applies.
    const effectiveGenDiff = (zone) => (zone === 'Mayu ni a Mayu' && genDiff !== null && genDiff >= 2) ? 99 : genDiff;

    if (matchedZones.length > 0) {
      // Higher-priority zones (own clan, Mayu/Dama, then manual, then admin
      // default rules) come first -- see sortZonesByPriority's own comment.
      const orderedZones = sortZonesByPriority(matchedZones, target.clanId, speaker.clanId, manualZones, defaultKinshipRules);
      const results = orderedZones
        .map((zone) => resolveTermForZone(zone, effectiveGenDiff(zone), seniority, termRules, sGender, tGender))
        .filter(Boolean);
      if (results.length > 0) return results;
    }

    // No box match at all -- fall back to the admin-configured default rule
    // for this exact clan pair, if one exists.
    const defaultZone = resolveDefaultAllianceZone(speaker.clanId, target.clanId, defaultKinshipRules);
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

    if (person.clanId === rootPerson.clanId) {
      boxes['Kahpu Kanau'].add(person.clanId);
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
      // and explicit agnatic brother clans. Do not allow indirect tree paths to add non-root clans to Kahpu Kanau.
      if (kinship.zone === 'Kahpu Kanau' && person.clanId !== rootPerson.clanId) {
        return;
      }
      boxes[kinship.zone].add(person.clanId);
    }
  });

  return boxes;
};

export const allianceBoxesToRecords = (boxes, { treeId, anchorClanId, source = 'engine' }) => {
  const records = [];
  Object.entries(boxes).forEach(([zone, clanSet]) => {
    clanSet.forEach((clanId) => {
      records.push({ treeId, anchorClanId, clanId, zone, source });
    });
  });
  return records;
};

export const allianceRecordsToBoxes = (records, anchorClanId) => {
  const boxes = emptyKinshipBoxes();
  records
    .filter((r) => r.anchorClanId === anchorClanId)
    .forEach((r) => {
      if (boxes[r.zone]) boxes[r.zone].add(r.clanId);
    });
  return boxes;
};
