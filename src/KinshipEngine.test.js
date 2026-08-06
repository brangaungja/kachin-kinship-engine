import { describe, it, expect } from 'vitest';
import {
  calculateGenerationDiff,
  areSiblings,
  calculateSeniority,
  getKinshipBoxesForPerson,
  calculateKinshipTerm,
  calculateAllKinshipTerms,
  computeAllianceZoneBoxes,
  allianceBoxesToRecords,
  allianceRecordsToBoxes,
  resolveDefaultAllianceZone,
  DEFAULT_KINSHIP_BOX_RULES,
} from './KinshipEngine.js';

// Wildcard term rules (generation: 99 matches any computed generation, per
// resolveTermForZone's exact-then-wildcard fallback) -- used wherever a test
// only cares about which ZONE gets resolved, not term-selection itself.
const ZONE_ONLY_TERM_RULES = [
  { alliance_zone: 'Kahpu Kanau', generation: 99, relative_age: 'any', target_gender: 'any', speaker_gender: 'any', term_you_call_them: 'KahpuKanauTerm', term_they_call_you: 'x' },
  { alliance_zone: 'Mayu', generation: 99, relative_age: 'any', target_gender: 'any', speaker_gender: 'any', term_you_call_them: 'MayuTerm', term_they_call_you: 'x' },
  { alliance_zone: 'Mayu ni a Mayu', generation: 99, relative_age: 'any', target_gender: 'any', speaker_gender: 'any', term_you_call_them: 'MnMTerm', term_they_call_you: 'x' },
  { alliance_zone: 'Dama', generation: 99, relative_age: 'any', target_gender: 'any', speaker_gender: 'any', term_you_call_them: 'DamaTerm', term_they_call_you: 'x' },
  { alliance_zone: 'Dama ni a Dama', generation: 99, relative_age: 'any', target_gender: 'any', speaker_gender: 'any', term_you_call_them: 'DnDTerm', term_they_call_you: 'x' },
];

