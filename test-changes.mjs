import {
  calculateKinshipTerm,
  calculateAllKinshipTerms,
  getKinshipBoxesForPerson,
  DEFAULT_KINSHIP_BOX_RULES,
} from './src/KinshipEngine.js';

let failures = 0;
const check = (label, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures += 1;
    console.log(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
};

// Wildcard term rules (generation:99 = matches any computed generation, per
// resolveTermForZone's own exact-then-wildcard fallback) -- these tests only
// care about which ZONE gets resolved, not the term-selection logic itself.
const termRules = [
  { engine_type: 'any', speaker_gender: 'any', alliance_zone: 'Kahpu Kanau', generation: 99, relative_age: 'any', target_gender: 'any', term_you_call_them: 'KahpuKanauTerm', term_they_call_you: 'x', cultural_notes: '', exception_flag: 'none' },
  { engine_type: 'any', speaker_gender: 'any', alliance_zone: 'Mayu', generation: 99, relative_age: 'any', target_gender: 'any', term_you_call_them: 'MayuTermF', term_they_call_you: 'x', cultural_notes: '', exception_flag: 'none' },
  { engine_type: 'any', speaker_gender: 'any', alliance_zone: 'Mayu ni a Mayu', generation: 99, relative_age: 'any', target_gender: 'any', term_you_call_them: 'MnMTermF', term_they_call_you: 'x', cultural_notes: '', exception_flag: 'none' },
  { engine_type: 'any', speaker_gender: 'any', alliance_zone: 'Dama', generation: 99, relative_age: 'any', target_gender: 'any', term_you_call_them: 'DamaTermM', term_they_call_you: 'x', cultural_notes: '', exception_flag: 'none' },
];

// ---------- Scenario 1: mother's sister's child (structural case) ----------
{
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'M', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MS', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MSH', gender: 'Male', clanId: 'ThirdClan' },
    { id: 'C', gender: 'Female', clanId: 'ThirdClan' },
  ];
  const relationships = [
    { person1Id: 'F', person2Id: 'S', type: 'parent' },
    { person1Id: 'M', person2Id: 'S', type: 'parent' },
    { person1Id: 'F', person2Id: 'M', type: 'spouse' },
    { person1Id: 'M', person2Id: 'MS', type: 'sibling' },
    { person1Id: 'MS', person2Id: 'MSH', type: 'spouse' },
    { person1Id: 'MSH', person2Id: 'C', type: 'parent' },
    { person1Id: 'MS', person2Id: 'C', type: 'parent' },
  ];
  const speaker = persons.find((p) => p.id === 'S');
  const cousin = persons.find((p) => p.id === 'C');
  const res = calculateKinshipTerm(speaker, cousin, persons, relationships, DEFAULT_KINSHIP_BOX_RULES, termRules);
  check('1. mother\'s sister\'s child resolves (not null)', res !== null, true);
  check('1. mother\'s sister\'s child -> Kahpu Kanau', res?.zone, 'Kahpu Kanau');
}

// ---------- Scenario 2: box-cascade fold-back in isolation (no structural path) ----------
{
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'M', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MS', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MSH', gender: 'Male', clanId: 'ThirdClan' },
  ];
  const relationships = [
    { person1Id: 'M', person2Id: 'S', type: 'parent' },
    { person1Id: 'F', person2Id: 'M', type: 'spouse' },
    { person1Id: 'M', person2Id: 'MS', type: 'sibling' },
    { person1Id: 'MS', person2Id: 'MSH', type: 'spouse' },
  ];
  const boxes = getKinshipBoxesForPerson('S', persons, relationships, DEFAULT_KINSHIP_BOX_RULES, null);
  check('2. ThirdClan (Mayu-woman-marries-out) folds into Kahpu Kanau box', boxes['Kahpu Kanau'].has('ThirdClan'), true);
  check('2. Kahpu Kanau box still contains the real root clan too', boxes['Kahpu Kanau'].has('K'), true);
}

