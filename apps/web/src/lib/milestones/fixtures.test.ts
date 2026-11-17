// Shape checks of docs/contracts/milestones/ (every file, every case): the
// rule names, the id grammar of every id the fixtures use, the level ids
// against the decks contract and each case's own invariants. The behaviour is
// decoded by catalogue/reached/replayReached/seen/plan.test.ts.
import { describe, expect, it } from 'vitest';
import catalogue from '../../../../../docs/contracts/milestones/catalogue.json';
import reached from '../../../../../docs/contracts/milestones/reached.json';
import seenRows from '../../../../../docs/contracts/milestones/seen-rows.json';
import seenMerge from '../../../../../docs/contracts/milestones/seen-merge.json';
import showPlan from '../../../../../docs/contracts/milestones/show-plan.json';
import systemDeckIds from '../../../../../docs/contracts/decks/system-deck-ids.json';

const thresholds = new Map(catalogue.families.map((f) => [f.family, f.thresholds]));
const levelIds = new Set(systemDeckIds.cases.filter((c) => c.kind === 'level').map((c) => c.id));

function wellFormed(id: string): boolean {
	const colon = id.indexOf(':');
	const family = id.slice(0, colon);
	const rest = id.slice(colon + 1);
	if (family === 'level-complete') return /^d-lvl-[a-z0-9-]*-[0-9a-f]{8}$/.test(rest);
	return /^[1-9][0-9]*$/.test(rest) && (thresholds.get(family) ?? []).includes(Number(rest));
}

describe('docs/contracts/milestones fixtures', () => {
	it('name their rules', () => {
		expect([catalogue, reached, seenRows, seenMerge, showPlan].map((f) => [f.version, f.rule])).toEqual([
			[1, 'milestones/catalogue'],
			[1, 'milestones/reached'],
			[1, 'milestones/seen-rows'],
			[1, 'milestones/seen-merge'],
			[1, 'milestones/show-plan']
		]);
	});

	it('use unique case names per file', () => {
		for (const file of [catalogue, reached, seenRows, seenMerge, showPlan]) {
			const names = (file.cases as { name: string }[]).map((c) => c.name);
			expect(new Set(names).size).toBe(names.length);
		}
	});

	it('every expected reached id is well formed, sorted by instant and dated', () => {
		for (const c of reached.cases) {
			const ats = c.expect.map((e) => Date.parse(e.reachedAt));
			expect(ats, c.name).toEqual([...ats].sort((a, b) => a - b));
			for (const e of c.expect) {
				expect(wellFormed(e.id), `${c.name}: ${e.id}`).toBe(true);
				expect(e.reachedDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				if (e.id.startsWith('level-complete:')) expect(levelIds.has(e.id.slice('level-complete:'.length))).toBe(true);
			}
		}
	});

	it('the level deck ids of reached.json agree with the decks contract where it pins them', () => {
		for (const c of reached.cases) {
			for (const level of c.levels as { packId: string; level: string; deckId: string }[]) {
				const pinned = systemDeckIds.cases.find((d) => d.kind === 'level' && d.packId === level.packId && d.level === level.level);
				if (pinned !== undefined) expect(level.deckId, `${level.packId} ${level.level}`).toBe(pinned.id);
				expect(wellFormed(`level-complete:${level.deckId}`)).toBe(true);
			}
		}
	});

	it('the card plans mark every unseen id', () => {
		for (const c of showPlan.cases) {
			if (c.op !== 'card') continue;
			const seen = new Set(c.seen as string[]);
			const unseen = (c.reached as { id: string }[]).filter((r) => !seen.has(r.id)).map((r) => r.id);
			expect([...(c.expect as { ids: string[] }).ids].sort(), c.name).toEqual(unseen.sort());
		}
	});
});
