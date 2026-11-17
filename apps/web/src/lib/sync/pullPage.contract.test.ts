import { describe, expect, it } from 'vitest';

import pageFixture from '../../../../../docs/contracts/sync/pull-page.json';
import roundsFixture from '../../../../../docs/contracts/sync/pull-rounds.json';
import envelopeFixture from '../../../../../docs/contracts/events/envelope.json';
import { normalizeUrl } from '../pwa/sw/classify';
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
		tombstones?: string;
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
				const url = firstPageUrl({ collections: r.query.collections ?? [], workspace: ws, since: r.query.since === '$cursor' ? 'c2.x' : r.query.since, limit: r.query.limit, tombstones: r.query.tombstones === '1' });
				expect(url.startsWith('/api/sync/pull?')).toBe(true);
				expect(url).toContain('v=2');
				expect(url.includes('tombstones=1')).toBe(r.query.tombstones === '1');
				expect(url, 'keys sorted as the worker cache key').toBe(normalizeUrl(url));
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

describe('docs/contracts/events/envelope.json: pull v2 never ships lookup events', () => {
	interface EnvelopeStep {
		post?: { events?: { type: string }[] };
		pull?: boolean;
		expect: { types?: string[] };
	}
	const envelope = envelopeFixture as unknown as { cases: { name: string; steps: EnvelopeStep[] }[] };
	const pull = envelope.cases.find((c) => c.steps.some((s) => s.pull));
	const template = cases.find((c) => c.valid && c.position === 'last');
	it('accepts exactly the event types the server ships', () => {
		expect(pull).toBeDefined();
		expect(template).toBeDefined();
		const shipped = pull!.steps.find((s) => s.pull)!.expect.types!;
		const posted = pull!.steps.flatMap((s) => s.post?.events ?? []);
		expect(posted.length).toBeGreaterThan(shipped.length);
		for (const ev of posted) {
			const page = structuredClone(template!.page) as { collections: { events: Record<string, unknown>[] } };
			page.collections.events = [{ ...page.collections.events[0], type: ev.type }];
			expect(parsePullPage(page, template!.requested) !== null, ev.type).toBe(shipped.includes(ev.type));
		}
	});
});