// ---------- Scenario 2b: mirror fold-back (Dama-man-marries-out) ----------
{
  const persons = [
    { id: 'S', gender: 'Female', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'FS', gender: 'Female', clanId: 'DamaClan' }, // father's sister's husband's own sister-in-law chain
  ];
  // Build: F's sister (FSis) married out -> her husband's clan = Dama (existing rule).
  // Then that husband's own BROTHER marries someone -> her clan should fold to Kahpu Kanau (Dama ni a Mayu).
  const persons2 = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'FSis', gender: 'Female', clanId: 'K' },
    { id: 'FSisH', gender: 'Male', clanId: 'DamaClan' },
    { id: 'FSisHBro', gender: 'Male', clanId: 'DamaClan' },
    { id: 'FoldWife', gender: 'Female', clanId: 'FoldClan' },
  ];
  const relationships2 = [
    { person1Id: 'F', person2Id: 'S', type: 'parent' },
    { person1Id: 'F', person2Id: 'FSis', type: 'sibling' },
    { person1Id: 'FSis', person2Id: 'FSisH', type: 'spouse' },
    { person1Id: 'FSisH', person2Id: 'FSisHBro', type: 'sibling' },
    { person1Id: 'FSisHBro', person2Id: 'FoldWife', type: 'spouse' },
  ];
  const boxes = getKinshipBoxesForPerson('S', persons2, relationships2, DEFAULT_KINSHIP_BOX_RULES, null);
  check('2b. DamaClan correctly resolved as Dama', boxes['Dama'].has('DamaClan'), true);
  check('2b. FoldClan (Dama-man-marries-out) folds into Kahpu Kanau', boxes['Kahpu Kanau'].has('FoldClan'), true);
}

// ---------- Scenario 3: tie-break priority reorder (Mayu should now beat Mayu ni a Mayu) ----------
{
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'M', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MB', gender: 'Male', clanId: 'MayuClan' }, // mother's brother
    { id: 'W2', gender: 'Female', clanId: 'X' },        // MB's wife -> X = Mayu ni a Mayu
    { id: 'FB', gender: 'Male', clanId: 'K' },          // father's brother
    { id: 'W3', gender: 'Female', clanId: 'X' },        // FB's wife -> X = Mayu (direct), same clan X!
  ];
  const relationships = [
    { person1Id: 'F', person2Id: 'S', type: 'parent' },
    { person1Id: 'M', person2Id: 'S', type: 'parent' },
    { person1Id: 'F', person2Id: 'M', type: 'spouse' },
    { person1Id: 'M', person2Id: 'MB', type: 'sibling' },
    { person1Id: 'MB', person2Id: 'W2', type: 'spouse' },
    { person1Id: 'F', person2Id: 'FB', type: 'sibling' },
    { person1Id: 'FB', person2Id: 'W3', type: 'spouse' },
  ];
  const boxes = getKinshipBoxesForPerson('S', persons, relationships, DEFAULT_KINSHIP_BOX_RULES, null);
  check('3. clan X matches both Mayu and Mayu ni a Mayu (ambiguous by construction)',
    boxes['Mayu'].has('X') && boxes['Mayu ni a Mayu'].has('X'), true);

  const speaker = persons.find((p) => p.id === 'S');
  const strangerTarget = { id: 'stranger2', clanId: 'X', gender: 'F' };
  const res = calculateKinshipTerm(speaker, strangerTarget, persons, relationships, DEFAULT_KINSHIP_BOX_RULES, termRules);
  check('3. single-result tie-break now prefers Mayu over Mayu ni a Mayu', res?.zone, 'Mayu');
}

// ---------- Scenario 4: clan-only lookup (calculateAllKinshipTerms), no isStranger flag anymore ----------
{
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'M', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MB', gender: 'Male', clanId: 'MayuClan' },
    { id: 'W2', gender: 'Female', clanId: 'X' },
    { id: 'FB', gender: 'Male', clanId: 'K' },
    { id: 'W3', gender: 'Female', clanId: 'X' },
  ];
  const relationships = [
    { person1Id: 'F', person2Id: 'S', type: 'parent' },
    { person1Id: 'M', person2Id: 'S', type: 'parent' },
    { person1Id: 'F', person2Id: 'M', type: 'spouse' },
    { person1Id: 'M', person2Id: 'MB', type: 'sibling' },
    { person1Id: 'MB', person2Id: 'W2', type: 'spouse' },
    { person1Id: 'F', person2Id: 'FB', type: 'sibling' },
    { person1Id: 'FB', person2Id: 'W3', type: 'spouse' },
  ];
  const speaker = persons.find((p) => p.id === 'S');
  const strangerTarget = { id: 'stranger', clanId: 'X', gender: 'F' };

  // Clan X is ambiguous by construction (Mayu + Mayu ni a Mayu) regardless of
  // any checkbox -- multiple tabs, letting the user pick.
  const results = calculateAllKinshipTerms(
    speaker, strangerTarget, persons, relationships, DEFAULT_KINSHIP_BOX_RULES, termRules,
    0, 'any', null, null,
  );
  check('4. clan-only lookup returns multiple tabs (tree cascade ambiguity)', results.length, 2);
  check('4. tabs ordered Mayu before Mayu ni a Mayu', results[0]?.term_you_call_them ?? results[0]?.youCallThem, 'MayuTermF');

  // Manual zone override for an UNRELATED clan (no tree cascade match at all)
  // must still surface as its own tab -- proving manual data alone is enough,
  // with no checkbox needed.
  const manualOnlyTarget = { id: 'stranger', clanId: 'Y', gender: 'F' };
  const manualZones = { 'Dama': ['Y'] };
  const manualResults = calculateAllKinshipTerms(
    speaker, manualOnlyTarget, persons, relationships, DEFAULT_KINSHIP_BOX_RULES, termRules,
    0, 'any', manualZones, null,
  );
  check('4. manual-only zone override surfaces with no tree relation at all', manualResults.length, 1);
  check('4. manual-only zone override resolves to Dama', manualResults[0]?.zone, 'Dama');
}

