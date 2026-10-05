import { describe, it, expect } from 'vitest';
import {
  calculateKinshipTerm, calculateAllKinshipTerms, getKinshipBoxesForPerson, DEFAULT_KINSHIP_BOX_RULES,
  makeLineageKey, parseLineageKey, lineageKeyOf, isSameLineage, zoneHasLineage, markMarriageSeparatedLineages,
  findClanConnectionPath, isFoldBackRule,
} from './KinshipEngine.js';

// A snapshot of the app's REAL kinship_term_rules table (pulled from a live,
// signed-in session's cache on 2026-08-24) -- not hand-picked or invented.
// KinshipEngine.test.js's REAL_TERM_RULES is a deliberately trimmed slice for
// isolated branch tests; this is the full production rule set, used here so
// a single realistic family tree can be checked against the actual terms
// users see, including the two extended zones (Mayu ni a Mayu, Dama ni a
// Dama).
//
// Dama ni a Dama originally shipped as two pure generation-wildcard rows
// (generation 99/-99, "any" target gender). Building this fixture surfaced a
// real engine collision: resolveTermForZone's wildcard tier doesn't
// distinguish a zone's OWN wildcard rule from the unrelated global
// "alliance_zone: any" gen-99 fallback rows -- both match simultaneously and
// get combined with " / ", so a Dama-ni-a-Dama lookup was returning e.g.
// "Dwi / Kashu" instead of the intended single "Kashu". Fixed on the data
// side (matching Mayu ni a Mayu's own existing pattern) by adding explicit
// per-generation rows (2, 1, 0, -1, -2, all repeating the same "Kashu" term)
// so real lookups hit an EXACT generation match and never reach the
// colliding wildcard tier. This still leaves a narrow, unclosed edge case
// beyond generation +/-2 (e.g. a husband's grandmother) where the same
// collision could reappear -- rare enough to accept for now; the full fix
// would be an engine change to prioritize a zone's own wildcard over the
// generic one.
const PRODUCTION_TERM_RULES_SNAPSHOT = [
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kawa', term_they_call_you: 'Kasha', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'older', target_gender: 'M', term_you_call_them: 'Kahpu', term_they_call_you: 'Kanau', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'younger', target_gender: 'M', term_you_call_them: 'Kanau', term_they_call_you: 'Kahpu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: -1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kasha', term_they_call_you: 'Kawa', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: -2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kamoi', term_they_call_you: 'Kanam', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'older', target_gender: 'F', term_you_call_them: 'Kana', term_they_call_you: 'Kanau', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'younger', target_gender: 'F', term_you_call_them: 'Kanau', term_they_call_you: 'Kahpu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kasha', term_they_call_you: 'Kawa', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Kahpu Kanau', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Katsa', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 0, relative_age: 'older', target_gender: 'M', term_you_call_them: 'Kahkau', term_they_call_you: 'Kahkau', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 0, relative_age: 'younger', target_gender: 'M', term_you_call_them: 'Kahkau', term_they_call_you: 'Kahkau', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: -1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kanam', term_they_call_you: 'Kagu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: -2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kanu', term_they_call_you: 'Kasha', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 0, relative_age: 'older', target_gender: 'F', term_you_call_them: 'Karat', term_they_call_you: 'Karat', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: 0, relative_age: 'younger', target_gender: 'F', term_you_call_them: 'Kanam', term_they_call_you: 'Kagu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kanam', term_they_call_you: 'Kagu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kagu', term_they_call_you: 'Kanam', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 0, relative_age: 'older', target_gender: 'M', term_you_call_them: 'Kahkau', term_they_call_you: 'Kahkau', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 0, relative_age: 'younger', target_gender: 'M', term_you_call_them: 'Kahkau', term_they_call_you: 'Kahkau', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: -1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kahkri', term_they_call_you: 'Katsa', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: -2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kahkri', term_they_call_you: 'Katsa', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 0, relative_age: 'older', target_gender: 'F', term_you_call_them: 'Karat', term_they_call_you: 'Karat', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: 0, relative_age: 'younger', target_gender: 'F', term_you_call_them: 'Kahkri', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kahkri', term_they_call_you: 'Katsa', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kawa', term_they_call_you: 'Kasha', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'older', target_gender: 'M', term_you_call_them: 'Kana', term_they_call_you: 'Kanau', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'younger', target_gender: 'M', term_you_call_them: 'Kanau', term_they_call_you: 'Kana', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: -1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kanam', term_they_call_you: 'Kamoi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: -2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kamoi', term_they_call_you: 'Kanam', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'older', target_gender: 'F', term_you_call_them: 'Kana', term_they_call_you: 'Kanau', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: 0, relative_age: 'younger', target_gender: 'F', term_you_call_them: 'Kanau', term_they_call_you: 'Kana', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kanam', term_they_call_you: 'Kamoi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Kahpu Kanau', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Katsa', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 0, relative_age: 'older', target_gender: 'M', term_you_call_them: 'Karat', term_they_call_you: 'Karat', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 0, relative_age: 'younger', target_gender: 'M', term_you_call_them: 'Kagu', term_they_call_you: 'Kanam', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: -1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kanam', term_they_call_you: 'Kagu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: -2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kanu', term_they_call_you: 'Kasha', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 0, relative_age: 'older', target_gender: 'F', term_you_call_them: 'Kaning', term_they_call_you: 'Kaning', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: 0, relative_age: 'younger', target_gender: 'F', term_you_call_them: 'Kaning', term_they_call_you: 'Kaning', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kaning', term_they_call_you: 'Kaning', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kagu', term_they_call_you: 'Kanam', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 0, relative_age: 'older', target_gender: 'M', term_you_call_them: 'Kagu', term_they_call_you: 'Kanam', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 0, relative_age: 'younger', target_gender: 'M', term_you_call_them: 'Karat', term_they_call_you: 'Karat', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: -1, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kasha', term_they_call_you: 'Kanu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: -2, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kaning', term_they_call_you: 'Kaning', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 0, relative_age: 'older', target_gender: 'F', term_you_call_them: 'Kaning', term_they_call_you: 'Kaning', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: 0, relative_age: 'younger', target_gender: 'F', term_you_call_them: 'Kaning', term_they_call_you: 'Kaning', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kasha', term_they_call_you: 'Kanu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'independent', speaker_gender: 'any', alliance_zone: 'any', generation: 99, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'independent', speaker_gender: 'any', alliance_zone: 'any', generation: 99, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'independent', speaker_gender: 'any', alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Madu Jan', term_they_call_you: 'Madu Wa', exception_flag: 'direct_spouse' },
  { engine_type: 'independent', speaker_gender: 'any', alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Madu Wa', term_they_call_you: 'Madu Jan', exception_flag: 'direct_spouse' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Madu Jan', term_they_call_you: 'Madu Wa', exception_flag: 'direct_spouse' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'any', generation: 0, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Madu Wa', term_they_call_you: 'Madu Jan', exception_flag: 'direct_spouse' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu ni a Mayu', generation: 99, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu ni a Mayu', generation: 99, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu ni a Mayu', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu ni a Mayu', generation: 0, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu ni a Mayu', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Mayu ni a Mayu', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu ni a Mayu', generation: 99, relative_age: 'any', target_gender: 'M', term_you_call_them: 'Ji', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu ni a Mayu', generation: 99, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Dwi', term_they_call_you: 'Kashu', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu ni a Mayu', generation: 1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu ni a Mayu', generation: 0, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu ni a Mayu', generation: -1, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Mayu ni a Mayu', generation: -2, relative_age: 'any', target_gender: 'F', term_you_call_them: 'Kani', term_they_call_you: 'Kahkri', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama ni a Dama', generation: 2, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama ni a Dama', generation: 1, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama ni a Dama', generation: 0, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama ni a Dama', generation: -1, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'male', speaker_gender: 'M', alliance_zone: 'Dama ni a Dama', generation: -2, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Ji', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama ni a Dama', generation: 2, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama ni a Dama', generation: 1, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama ni a Dama', generation: 0, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama ni a Dama', generation: -1, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
  { engine_type: 'female', speaker_gender: 'F', alliance_zone: 'Dama ni a Dama', generation: -2, relative_age: 'any', target_gender: 'any', term_you_call_them: 'Kashu', term_they_call_you: 'Dwi', exception_flag: 'none' },
];

const mk = (gender) => (id, clanId, extra = {}) => ({ id, gender, clanId, ...extra });
const male = mk('Male');
const female = mk('Female');
const parent = (parentId, childId) => ({ type: 'parent', person1Id: parentId, person2Id: childId });
const spouse = (aId, bId) => ({ type: 'spouse', person1Id: aId, person2Id: bId });
const sibling = (aId, bId) => ({ type: 'sibling', person1Id: aId, person2Id: bId });

// One deliberately-constructed, internally-consistent family, three
// generations deep, spanning six clans -- built to exercise every alliance
// zone (including the two extended "ni a" zones) through real tree
// structure rather than isolated one-off fixtures. See the per-`it` comments
// below for which relationship and branch each person is standing in for.
//
//        GF(K) === GM(MayuClan)
//         |                    \
//   Dad(K) === Mom(MayuClan)     DadSister(K) === DamaMan(DamaClan)
//    |    \        \                     +-- DadSisterChild(DamaClan) -- DadSisterGrandchild(DamaClan)
//    |   MomBrother(MayuClan) === MomBroWife(InLawClan)
//    |     +-- MomBrotherChild(MayuClan) -- MomBrotherGrandchild(MayuClan)
//    |
//    +-- RootOlderBro(K)
//    +-- Root(K) === RootWife(WifeClan) [WifeFather(WifeClan) x WifeMother(InLawClan)]
//    |     +-- RootSon(K) -- Grandkid(K)
//    |     +-- RootDaughter(K)
//    +-- RootYoungerSis(K)
//    +-- RootSisterMarried(K) === SisHusband(HusbandClan) [-- HusbandMother(HusbandInLawClan)]
const GF = male('GF', 'K');
const GM = female('GM', 'MayuClan');
const Dad = male('Dad', 'K');
const DadSister = female('DadSister', 'K');
const DamaMan = male('DamaMan', 'DamaClan');
const DadSisterChild = female('DadSisterChild', 'DamaClan');
const DadSisterGrandchild = male('DadSisterGrandchild', 'DamaClan');
const Mom = female('Mom', 'MayuClan');
const MomBrother = male('MomBrother', 'MayuClan');
const MomBroWife = female('MomBroWife', 'InLawClan');
const MomBrotherChild = male('MomBrotherChild', 'MayuClan');
const MomBrotherGrandchild = female('MomBrotherGrandchild', 'MayuClan');
const Root = male('Root', 'K', { dob: '1990-01-01' });
const RootOlderBro = male('RootOlderBro', 'K', { dob: '1985-01-01' });
const RootYoungerSis = female('RootYoungerSis', 'K', { dob: '1995-01-01' });
const RootSisterMarried = female('RootSisterMarried', 'K', { dob: '1980-01-01' });
const SisHusband = male('SisHusband', 'HusbandClan');
const HusbandMother = female('HusbandMother', 'HusbandInLawClan');
const RootWife = female('RootWife', 'WifeClan');
const WifeFather = male('WifeFather', 'WifeClan');
const WifeMother = female('WifeMother', 'InLawClan');
const RootSon = male('RootSon', 'K');
const RootDaughter = female('RootDaughter', 'K');
const Grandkid = male('Grandkid', 'K');

const persons = [
  GF, GM, Dad, DadSister, DamaMan, DadSisterChild, DadSisterGrandchild,
  Mom, MomBrother, MomBroWife, MomBrotherChild, MomBrotherGrandchild,
  Root, RootOlderBro, RootYoungerSis, RootSisterMarried, SisHusband, HusbandMother,
  RootWife, WifeFather, WifeMother, RootSon, RootDaughter, Grandkid,
];

const relationships = [
  parent('GF', 'Dad'), parent('GM', 'Dad'), spouse('GF', 'GM'),
  parent('GF', 'DadSister'), parent('GM', 'DadSister'), spouse('DadSister', 'DamaMan'),
  parent('DadSister', 'DadSisterChild'), parent('DamaMan', 'DadSisterChild'),
  parent('DadSisterChild', 'DadSisterGrandchild'),
  sibling('Mom', 'MomBrother'), spouse('MomBrother', 'MomBroWife'),
  parent('MomBrother', 'MomBrotherChild'), parent('MomBrotherChild', 'MomBrotherGrandchild'),
  spouse('Dad', 'Mom'),
  parent('Dad', 'Root'), parent('Mom', 'Root'),
  parent('Dad', 'RootOlderBro'), parent('Mom', 'RootOlderBro'),
  parent('Dad', 'RootYoungerSis'), parent('Mom', 'RootYoungerSis'),
  parent('Dad', 'RootSisterMarried'), parent('Mom', 'RootSisterMarried'),
  spouse('RootSisterMarried', 'SisHusband'), parent('HusbandMother', 'SisHusband'),
  spouse('Root', 'RootWife'),
  parent('WifeFather', 'RootWife'), parent('WifeMother', 'RootWife'), spouse('WifeFather', 'WifeMother'),
  parent('Root', 'RootSon'), parent('RootWife', 'RootSon'),
  parent('Root', 'RootDaughter'), parent('RootWife', 'RootDaughter'),
  parent('RootSon', 'Grandkid'),
];

const term = (speaker, target) => calculateKinshipTerm(
  speaker, target, persons, relationships, DEFAULT_KINSHIP_BOX_RULES, PRODUCTION_TERM_RULES_SNAPSHOT,
)?.youCallThem;

describe('Mock family tree: Kahpu Kanau (own patriline)', () => {
  it('grandfather -> Ji, grandmother -> Dwi (zone-invariant gen+2)', () => {
    expect(term(Root, GF)).toBe('Ji');
    expect(term(Root, GM)).toBe('Dwi');
  });

  it('father -> Kawa (direct parent)', () => {
    expect(term(Root, Dad)).toBe('Kawa');
  });

  it("father's sister -> Kamoi (parent's sibling, father's side)", () => {
    expect(term(Root, DadSister)).toBe('Kamoi');
  });

  it('older brother -> Kahpu, younger sister -> Kanau, older sister -> Kana (sibling seniority by DOB)', () => {
    expect(term(Root, RootOlderBro)).toBe('Kahpu');
    expect(term(Root, RootYoungerSis)).toBe('Kanau');
    expect(term(Root, RootSisterMarried)).toBe('Kana');
  });

  it('son and daughter -> Kasha (direct children, both genders)', () => {
    expect(term(Root, RootSon)).toBe('Kasha');
    expect(term(Root, RootDaughter)).toBe('Kasha');
  });

  it('grandchild -> Kashu (zone-invariant gen-2)', () => {
    expect(term(Root, Grandkid)).toBe('Kashu');
  });
});

describe('Mock family tree: Mayu (wife-giving side)', () => {
  it("mother -> Kanu (direct parent, female)", () => {
    expect(term(Root, Mom)).toBe('Kanu');
  });

  it("mother's brother -> Katsa (parent's sibling, mother's side)", () => {
    expect(term(Root, MomBrother)).toBe('Katsa');
  });

  it("wife's father -> Katsa (heads the wife's own clan, same zone as the wife)", () => {
    expect(term(Root, WifeFather)).toBe('Katsa');
  });

  it("mother's brother's grandchild -> Kanam (gen -1 in the zone, reached via the clan-cascade fallback since no named branch covers a collateral relative's own descendant)", () => {
    expect(term(Root, MomBrotherGrandchild)).toBe('Kanam');
  });
});

describe('Mock family tree: Dama (wife-taking side)', () => {
  it("father's sister's husband -> Kagu (spouse of a parent's sibling, father's side)", () => {
    expect(term(Root, DamaMan)).toBe('Kagu');
  });

  it("sister's husband -> Kahkau (spouse of a direct sibling)", () => {
    expect(term(Root, SisHusband)).toBe('Kahkau');
  });

  it("father's sister's grandchild -> Kahkri (gen -1 in the zone, same clan-cascade fallback as the Mayu case above)", () => {
    expect(term(Root, DadSisterGrandchild)).toBe('Kahkri');
  });
});

describe('Mock family tree: Mayu ni a Mayu (extended -- wife-giver of a wife-giver)', () => {
  it("mother's brother's wife -> Kani (married into the mother's own natal line)", () => {
    expect(term(Root, MomBroWife)).toBe('Kani');
  });

  it("wife's mother -> Kani (married into the wife's father's clan, not heading it herself)", () => {
    expect(term(Root, WifeMother)).toBe('Kani');
  });

  it('both routes into the zone agree via the clan-cascade box too', () => {
    const boxes = getKinshipBoxesForPerson(Root.id, persons, relationships, DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes['Mayu'].has(makeLineageKey('MayuClan'))).toBe(true);
    expect(boxes['Mayu ni a Mayu'].has(makeLineageKey('InLawClan'))).toBe(true);
  });
});

describe('Mock family tree: Dama ni a Dama (extended -- wife-taker of a wife-taker)', () => {
  // Only reachable from a FEMALE speaker (a male speaker's own extended
  // wife-taking zone is Mayu ni a Mayu's mirror, not this one) -- so this
  // block speaks from RootSisterMarried's own perspective, not Root's.
  it("husband's mother -> Kashu, and she calls the speaker Dwi (same term at every generation, by design)", () => {
    const res = calculateKinshipTerm(
      RootSisterMarried, HusbandMother, persons, relationships,
      DEFAULT_KINSHIP_BOX_RULES, PRODUCTION_TERM_RULES_SNAPSHOT,
    );
    expect(res?.youCallThem).toBe('Kashu');
    expect(res?.theyCallYou).toBe('Dwi');
  });
});

describe('Mock family tree: direct spouse (bypasses zone entirely)', () => {
  it('resolves symmetrically from both directions', () => {
    expect(term(Root, RootWife)).toBe('Madu Jan');
    expect(term(RootWife, Root)).toBe('Madu Wa');
  });
});

// ---------------------------------------------------------------------------
// "Whatever clan marries into the family is Mayu, whether or not it has the
// same clan name." (Project owner, 2026-10-05.) Same-clan marriages are rare,
// but when one is recorded the wife's birth family is still Mayu to the
// husband's family, and his is Dama to hers -- for every marriage in the
// tree, not only the root's parents.
//
// Everyone below is clan "Marip". Unless a test says otherwise, nobody has a
// branch or family name recorded, so recorded lineage alone cannot tell the
// families apart.
//
//   MomFather(Marip)
//     +-- Mom === Dad(Marip)
//     |          +-- Bro
//     |          +-- Root
//     |          +-- Sis === SisHusband(Marip) [HusbandFather(Marip)]
//     +-- MomBrother === MomBroWife(Marip) [MomBroWifeFather(Marip)]
//           +-- MomBroSon -- MomBroGrandchild
// ---------------------------------------------------------------------------
describe('Same-clan marriages: the marriage itself creates the Mayu / Dama tie', () => {
  const build = ({ dadSide = {}, momSide = {} } = {}) => {
    const people = [
      male('sDad', 'Marip', dadSide),
      male('sRoot', 'Marip', { dob: '1990-01-01', ...dadSide }),
      male('sBro', 'Marip', { dob: '1985-01-01', ...dadSide }),
      female('sSis', 'Marip', { dob: '1995-01-01', ...dadSide }),
      male('sMomFather', 'Marip', momSide),
      female('sMom', 'Marip', momSide),
      male('sMomBrother', 'Marip', momSide),
      male('sMomBroSon', 'Marip', momSide),
      male('sMomBroGrandchild', 'Marip', momSide),
      male('sMomBroWifeFather', 'Marip'),
      female('sMomBroWife', 'Marip'),
      male('sHusbandFather', 'Marip'),
      male('sSisHusband', 'Marip'),
      male('sStranger', 'Marip'), // in the tree, linked to nobody
    ];
    const links = [
      spouse('sDad', 'sMom'),
      parent('sDad', 'sRoot'), parent('sMom', 'sRoot'),
      parent('sDad', 'sBro'), parent('sMom', 'sBro'),
      parent('sDad', 'sSis'), parent('sMom', 'sSis'),
      parent('sMomFather', 'sMom'), parent('sMomFather', 'sMomBrother'),
      spouse('sMomBrother', 'sMomBroWife'),
      parent('sMomBroWifeFather', 'sMomBroWife'),
      parent('sMomBrother', 'sMomBroSon'), parent('sMomBroWife', 'sMomBroSon'),
      parent('sMomBroSon', 'sMomBroGrandchild'),
      spouse('sSis', 'sSisHusband'),
      parent('sHusbandFather', 'sSisHusband'),
    ];
    const marked = markMarriageSeparatedLineages(people, links);
    const who = (id) => marked.find((p) => p.id === id);
    const boxes = getKinshipBoxesForPerson('sRoot', marked, links, DEFAULT_KINSHIP_BOX_RULES, null);
    const zonesOf = (id) => Object.keys(boxes).filter((zone) => zoneHasLineage(boxes[zone], who(id)));
    const termFor = (id) => calculateKinshipTerm(
      who('sRoot'), who(id), marked, links, DEFAULT_KINSHIP_BOX_RULES, PRODUCTION_TERM_RULES_SNAPSHOT,
    );
    return { people, links, marked, who, boxes, zonesOf, termFor };
  };

  it("without the marking step the mother's family is lost from Mayu (the old behaviour)", () => {
    const { people, links } = build();
    const boxes = getKinshipBoxesForPerson('sRoot', people, links, DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes.Mayu.size).toBe(0);
    expect(boxes.Dama.size).toBe(0);
  });

  it("puts the mother's birth family in Mayu and keeps the root's own family out of it", () => {
    const { zonesOf } = build();
    expect(zonesOf('sMom')).toEqual(['Mayu']);
    expect(zonesOf('sMomFather')).toEqual(['Mayu']);
    expect(zonesOf('sMomBrother')).toEqual(['Mayu']);
    expect(zonesOf('sRoot')).toEqual(['Kahpu Kanau']);
    expect(zonesOf('sDad')).toEqual(['Kahpu Kanau']);
    expect(zonesOf('sBro')).toEqual(['Kahpu Kanau']);
  });

  it("holds for every marriage: a sister's husband's family is Dama", () => {
    const { zonesOf } = build();
    expect(zonesOf('sSisHusband')).toEqual(['Dama']);
    expect(zonesOf('sHusbandFather')).toEqual(['Dama']);
  });

  it("holds further out: the mother's brother's wife's family is Mayu ni a Mayu", () => {
    const { zonesOf } = build();
    expect(zonesOf('sMomBroWife')).toEqual(['Mayu ni a Mayu']);
    expect(zonesOf('sMomBroWifeFather')).toEqual(['Mayu ni a Mayu']);
  });

  it('gives the same kinship terms as when the clans have different names', () => {
    const { termFor } = build();
    expect(termFor('sMom')?.youCallThem).toBe('Kanu');
    expect(termFor('sMomBrother')?.youCallThem).toBe('Katsa');
    expect(termFor('sSisHusband')?.youCallThem).toBe('Kahkau');
    expect(termFor('sMomBroWife')?.youCallThem).toBe('Kani');
    expect(termFor('sBro')?.youCallThem).toBe('Kahpu');
    // Reached through the clan-level zones, not a direct relationship -- the
    // part that depended on the boxes being right.
    expect(termFor('sMomBroGrandchild')?.zone).toBe('Mayu');
    expect(termFor('sMomBroGrandchild')?.youCallThem).toBe('Kanam');
  });

  it('works when a branch is recorded for only one of the two families', () => {
    const { zonesOf } = build({ momSide: { subClanId: 'labya' } });
    expect(zonesOf('sMom')).toEqual(['Mayu']);
    expect(zonesOf('sRoot')).toEqual(['Kahpu Kanau']);
  });

  it('works when the two families have the very same clan, branch and family name', () => {
    const same = { subClanId: 'labya', familyNameId: 'gam' };
    const { zonesOf } = build({ dadSide: same, momSide: same });
    expect(zonesOf('sMom')).toEqual(['Mayu']);
    expect(zonesOf('sRoot')).toEqual(['Kahpu Kanau']);
  });

  it('leaves an unconnected person of that clan as own clan by default, but possible in each zone', () => {
    const { zonesOf, termFor } = build();
    // Nothing links the stranger to either family, so the engine can't rule
    // any of them out...
    expect(zonesOf('sStranger')).toEqual(['Kahpu Kanau', 'Mayu', 'Dama', 'Mayu ni a Mayu']);
    // ...and, as before, treats them as the root's own clan.
    expect(termFor('sStranger')?.zone).toBe('Kahpu Kanau');
  });

  it('a clan-only lookup of that clan offers every zone a family of it is in', () => {
    const { marked, links, who } = build();
    const results = calculateAllKinshipTerms(
      who('sRoot'), { id: 'stranger', clanId: 'Marip', gender: 'Male' }, marked, links,
      DEFAULT_KINSHIP_BOX_RULES, PRODUCTION_TERM_RULES_SNAPSHOT, 0, 'older',
    );
    expect(results.map((r) => r.zone)).toEqual(['Kahpu Kanau', 'Mayu', 'Dama', 'Mayu ni a Mayu']);
  });

  it('marks only the families such a marriage joins', () => {
    const { marked, who } = build();
    expect(who('sRoot').lineageGroup).toBe(who('sDad').lineageGroup);
    expect(who('sRoot').lineageGroup).toBe(who('sSis').lineageGroup);
    expect(who('sMom').lineageGroup).toBe(who('sMomBroGrandchild').lineageGroup);
    expect(who('sMom').lineageGroup).not.toBe(who('sRoot').lineageGroup);
    expect(who('sStranger').lineageGroup).toBeUndefined();
    expect(marked.filter((p) => p.lineageGroup).length).toBe(13);
  });

  it('does not depend on the order relationships are stored in', () => {
    const { people, links, marked } = build();
    const reversed = markMarriageSeparatedLineages(people, [...links].reverse());
    expect(reversed.map((p) => p.lineageGroup)).toEqual(marked.map((p) => p.lineageGroup));
  });
});

describe('markMarriageSeparatedLineages: trees it must leave alone', () => {
  it('returns the very same array when no marriage needs it', () => {
    // The main mock family: every marriage is between different clans.
    expect(markMarriageSeparatedLineages(persons, relationships)).toBe(persons);
  });

  it('leaves a same-clan marriage alone when recorded branches already tell the families apart', () => {
    const people = [
      male('bDad', 'Marip', { subClanId: 'hpung' }), female('bMom', 'Marip', { subClanId: 'labya' }),
      male('bRoot', 'Marip', { subClanId: 'hpung' }),
    ];
    const links = [spouse('bDad', 'bMom'), parent('bDad', 'bRoot'), parent('bMom', 'bRoot')];
    expect(markMarriageSeparatedLineages(people, links)).toBe(people);
    const boxes = getKinshipBoxesForPerson('bRoot', people, links, DEFAULT_KINSHIP_BOX_RULES, null);
    expect(boxes.Mayu.has(makeLineageKey('Marip', 'labya'))).toBe(true);
  });

  it('does not separate a husband and wife recorded in the same patriline', () => {
    // Children of two brothers: the tree itself says they are one lineage.
    const people = [
      male('cGrandfather', 'Marip'), male('cUncleA', 'Marip'), male('cUncleB', 'Marip'),
      male('cHusband', 'Marip'), female('cWife', 'Marip'),
    ];
    const links = [
      parent('cGrandfather', 'cUncleA'), parent('cGrandfather', 'cUncleB'),
      parent('cUncleA', 'cHusband'), parent('cUncleB', 'cWife'),
      spouse('cHusband', 'cWife'),
    ];
    expect(markMarriageSeparatedLineages(people, links)).toBe(people);
  });

  it("does not put a child in the mother's line", () => {
    const people = [male('dDad', 'Marip'), female('dMom', 'Marip'), male('dChild', 'Marip')];
    const links = [spouse('dDad', 'dMom'), parent('dDad', 'dChild'), parent('dMom', 'dChild')];
    const marked = markMarriageSeparatedLineages(people, links);
    const group = (id) => marked.find((p) => p.id === id).lineageGroup;
    expect(group('dChild')).toBe(group('dDad'));
    expect(group('dChild')).not.toBe(group('dMom'));
  });
});

describe('Lineage keys with a lineage group', () => {
  it('keep the three-part form when there is no group', () => {
    expect(makeLineageKey('Marip', 'labya', 'gam')).toBe('Marip::labya::gam');
    expect(parseLineageKey('Marip::labya::gam')).toEqual({ clanId: 'Marip', subClanId: 'labya', familyNameId: 'gam' });
    expect(lineageKeyOf({ clanId: 'Marip' })).toBe('Marip::::');
  });

  it('round-trip the group as a fourth part', () => {
    const key = lineageKeyOf({ clanId: 'Marip', lineageGroup: 'm:p1' });
    expect(key).toBe('Marip::::::m:p1');
    expect(parseLineageKey(key)).toEqual({ clanId: 'Marip', subClanId: null, familyNameId: null, lineageGroup: 'm:p1' });
  });

  it('two different groups are different lineages; a missing group proves nothing', () => {
    const a = { clanId: 'Marip', lineageGroup: 'm:p1' };
    const b = { clanId: 'Marip', lineageGroup: 'm:p2' };
    expect(isSameLineage(a, b)).toBe(false);
    expect(isSameLineage(a, { clanId: 'Marip' })).toBe(true);
    expect(isSameLineage(a, { clanId: 'Marip', lineageGroup: 'm:p1' })).toBe(true);
  });
});

describe('findClanConnectionPath: tracing to one family among several of the same clan', () => {
  // Root's father and mother are both "Marip"; the mother's brother is the
  // nearest person of the MOTHER's family other than her.
  const people = markMarriageSeparatedLineages(
    [
      male('tDad', 'Marip'), female('tMom', 'Marip'), male('tRoot', 'Marip'),
      male('tMomFather', 'Marip'), male('tMomBrother', 'Marip'),
    ],
    [
      spouse('tDad', 'tMom'), parent('tDad', 'tRoot'), parent('tMom', 'tRoot'),
      parent('tMomFather', 'tMom'), parent('tMomFather', 'tMomBrother'),
    ],
  );
  const links = [
    spouse('tDad', 'tMom'), parent('tDad', 'tRoot'), parent('tMom', 'tRoot'),
    parent('tMomFather', 'tMom'), parent('tMomFather', 'tMomBrother'),
  ];
  const groupOf = (id) => people.find((p) => p.id === id).lineageGroup;
  const endOf = (path) => path?.[path.length - 1]?.person?.id;

  it('without a family, stops at the first person of the clan (unchanged)', () => {
    expect(['tDad', 'tMom']).toContain(endOf(findClanConnectionPath('tRoot', 'Marip', links, people, 6)));
  });

  it("with the mother's family, leads to her side, not the father's", () => {
    const path = findClanConnectionPath('tRoot', 'Marip', links, people, 6, null, null, groupOf('tMom'));
    expect(endOf(path)).toBe('tMom');
  });

  it("with the root's own family, leads to the father's side", () => {
    const path = findClanConnectionPath('tRoot', 'Marip', links, people, 6, null, null, groupOf('tRoot'));
    expect(endOf(path)).toBe('tDad');
  });
});

// ---------------------------------------------------------------------------
// Fold-back rules loaded from the database.
//
// Reported from production: a mother's father's sister's husband had no
// kinship term. His family is a "Dama of your Mayu" (it took a wife from one
// of the speaker's wife-giving families), which folds back to Kahpu Kanau.
// The apps load alliance rules from the kinship_rules table, which has no
// `foldBack` column, so the rule arrived without its flag and the engine
// refused to apply it.
//
//   MothersFather(Tangbau) --sibling-- MFsSister(Tangbau) === Laika(Maran)
//     +-- Mother(Tangbau) === Father(Zahkung)
//                               +-- Wez(Zahkung)
// ---------------------------------------------------------------------------
describe('Fold-back rules without a foldBack flag (as the database supplies them)', () => {
  const rulesFromDatabase = DEFAULT_KINSHIP_BOX_RULES.map((rule) => {
    const { foldBack: _flag, ...row } = rule;
    return row;
  });
  const people = [
    male('fWez', 'Zahkung'), male('fFather', 'Zahkung'), female('fMother', 'Tangbau'),
    male('fMothersFather', 'Tangbau'), female('fMothersMother', 'Marip'),
    female('fMFsSister', 'Tangbau'), male('fLaika', 'Maran'),
    // A Dama man's wife: her family is a "Mayu of your Dama".
    female('fSister', 'Zahkung'), male('fSistersHusband', 'Lahtaw'),
    male('fHusbandsBrother', 'Lahtaw'), female('fBrothersWife', 'Nhkum'),
    male('fBrothersWifesFather', 'Nhkum'),
  ];
  const links = [
    spouse('fFather', 'fMother'), parent('fFather', 'fWez'), parent('fMother', 'fWez'),
    spouse('fMothersFather', 'fMothersMother'),
    parent('fMothersFather', 'fMother'), parent('fMothersMother', 'fMother'),
    sibling('fMothersFather', 'fMFsSister'), spouse('fLaika', 'fMFsSister'),
    parent('fFather', 'fSister'), spouse('fSister', 'fSistersHusband'),
    sibling('fSistersHusband', 'fHusbandsBrother'), spouse('fHusbandsBrother', 'fBrothersWife'),
    parent('fBrothersWifesFather', 'fBrothersWife'),
  ];
  const who = (id) => people.find((p) => p.id === id);
  const termFor = (id, rules = rulesFromDatabase) => calculateKinshipTerm(
    who('fWez'), who(id), people, links, rules, PRODUCTION_TERM_RULES_SNAPSHOT,
  );

  it("gives a mother's father's sister's husband a term: Ji, through Kahpu Kanau", () => {
    const res = termFor('fLaika');
    expect(res?.zone).toBe('Kahpu Kanau');
    expect(res?.youCallThem).toBe('Ji');
  });

  it('gives the same answers as the flagged built-in rules', () => {
    ['fLaika', 'fMFsSister', 'fMothersFather', 'fBrothersWife', 'fBrothersWifesFather'].forEach((id) => {
      expect(termFor(id)?.youCallThem).toBe(termFor(id, DEFAULT_KINSHIP_BOX_RULES)?.youCallThem);
      expect(termFor(id)?.zone).toBe(termFor(id, DEFAULT_KINSHIP_BOX_RULES)?.zone);
    });
  });

  it('puts both kinds of fold-back family in the Kahpu Kanau box', () => {
    const boxes = getKinshipBoxesForPerson('fWez', people, links, rulesFromDatabase, null);
    expect(zoneHasLineage(boxes['Kahpu Kanau'], who('fLaika'))).toBe(true); // Dama of your Mayu
    expect(zoneHasLineage(boxes['Kahpu Kanau'], who('fBrothersWifesFather'))).toBe(true); // Mayu of your Dama
  });

  it('still refuses any other rule that would put a different family into Kahpu Kanau', () => {
    // Not a fold-back: a Mayu MAN's wife belongs in Mayu ni a Mayu.
    const rogue = [
      ...rulesFromDatabase.filter((rule) => !isFoldBackRule(rule)),
      { sourceBox: 'Mayu', targetBox: 'Kahpu Kanau', sourceGender: 'Male', targetGender: 'Female' },
    ];
    const boxes = getKinshipBoxesForPerson('fWez', people, links, rogue, null);
    expect([...boxes['Kahpu Kanau']]).toEqual([lineageKeyOf(who('fWez'))]);
  });
});

describe('isFoldBackRule', () => {
  it('recognises the two fold-back rules by their shape, however gender is written', () => {
    expect(isFoldBackRule({ sourceBox: 'Mayu', targetBox: 'Kahpu Kanau', sourceGender: 'Female', targetGender: 'Male' })).toBe(true);
    expect(isFoldBackRule({ sourceBox: 'Dama', targetBox: 'Kahpu Kanau', sourceGender: 'M', targetGender: 'f' })).toBe(true);
  });

  it('honours an explicit flag', () => {
    expect(isFoldBackRule({ sourceBox: 'Mayu', targetBox: 'Kahpu Kanau', sourceGender: 'Any', targetGender: 'Any', foldBack: true })).toBe(true);
  });

  it('is false for everything else', () => {
    expect(isFoldBackRule({ sourceBox: 'Kahpu Kanau', targetBox: 'Mayu', sourceGender: 'Male', targetGender: 'Female' })).toBe(false);
    expect(isFoldBackRule({ sourceBox: 'Mayu', targetBox: 'Kahpu Kanau', sourceGender: 'Male', targetGender: 'Female' })).toBe(false);
    expect(isFoldBackRule({ sourceBox: 'Mayu', targetBox: 'Mayu ni a Mayu', sourceGender: 'Female', targetGender: 'Male', foldBack: true })).toBe(false);
    expect(isFoldBackRule(null)).toBe(false);
  });
});