// A trimmed but realistic slice of the app's real Kinship Dictionary --
// enough zones/generations to exercise every branch of calculateKinshipTerm
// with real Kachin terms, without importing the app's own blueprint (this
// package stays a standalone, dependency-free engine).
const REAL_TERM_RULES = [
  { alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'F', speaker_gender: 'any', term_you_call_them: 'Madu Jan', term_they_call_you: 'Madu Wa', exception_flag: 'direct_spouse' },
  { alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'M', speaker_gender: 'any', term_you_call_them: 'Madu Wa', term_they_call_you: 'Madu Jan', exception_flag: 'direct_spouse' },
  { alliance_zone: 'Kahpu Kanau', generation: 1, relative_age: 'any', target_gender: 'M', speaker_gender: 'M', term_you_call_them: 'Kawa', term_they_call_you: 'Kasha' },
  { alliance_zone: 'Mayu', generation: 1, relative_age: 'any', target_gender: 'F', speaker_gender: 'M', term_you_call_them: 'Kani', term_they_call_you: 'Hkri' },
  { alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'older', target_gender: 'M', speaker_gender: 'M', term_you_call_them: 'Kahpu', term_they_call_you: 'Kanau' },
  { alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'younger', target_gender: 'M', speaker_gender: 'M', term_you_call_them: 'Kanau', term_they_call_you: 'Kahpu' },
  { alliance_zone: 'Kahpu Kanau', generation: 1, relative_age: 'any', target_gender: 'F', speaker_gender: 'M', term_you_call_them: 'Kamoi', term_they_call_you: 'Kanam' },
  { alliance_zone: 'Dama', generation: 1, relative_age: 'any', target_gender: 'M', speaker_gender: 'M', term_you_call_them: 'Gu', term_they_call_you: 'Kanam' },
  { alliance_zone: 'Mayu ni a Mayu', generation: 1, relative_age: 'any', target_gender: 'M', speaker_gender: 'M', term_you_call_them: 'Katsa', term_they_call_you: 'Hkri' },
  // Grandparent/grandchild are zone-invariant in the real dictionary -- every
  // zone maps generation +/-2 to the same term.
  ...['Kahpu Kanau', 'Mayu', 'Dama'].flatMap((zone) => [
    { alliance_zone: zone, generation: 2, relative_age: 'any', target_gender: 'M', speaker_gender: 'any', term_you_call_them: 'Ji', term_they_call_you: 'Kashu' },
    { alliance_zone: zone, generation: 2, relative_age: 'any', target_gender: 'F', speaker_gender: 'any', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu' },
    { alliance_zone: zone, generation: -2, relative_age: 'any', target_gender: 'M', speaker_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Ji' },
    { alliance_zone: zone, generation: -2, relative_age: 'any', target_gender: 'F', speaker_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi' },
  ]),
  { alliance_zone: 'any', generation: 99, relative_age: 'any', target_gender: 'M', speaker_gender: 'any', term_you_call_them: 'Ji', term_they_call_you: 'Kashu' },
  { alliance_zone: 'any', generation: 99, relative_age: 'any', target_gender: 'F', speaker_gender: 'any', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu' },
];

const male = (id, clanId, extra = {}) => ({ id, gender: 'Male', clanId, ...extra });
const female = (id, clanId, extra = {}) => ({ id, gender: 'Female', clanId, ...extra });
const parent = (parentId, childId) => ({ type: 'parent', person1Id: parentId, person2Id: childId });
const spouse = (aId, bId) => ({ type: 'spouse', person1Id: aId, person2Id: bId });
const sibling = (aId, bId) => ({ type: 'sibling', person1Id: aId, person2Id: bId });

describe('calculateGenerationDiff', () => {
  it('is 0 for the same person', () => {
    expect(calculateGenerationDiff('a', 'a', [])).toBe(0);
  });

  it('is 1 for a direct parent, -1 for a direct child', () => {
    const rels = [parent('p', 'c')];
    expect(calculateGenerationDiff('c', 'p', rels)).toBe(1);
    expect(calculateGenerationDiff('p', 'c', rels)).toBe(-1);
  });

  it('is 2 for a grandparent, -2 for a grandchild', () => {
    const rels = [parent('gp', 'p'), parent('p', 'c')];
    expect(calculateGenerationDiff('c', 'gp', rels)).toBe(2);
    expect(calculateGenerationDiff('gp', 'c', rels)).toBe(-2);
  });

  it('returns null when the two people are not connected', () => {
    const rels = [parent('p', 'c')];
    expect(calculateGenerationDiff('c', 'stranger', rels)).toBeNull();
  });
});

describe('areSiblings', () => {
  it('is true for an explicit sibling relationship', () => {
    expect(areSiblings('a', 'b', [sibling('a', 'b')])).toBe(true);
  });

  it('is true when two people share a recorded parent', () => {
    const rels = [parent('mom', 'a'), parent('mom', 'b')];
    expect(areSiblings('a', 'b', rels)).toBe(true);
  });

  it('is false for unrelated people', () => {
    expect(areSiblings('a', 'b', [])).toBe(false);
  });

  it('is false for the same person', () => {
    expect(areSiblings('a', 'a', [sibling('a', 'a')])).toBe(false);
  });
});

describe('calculateSeniority', () => {
  it('uses birthOrder between direct siblings when both have one', () => {
    // Return value describes the TARGET's seniority relative to the speaker.
    const speaker = { id: 's', birthOrder: 1 }; // born first -> older
    const target = { id: 't', birthOrder: 2 }; // born second -> younger
    const rels = [sibling('s', 't')];
    expect(calculateSeniority(speaker, target, rels, [speaker, target])).toBe('younger');
    expect(calculateSeniority(target, speaker, rels, [speaker, target])).toBe('older');
  });

  it('falls back to DOB when birthOrder is absent', () => {
    const speaker = { id: 's', dob: '1990-01-01' }; // earlier DOB -> older
    const target = { id: 't', dob: '1995-01-01' }; // later DOB -> younger
    expect(calculateSeniority(speaker, target, [], [speaker, target])).toBe('younger');
  });

  it('is unknown with no DOB, no birthOrder, and no relation to lean on', () => {
    const speaker = { id: 's' };
    const target = { id: 't' };
    expect(calculateSeniority(speaker, target, [], [speaker, target])).toBe('unknown');
  });

  it('inherits seniority through a sibling chain when the target has no DOB of their own', () => {
    // Speaker's cousin line: Wadi + Tung have two children. TungChild has a
    // DOB (younger than speaker); TungChild2 has no DOB, only a birthOrder
    // placed after TungChild on the same day-number scale.
    const dobDayNumber = Math.floor(new Date('2000-01-01').getTime() / 86400000);
    const speaker = { id: 'S', dob: '1994-01-01' };
    const tungChild = { id: 'TungChild', dob: '2000-01-01' };
    const tungChild2 = { id: 'TungChild2', birthOrder: dobDayNumber + 1000 };
    const persons = [speaker, tungChild, tungChild2];
    const rels = [
      sibling('TungChild', 'TungChild2'),
      parent('Wadi', 'TungChild'),
      parent('Wadi', 'TungChild2'),
    ];
    expect(calculateSeniority(speaker, tungChild2, rels, persons)).toBe('younger');
  });
});

describe('getKinshipBoxesForPerson', () => {
  it('cascades Kahpu Kanau -> Mayu -> Mayu ni a Mayu through recorded marriages', () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('M', 'MayuClan'),
      male('MB', 'MayuClan'), female('W2', 'X'),
    ];
    const rels = [parent('F', 'S'), parent('M', 'S'), spouse('F', 'M'), sibling('M', 'MB'), spouse('MB', 'W2')];
    const boxes = getKinshipBoxesForPerson('S', persons, rels, DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes['Kahpu Kanau'].has('K')).toBe(true);
    expect(boxes['Mayu'].has('MayuClan')).toBe(true);
    expect(boxes['Mayu ni a Mayu'].has('X')).toBe(true);
  });

  it('folds a Mayu-woman-marries-out clan back into Kahpu Kanau', () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('M', 'MayuClan'), female('MS', 'MayuClan'), male('MSH', 'ThirdClan'),
    ];
    // F isn't recorded as S's parent here (only M is) -- F just needs to be
    // someone of clan K married to M, so the Kahpu Kanau -> Mayu cascade has
    // a spouse link to classify MayuClan through in the first place.
    const rels = [parent('M', 'S'), spouse('F', 'M'), sibling('M', 'MS'), spouse('MS', 'MSH')];
    const boxes = getKinshipBoxesForPerson('S', persons, rels, DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes['Kahpu Kanau'].has('ThirdClan')).toBe(true);
    expect(boxes['Kahpu Kanau'].has('K')).toBe(true);
  });

  it('folds a Dama-man-marries-out clan back into Kahpu Kanau (mirror case)', () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('FSis', 'K'),
      male('FSisH', 'DamaClan'), male('FSisHBro', 'DamaClan'), female('FoldWife', 'FoldClan'),
    ];
    const rels = [
      parent('F', 'S'), sibling('F', 'FSis'), spouse('FSis', 'FSisH'),
      sibling('FSisH', 'FSisHBro'), spouse('FSisHBro', 'FoldWife'),
    ];
    const boxes = getKinshipBoxesForPerson('S', persons, rels, DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes['Dama'].has('DamaClan')).toBe(true);
    expect(boxes['Kahpu Kanau'].has('FoldClan')).toBe(true);
  });

  it('returns empty boxes when the speaker has no clan', () => {
    const boxes = getKinshipBoxesForPerson('S', [{ id: 'S' }], [], DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes['Kahpu Kanau'].size).toBe(0);
  });
});