// ---------- Scenario 5: no box match at all -- falls back to the admin default rule ----------
{
  const persons = [{ id: 'S', gender: 'Male', clanId: 'K' }];
  const speaker = persons[0];
  const noRelationTarget = { id: 'stranger', clanId: 'UnrelatedClan', gender: 'F' };
  const defaultRules = [
    { speakerClanId: 'K', targetClanId: 'UnrelatedClan', defaultAlliance: 'Dama', priority: 1 },
  ];

  const withDefault = calculateAllKinshipTerms(
    speaker, noRelationTarget, persons, [], DEFAULT_KINSHIP_BOX_RULES, termRules,
    0, 'any', null, defaultRules,
  );
  check('5. zero box match falls back to admin default rule', withDefault.length, 1);
  check('5. default-rule fallback resolves to the configured zone (Dama)', withDefault[0]?.zone, 'Dama');

  const withoutDefault = calculateAllKinshipTerms(
    speaker, noRelationTarget, persons, [], DEFAULT_KINSHIP_BOX_RULES, termRules,
    0, 'any', null, null,
  );
  check('5. zero box match AND no default rule -> No Terminology Found', withoutDefault.length, 0);
}

// ---------- Regression: previously-working direct cases still work ----------
{
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'W', gender: 'Female', clanId: 'MayuClan' },
  ];
  const relationships = [{ person1Id: 'S', person2Id: 'W', type: 'spouse' }];
  const res = calculateKinshipTerm(
    persons[0], persons[1], persons, relationships, DEFAULT_KINSHIP_BOX_RULES,
    [{ engine_type: 'any', speaker_gender: 'any', alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Madu Jan', term_they_call_you: 'Madu Wa', cultural_notes: '', exception_flag: 'direct_spouse' }],
  );
  check('R1. direct spouse still resolves correctly', res?.youCallThem, 'Madu Jan');
}
{
  // Father's sister's husband -> Dama (case F, untouched by our changes)
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'FSis', gender: 'Female', clanId: 'K' },
    { id: 'FSisH', gender: 'Male', clanId: 'DamaClan' },
  ];
  const relationships = [
    { person1Id: 'F', person2Id: 'S', type: 'parent' },
    { person1Id: 'F', person2Id: 'FSis', type: 'sibling' },
    { person1Id: 'FSis', person2Id: 'FSisH', type: 'spouse' },
  ];
  const res = calculateKinshipTerm(persons[0], persons[3], persons, relationships, DEFAULT_KINSHIP_BOX_RULES, termRules);
  check('R2. father\'s sister\'s husband still -> Dama', res?.zone, 'Dama');
}
{
  // Mother's brother's child (patrilineal from uncle) -> should already resolve
  // via existing Mayu box membership, untouched by our new structural branch
  // (auntUncle male path in our new case should also confirm this, but this
  // exercises the OLD box-cascade path too since Mayu already contained MB's clan).
  const persons = [
    { id: 'S', gender: 'Male', clanId: 'K' },
    { id: 'F', gender: 'Male', clanId: 'K' },
    { id: 'M', gender: 'Female', clanId: 'MayuClan' },
    { id: 'MB', gender: 'Male', clanId: 'MayuClan' },
    { id: 'MBW', gender: 'Female', clanId: 'Z' },
    { id: 'MBChild', gender: 'Male', clanId: 'MayuClan' },
  ];
  const relationships = [
    { person1Id: 'F', person2Id: 'S', type: 'parent' },
    { person1Id: 'M', person2Id: 'S', type: 'parent' },
    { person1Id: 'M', person2Id: 'MB', type: 'sibling' },
    { person1Id: 'MB', person2Id: 'MBW', type: 'spouse' },
    { person1Id: 'MB', person2Id: 'MBChild', type: 'parent' },
    { person1Id: 'MBW', person2Id: 'MBChild', type: 'parent' },
  ];
  const res = calculateKinshipTerm(persons[0], persons[5], persons, relationships, DEFAULT_KINSHIP_BOX_RULES, termRules);
  check('R3. mother\'s brother\'s child -> Mayu', res?.zone, 'Mayu');
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
