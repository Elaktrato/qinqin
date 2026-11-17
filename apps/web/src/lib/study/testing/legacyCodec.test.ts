import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../docs/contracts/study/legacy-codec.json';
import { parseRow, bodyOf, type StudyCollection } from '../rows';
import { fromLegacy, toLegacy, typedPull } from './legacyCodec';

interface Case {
	name: string;
	key: string;
	data: unknown;
	expect: 'unreadable' | { collection: StudyCollection; row: Record<string, unknown> };
	roundTrip?: Record<string, unknown>;
}

const meta = { workspaceId: 7, version: 1, updatedAt: '2026-11-12T10:00:00Z', deletedAt: null };

// The test helper mirrors the server codec; the fixture keeps the two equal.
describe('test-only legacy codec (docs/contracts/study/legacy-codec.json)', () => {
	for (const c of fixture.cases as Case[]) {
		it(c.name, () => {
			const got = fromLegacy(c.key, c.data);
			if (c.expect === 'unreadable') {
				expect(got).toBeNull();
				return;
			}
			expect(got?.collection).toBe(c.expect.collection);
			const row = parseRow(c.expect.collection, { ...got!.body, ...meta });
			expect(row).not.toBeNull();
			expect(bodyOf(row!)).toEqual(c.expect.row);
			expect(toLegacy(c.expect.collection, row!, fixture.modifiedAt)).toEqual({ key: c.key, data: c.roundTrip });
		});
	}

	it('typedPull moves readable workspace rows and leaves the rest', () => {
		const card = { id: 'c1', kind: 'vocab', entryId: 1, deckIds: ['general'], createdAt: 'x' };
		const pull = typedPull({
			pluginData: [
				{ pluginId: 'qinqin-flashcards', key: 'card:c1', workspaceId: 7, data: card, version: 3, updatedAt: '2026-01-01T00:00:00Z', deletedAt: null },
				{ pluginId: 'qinqin-flashcards', key: 'card:c2', workspaceId: 7, data: { id: 'other' } },
				{ pluginId: 'qinqin-flashcards', key: 'known:5', workspaceId: 7, data: {} },
				{ pluginId: 'qinqin-core', key: 'card:c1', workspaceId: 7, data: card }
			]
		});
		expect((pull.cards as unknown[]).length).toBe(1);
		expect(pull.cards).toMatchObject([{ id: 'c1', version: 3, workspaceId: 7 }]);
		expect((pull.pluginData as { key: string }[]).map((r) => r.key)).toEqual(['card:c2', 'known:5', 'card:c1']);
		expect(pull.decks).toEqual([]);
	});
});
