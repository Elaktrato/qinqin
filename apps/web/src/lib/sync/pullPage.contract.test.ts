import { describe, expect, it } from 'vitest';

import pageFixture from '../../../../../docs/contracts/sync/pull-page.json';
import roundsFixture from '../../../../../docs/contracts/sync/pull-rounds.json';
import { firstPageUrl, nextPageUrl, parsePullPage, pullAll, V2_STUDY_COLLECTIONS } from './pager';

interface PageCase {
	name: string;
	valid: boolean;
	reason?: string;
	requested: string[];
	position?: 'first' | 'middle' | 'last' | 'only';
	page: unknown;
}
const cases = pageFixture.cases as PageCase[];

describe('docs/contracts/sync/pull-page.json', () => {
	it('keeps the study collection list of the fixture', () => {
		expect([...V2_STUDY_COLLECTIONS]).toEqual(pageFixture.studyCollections);
	});
	for (const c of cases) {
		it(`${c.valid ? 'decodes' : 'refuses'}: ${c.name}${c.reason ? ` (${c.reason})` : ''}`, () => {
			const page = parsePullPage(c.page, c.requested);
			if (c.valid) {
				expect(page).not.toBeNull();
				if (c.position === 'first' || c.position === 'only') expect(page?.scope).not.toBeNull();
				else expect(page?.scope).toBeNull();
				if (c.position === 'last' || c.position === 'only') expect(page?.cursor).not.toBeNull();
				else expect(page?.next).not.toBeNull();
			} else {
				expect(page).toBeNull();
			}
		});
	}
});

describe('pull-rounds.json requests are expressible by the client', () => {
	interface Q {
		collections?: string[];
		limit?: number;
		workspace?: string | number;
		since?: string;
		page?: string;
	}
	it('every non-error request builds a first or next URL', () => {
		let n = 0;
		for (const c of roundsFixture.cases as { requests: { query: Q; expect: { status: number } }[] }[]) {
			for (const r of c.requests) {
				if (r.expect.status !== 200) continue;
				n++;
				if (r.query.page !== undefined) {
					expect(nextPageUrl('p2.x')).toBe('/api/sync/pull?page=p2.x&v=2');
					continue;
				}
				const ws = typeof r.query.workspace === 'number' ? r.query.workspace : undefined;
				const url = firstPageUrl({ collections: r.query.collections ?? [], workspace: ws, since: r.query.since === '$cursor' ? 'c2.x' : r.query.since, limit: r.query.limit });
				expect(url.startsWith('/api/sync/pull?')).toBe(true);
				expect(url).toContain('v=2');
			}
		}
		expect(n).toBeGreaterThan(5);
	});
});

describe('pullAll over the fixture round (first, middle, last)', () => {
	const seq = cases.filter((c) => c.valid && c.requested.length === 15 && c.position !== 'only');
	it('concatenates every page in order and returns scope and cursor', async () => {
		const pages = seq.map((c) => c.page as Record<string, unknown>);
		expect(seq.map((c) => c.position)).toEqual(['first', 'middle', 'last']);
		const asked: string[] = [];
		let i = 0;
		const get = async (path: string) => {
			asked.push(path);
			return pages[i++];
		};
		const out = await pullAll(get, firstPageUrl({ collections: seq[0].requested }), seq[0].requested);
		expect(asked).toHaveLength(3);
		expect(asked[1]).toBe(nextPageUrl((pages[0] as { next: string }).next));
		expect(out.cursor).toBe((pages[2] as { cursor: string }).cursor);
		expect(out.scope.languages).toEqual(['ja', 'zh']);
		const total = (k: string) => pages.reduce((s, p) => s + ((p as { collections: Record<string, unknown[]> }).collections[k]?.length ?? 0), 0);
		for (const k of seq[0].requested) expect(out.collections[k]).toHaveLength(total(k));
	});
});