describe('calculateKinshipTerm: direct relations', () => {
  it('resolves a direct spouse via the exception rule', () => {
    const s = male('S', 'K');
    const w = female('W', 'MayuClan');
    const res = calculateKinshipTerm(s, w, [s, w], [spouse('S', 'W')], DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res?.youCallThem).toBe('Madu Jan');
  });

  it('resolves a direct father', () => {
    const s = male('S', 'K');
    const f = male('F', 'K');
    const res = calculateKinshipTerm(s, f, [s, f], [parent('F', 'S')], DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res?.youCallThem).toBe('Kawa');
  });

  it('resolves a direct mother', () => {
    const s = male('S', 'K');
    const m = female('M', 'MayuClan');
    const res = calculateKinshipTerm(s, m, [s, m], [parent('M', 'S')], DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res?.youCallThem).toBe('Kani');
  });

  it('resolves an older vs younger sibling to different terms', () => {
    const s = male('S', 'K', { birthOrder: 2 });
    const older = male('Older', 'K', { birthOrder: 1 });
    const younger = male('Younger', 'K', { birthOrder: 3 });
    const rels = [sibling('S', 'Older'), sibling('S', 'Younger')];
    const persons = [s, older, younger];
    expect(calculateKinshipTerm(s, older, persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES)?.youCallThem).toBe('Kahpu');
    expect(calculateKinshipTerm(s, younger, persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES)?.youCallThem).toBe('Kanau');
  });

  it('returns null for someone with no clan link and no tree relation', () => {
    const s = male('S', 'K');
    const stranger = male('X', 'UnrelatedClan');
    const res = calculateKinshipTerm(s, stranger, [s, stranger], [], DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res).toBeNull();
  });
});

