// An entry's senses as the views show them: the entry answer's sense groups
// (or its flat glosses from an older answer) put through the sense display
// rule (senseDisplay.ts, docs/contracts/senses), with each unit's sense and
// dictionary kept. Cards, the entry page and the lookup popup all use it.

import type { Entry } from '$lib/api/types';
import { t } from '$lib/i18n';
import { partitionSenses } from '$lib/workspace/dictionaryVisibility';
import { displaySenses, type SenseLike, type SenseMark, type SenseUnit } from './senseDisplay';

/** One sense of an entry with the dictionary that gives it (the answer's SenseGroup). */
export interface EntrySense {
	dictionaryId: number;
	dictionaryName: string;
	license: string;
	attribution: string;
	pos: string[];
	tags: string[];
	glosses: string[];
	xrefs: string[];
}

/**
 * entrySenses: the answer's sense groups; an answer without them (an older
 * cached one) gives one sense per flat gloss, untagged.
 */
export function entrySenses(entry: Pick<Entry, 'senses' | 'senseGroups'>): EntrySense[] {
	if (entry.senseGroups !== undefined && entry.senseGroups.length > 0) return entry.senseGroups;
	return entry.senses.map((s) => ({
		dictionaryId: s.dictionaryId,
		dictionaryName: s.dictionaryName,
		license: s.license,
		attribution: s.attribution,
		pos: [],
		tags: [],
		glosses: [s.gloss],
		xrefs: []
	}));
}

/** A display unit with the sense it comes from; firstOfSense: the sense's first unit (it carries the xrefs). */
export interface UnitOf<T> extends SenseUnit {
	of: T;
	firstOfSense: boolean;
}

/** unitsOf: the display units of senses (display order), each with its sense. */
export function unitsOf<T extends SenseLike>(senses: readonly T[]): UnitOf<T>[] {
	const seen = new Set<number>();
	return displaySenses(senses).map((unit) => {
		const firstOfSense = !seen.has(unit.sense);
		seen.add(unit.sense);
		return { ...unit, of: senses[unit.sense], firstOfSense };
	});
}

/** shownGlosses: the glosses of the unfolded units in display order, at most max. */
export function shownGlosses(units: readonly SenseUnit[], max: number): string[] {
	return units
		.filter((u) => !u.folded)
		.flatMap((u) => u.glosses)
		.slice(0, max);
}

/** One dictionary's units, in display order. */
export interface DictionaryUnits<T> {
	dictionaryId: number;
	dictionaryName: string;
	license: string;
	attribution: string;
	units: UnitOf<T>[];
}

/** dictionaryGroups: units grouped by dictionary, dictionaries in first-seen display order. */
export function dictionaryGroups<T extends EntrySense>(units: readonly UnitOf<T>[]): DictionaryUnits<T>[] {
	const byId = new Map<number, DictionaryUnits<T>>();
	for (const unit of units) {
		const { dictionaryId, dictionaryName, license, attribution } = unit.of;
		let group = byId.get(dictionaryId);
		if (group === undefined) {
			group = { dictionaryId, dictionaryName, license, attribution, units: [] };
			byId.set(dictionaryId, group);
		}
		group.units.push(unit);
	}
	return [...byId.values()];
}

/** markLabel: the chip of a sensitive unit ("vulgar", "derogatory", "slang"). */
export function markLabel(mark: SenseMark): string {
	switch (mark) {
		case 'vulg':
			return t('entry.senses.mark.vulg');
		case 'derog':
			return t('entry.senses.mark.derog');
		case 'sl':
			return t('entry.senses.mark.sl');
	}
}

/** MARK_TAGS: JMdict tags a mark chip already says; their raw chips are left out. */
export const MARK_TAGS: readonly string[] = ['vulg', 'derog', 'sl', 'net-sl', 'm-sl'];

/** The entry page's senses: dictionary groups of every unit (none folded), and the hidden-dictionary state. */
export interface PageGroups {
	groups: DictionaryUnits<EntrySense>[];
	/** Glosses of hidden dictionaries left out (0 once revealed). */
	hiddenCount: number;
	/** Every dictionary is hidden: all are shown, with a note. */
	allHidden: boolean;
}

/**
 * pageGroups: the full entry keeps every unit in display order, the
 * sensitive ones unfolded (they show marked); dictionaries the workspace
 * hides are left out until revealed, unless all of them are hidden.
 */
export function pageGroups(senses: readonly EntrySense[], hidden: ReadonlySet<number>, revealed: boolean): PageGroups {
	const units = unitsOf(senses).map((u) => ({ ...u, folded: false, dictionaryId: u.of.dictionaryId }));
	const partition = partitionSenses(units, hidden);
	const shown = revealed ? units : partition.shown;
	return {
		groups: dictionaryGroups(shown),
		hiddenCount: revealed ? 0 : partition.hidden.reduce((n, u) => n + u.glosses.length, 0),
		allHidden: partition.allHidden
	};
}
