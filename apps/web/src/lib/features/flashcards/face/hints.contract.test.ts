import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../../docs/contracts/cards/hints.json';
import {
	HINT_KINDS,
	HINT_MODES,
	STORED_HINT_KINDS,
	applyHints,
	defaultHintMode,
	hintApplies,
	hintsForEntry,
	lowerForHints,
	readHintSettings,
	resolveHints,
	type HintKind,
	type HintMode,
	type HintSettings
} from './hints';
import { CARD_KINDS, type ReviewGrade, type StudyCardKind } from '$lib/studycore/types';
import { readRomanisation } from '$lib/languages/romanisation';

type Expected = 'defaults' | Partial<Record<HintKind, 'defaults' | Record<string, string>>>;

function expandSettings(expect_: Expected): HintSettings {
	const defaults = fixture.defaults as Record<HintKind, Record<StudyCardKind, HintMode>>;
	if (expect_ === 'defaults') return defaults;
	const out: Record<string, unknown> = {};
	for (const kind of HINT_KINDS) {
		const cell = expect_[kind];
		out[kind] = cell === undefined || cell === 'defaults' ? defaults[kind] : cell;
	}
	return out as HintSettings;
}

describe('hints contract: kinds, modes and defaults', () => {
	it('lists the kinds in their fixed order and the three modes', () => {
		expect([...HINT_KINDS]).toEqual(fixture.kinds);
		expect([...HINT_MODES]).toEqual(fixture.modes);
		expect([...STORED_HINT_KINDS]).toEqual(fixture.storedKinds);
	});

	it('has the pinned defaults for every kind and card kind', () => {
		for (const kind of HINT_KINDS) {
			for (const card of CARD_KINDS) {
				const expected = (fixture.defaults as Record<string, Record<string, string>>)[kind][card];
				expect(defaultHintMode(kind, card), `${kind} on ${card}`).toBe(expected);
			}
		}
	});

	it('knows which pairs do not apply', () => {
		const skipped = new Set(fixture.notApplicable.map((p) => `${p.kind}:${p.cardKind}`));
		for (const kind of HINT_KINDS) {
			for (const card of CARD_KINDS) {
				expect(hintApplies(kind, card), `${kind} on ${card}`).toBe(!skipped.has(`${kind}:${card}`));
			}
		}
	});
});

describe('hints contract: readHintSettings', () => {
	for (const c of fixture.settings) {
		it(c.name, () => {
			expect(readHintSettings(c.settings as Record<string, unknown> | null)).toEqual(
				expandSettings(c.expect as Expected)
			);
		});
	}
});

describe('hints contract: resolveHints', () => {
	for (const c of fixture.plans) {
		it(c.name, () => {
			const plan = resolveHints({
				cardKind: c.cardKind as StudyCardKind,
				settings: readHintSettings(c.settings as Record<string, unknown>),
				entry: c.entry,
				forced: (c as { forced?: Partial<Record<HintKind, HintMode>> }).forced
			});
			expect(plan).toEqual({ always: c.always, onRequest: c.onRequest });
		});
	}
});

describe('hints contract: hintsForEntry with hidden romanisation (#284)', () => {
	for (const c of fixture.entries) {
		it(c.name, () => {
			const entry = { readings: c.readings.map((type) => ({ type, value: 'x' })) };
			const got = hintsForEntry(entry, { romanisation: readRomanisation(c.settings as Record<string, unknown>) });
			expect({ hasReading: got.hasReading, hasRomanisation: got.hasRomanisation }).toEqual(c.expect);
		});
	}
});

describe('hints contract: the grade rule', () => {
	for (const c of fixture.grades) {
		it(`${c.suggested} with ${c.used} hint(s) is ${c.expect}`, () => {
			expect(lowerForHints(c.suggested as ReviewGrade | null, c.used)).toBe(c.expect);
		});
	}

	for (const c of fixture.results) {
		it(c.name, () => {
			expect(
				applyHints(
					{ suggested: c.result.suggested as ReviewGrade | null, meta: c.result.meta },
					c.used
				)
			).toEqual(c.expect);
		});
	}
});