describe('calculateKinshipTerm: structural branches (aunt/uncle, cousins, in-laws)', () => {
  it("resolves a parent's sibling (aunt/uncle)", () => {
    const s = male('S', 'K');
    const f = male('F', 'K');
    const fSis = female('FSis', 'K');
    const persons = [s, f, fSis];
    const rels = [parent('F', 'S'), sibling('F', 'FSis')];
    const res = calculateKinshipTerm(s, fSis, persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res?.youCallThem).toBe('Kamoi');
  });

  it("resolves a father's sister's husband to Dama", () => {
    const persons = [male('S', 'K'), male('F', 'K'), female('FSis', 'K'), male('FSisH', 'DamaClan')];
    const rels = [parent('F', 'S'), sibling('F', 'FSis'), spouse('FSis', 'FSisH')];
    const res = calculateKinshipTerm(persons[0], persons[3], persons, rels, DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES);
    expect(res?.zone).toBe('Dama');
  });

  it("resolves a mother's sister's child (first cousin) structurally", () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('M', 'MayuClan'),
      female('MS', 'MayuClan'), male('MSH', 'ThirdClan'), female('C', 'ThirdClan'),
    ];
    const rels = [
      parent('F', 'S'), parent('M', 'S'), spouse('F', 'M'),
      sibling('M', 'MS'), spouse('MS', 'MSH'), parent('MSH', 'C'), parent('MS', 'C'),
    ];
    const res = calculateKinshipTerm(persons[0], persons[5], persons, rels, DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES);
    expect(res?.zone).toBe('Kahpu Kanau');
  });

  it("resolves a mother's brother's child to Mayu", () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('M', 'MayuClan'),
      male('MB', 'MayuClan'), female('MBW', 'Z'), male('MBChild', 'MayuClan'),
    ];
    const rels = [
      parent('F', 'S'), parent('M', 'S'), sibling('M', 'MB'),
      spouse('MB', 'MBW'), parent('MB', 'MBChild'), parent('MBW', 'MBChild'),
    ];
    const res = calculateKinshipTerm(persons[0], persons[5], persons, rels, DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES);
    expect(res?.zone).toBe('Mayu');
  });
});

describe('calculateKinshipTerm: ancestor/descendant chains (grandparent fix)', () => {
  // Regression coverage for the bug where a grandparent added before their
  // own spouse existed in the tree resolved to no kinship term at all,
  // because the old code depended entirely on a spouse-linked clan cascade
  // to classify anyone 2+ generations away.
  it('resolves a maternal grandmother even before her husband is recorded', () => {
    const persons = [male('root', 'A'), male('dad', 'A'), female('mom', 'B'), female('grandma', 'C')];
    const rels = [parent('dad', 'root'), parent('mom', 'root'), spouse('dad', 'mom'), parent('grandma', 'mom')];
    const res = calculateKinshipTerm(persons[0], persons[3], persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res?.youCallThem).toBe('Dwi');
  });

  it('resolves both grandparents once the second one (and their spouse link) is added', () => {
    const persons = [male('root', 'A'), male('dad', 'A'), female('mom', 'B'), female('grandma', 'C'), male('grandpa', 'B')];
    const rels = [
      parent('dad', 'root'), parent('mom', 'root'), spouse('dad', 'mom'),
      parent('grandma', 'mom'), parent('grandpa', 'mom'), spouse('grandpa', 'grandma'),
    ];
    expect(calculateKinshipTerm(persons[0], persons[3], persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES)?.youCallThem).toBe('Dwi');
    expect(calculateKinshipTerm(persons[0], persons[4], persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES)?.youCallThem).toBe('Ji');
  });

  it('resolves a great-grandparent with no spouse links recorded anywhere in the chain', () => {
    const persons = [male('root', 'A'), male('dad', 'A'), male('gpa', 'A'), male('ggpa', 'A')];
    const rels = [parent('dad', 'root'), parent('gpa', 'dad'), parent('ggpa', 'gpa')];
    const res = calculateKinshipTerm(persons[0], persons[3], persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res?.youCallThem).toBe('Ji');
  });

  it('resolves a grandchild and great-grandchild symmetrically', () => {
    const persons = [female('root', 'A'), male('child', 'A'), female('gc', 'A'), male('ggc', 'A')];
    const rels = [parent('root', 'child'), parent('child', 'gc'), parent('gc', 'ggc')];
    expect(calculateKinshipTerm(persons[0], persons[2], persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES)?.youCallThem).toBe('Kashu');
    expect(calculateKinshipTerm(persons[0], persons[3], persons, rels, DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES)?.youCallThem).toBe('Kashu');
  });

  it('does not treat an unrelated same-generation person as an ancestor/descendant', () => {
    const s = male('S', 'K');
    const other = male('O', 'K'); // same clan, but zero recorded relationship
    // Same-clan-as-speaker still resolves via the Kahpu Kanau same-clan
    // fallback, so use a different clan to isolate the ancestor-chain branch.
    const unrelated = male('U', 'UnrelatedClan');
    const res = calculateKinshipTerm(s, unrelated, [s, other, unrelated], [], DEFAULT_KINSHIP_BOX_RULES, REAL_TERM_RULES);
    expect(res).toBeNull();
  });
});

describe('calculateKinshipTerm: unknown seniority', () => {
  const seniorityTermRules = [
    { alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'older', target_gender: 'M', speaker_gender: 'any', term_you_call_them: 'Kahpu', term_they_call_you: 'Kanau' },
    { alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'younger', target_gender: 'M', speaker_gender: 'any', term_you_call_them: 'Kanau', term_they_call_you: 'Kahpu' },
  ];

  it('combines both terms when neither side has any basis for seniority', () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('M', 'Lahtaw', { birthOrder: 2 }),
      female('Tung', 'Lahtaw', { birthOrder: 3 }), male('Wadi', 'Maran'), male('TungChild', 'Maran'),
    ];
    const rels = [
      parent('F', 'S'), parent('M', 'S'), spouse('F', 'M'),
      sibling('M', 'Tung'), spouse('Wadi', 'Tung'), parent('Wadi', 'TungChild'), parent('Tung', 'TungChild'),
    ];
    const res = calculateKinshipTerm(persons[0], persons[5], persons, rels, DEFAULT_KINSHIP_BOX_RULES, seniorityTermRules);
    expect(res?.youCallThem).toBe('Kahpu / Kanau');
  });

  it('resolves definitively once both people have a DOB', () => {
    const persons = [
      { ...male('S', 'K'), dob: '1994-01-01' }, male('F', 'K'), female('M', 'Lahtaw'),
      female('Tung', 'Lahtaw'), male('Wadi', 'Maran'), { ...male('TungChild', 'Maran'), dob: '2000-01-01' },
    ];
    const rels = [
      parent('F', 'S'), parent('M', 'S'), spouse('F', 'M'),
      sibling('M', 'Tung'), spouse('Wadi', 'Tung'), parent('Wadi', 'TungChild'), parent('Tung', 'TungChild'),
    ];
    const res = calculateKinshipTerm(persons[0], persons[5], persons, rels, DEFAULT_KINSHIP_BOX_RULES, seniorityTermRules);
    expect(res?.youCallThem).toBe('Kanau');
  });
});

describe('calculateAllKinshipTerms', () => {
  it('returns multiple candidate zones for a clan that is ambiguous by construction', () => {
    const persons = [
      male('S', 'K'), male('F', 'K'), female('M', 'MayuClan'), male('MB', 'MayuClan'),
      female('W2', 'X'), male('FB', 'K'), female('W3', 'X'),
    ];
    const rels = [
      parent('F', 'S'), parent('M', 'S'), spouse('F', 'M'), sibling('M', 'MB'),
      spouse('MB', 'W2'), sibling('F', 'FB'), spouse('FB', 'W3'),
    ];
    const speaker = persons[0];
    const strangerTarget = { id: 'stranger', clanId: 'X', gender: 'F' };
    const results = calculateAllKinshipTerms(
      speaker, strangerTarget, persons, rels, DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES,
      0, 'any', null, null,
    );
    expect(results.length).toBe(2);
    expect(results.map((r) => r.zone).sort()).toEqual(['Mayu', 'Mayu ni a Mayu']);
  });

  it('surfaces a manual zone override even with zero tree relation', () => {
    const speaker = male('S', 'K');
    const manualOnlyTarget = { id: 'stranger', clanId: 'Y', gender: 'F' };
    const results = calculateAllKinshipTerms(
      speaker, manualOnlyTarget, [speaker], [], DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES,
      0, 'any', { Dama: ['Y'] }, null,
    );
    expect(results.length).toBe(1);
    expect(results[0]?.zone).toBe('Dama');
  });

  it('falls back to an admin default rule when there is zero box match', () => {
    const speaker = male('S', 'K');
    const noRelationTarget = { id: 'stranger', clanId: 'UnrelatedClan', gender: 'F' };
    const defaultRules = [{ speakerClanId: 'K', targetClanId: 'UnrelatedClan', defaultAlliance: 'Dama', priority: 1 }];

    const withDefault = calculateAllKinshipTerms(
      speaker, noRelationTarget, [speaker], [], DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES,
      0, 'any', null, defaultRules,
    );
    expect(withDefault.length).toBe(1);
    expect(withDefault[0]?.zone).toBe('Dama');

    const withoutDefault = calculateAllKinshipTerms(
      speaker, noRelationTarget, [speaker], [], DEFAULT_KINSHIP_BOX_RULES, ZONE_ONLY_TERM_RULES,
      0, 'any', null, null,
    );
    expect(withoutDefault.length).toBe(0);
  });
});

describe('resolveDefaultAllianceZone', () => {
  it('picks the highest-priority rule for a speaker/target clan pair', () => {
    const rules = [
      { speakerClanId: 'K', targetClanId: 'Z', defaultAlliance: 'Dama', priority: 1 },
      { speakerClanId: 'K', targetClanId: 'Z', defaultAlliance: 'Mayu', priority: 5 },
    ];
    expect(resolveDefaultAllianceZone('K', 'Z', rules)).toBe('Mayu');
  });

  it('returns null with no matching rule', () => {
    expect(resolveDefaultAllianceZone('K', 'Z', [])).toBeNull();
  });
});

describe('computeAllianceZoneBoxes / allianceBoxesToRecords / allianceRecordsToBoxes', () => {
  it('round-trips a computed zone map through the record format', () => {
    const rootPerson = male('S', 'K');
    const persons = [rootPerson, male('F', 'K'), female('M', 'MayuClan')];
    const rels = [parent('F', 'S'), parent('M', 'S'), spouse('F', 'M')];

    const boxes = computeAllianceZoneBoxes({
      rootPerson,
      persons,
      relationships: rels,
      kinshipRules: DEFAULT_KINSHIP_BOX_RULES,
      kinshipTermRules: ZONE_ONLY_TERM_RULES,
    });
    expect(boxes['Mayu'].has('MayuClan')).toBe(true);

    const records = allianceBoxesToRecords(boxes, { treeId: 't1', anchorClanId: 'K' });
    expect(records).toContainEqual({ treeId: 't1', anchorClanId: 'K', clanId: 'MayuClan', zone: 'Mayu', source: 'engine' });

    const rebuilt = allianceRecordsToBoxes(records, 'K');
    expect(rebuilt['Mayu'].has('MayuClan')).toBe(true);
  });

  it('returns empty boxes when the root person has no clan', () => {
    const boxes = computeAllianceZoneBoxes({
      rootPerson: { id: 'S' },
      persons: [{ id: 'S' }],
      relationships: [],
      kinshipRules: DEFAULT_KINSHIP_BOX_RULES,
      kinshipTermRules: ZONE_ONLY_TERM_RULES,
    });
    expect(boxes['Kahpu Kanau'].size).toBe(0);
  });
});
