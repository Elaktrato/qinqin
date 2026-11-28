// The look-alike drill's items (#228): the studied written forms in the order of their first review, the candidate
// sets of the workspace, the number of answers each set has (its mode), and the data files by language.
import { describe, expect, it } from 'vitest';
import setsFixture from '../../../../../../../docs/contracts/lookalikes/sets.json';
import { drillAnswersOf } from '$lib/studycore/drills';
import type { StudyCard, ReviewEvent } from '$lib/studycore/types';
import { lookAlikeItems, studiedWritten, type LookAlikeItemData } from './items';
import { loadSetsFile } from './data';
import { parseSetsFile } from './sets';

const card = (id: string, written: string | undefined, entryKind?: 'character'): StudyCard =>
	({ id, kind: 'vocab', entryId: 1, written, entryKind, deckIds: [], createdAt: '2026-11-01T00:00:00Z' }) as StudyCard;
const review = (cardId: string, ts: string): ReviewEvent =>
	({ id: `r-${cardId}-${ts}`, workspaceId: 1, device: 'web', ts, type: 'review', payload: { cardId, grade: 3 } }) as unknown as ReviewEvent;
const zh = parseSetsFile(setsFixture.fileOf.zh)!;
const ja = parseSetsFile(setsFixture.fileOf.ja)!;

describe('studiedWritten', () => {
	it('lists the written forms of reviewed cards in the order of their first review, once', () => {
		const cards = [card('a', '周末'), card('b', '未来'), card('c', '鸟', 'character'), card('d', '乌龟'), card('e', undefined), card('f', '未来')];
		const reviews = [review('b', '2026-11-03T00:00:00Z'), review('a', '2026-11-02T00:00:00Z'), review('c', '2026-11-04T00:00:00Z'), review('a', '2026-11-01T00:00:00Z'), review('e', '2026-11-01T00:00:00Z'), review('f', '2026-11-05T00:00:00Z')];
		// 乌龟 has no review; e has no snapshot; f is 未来 again.
		expect(studiedWritten({ cards, reviews })).toEqual(['周末', '未来', '鸟']);
	});
});

describe('lookAlikeItems', () => {
	it('gives each candidate set as an item with its number of answers', () => {
		const history = {
			cards: [card('a', '未来'), card('b', '小鸟')],
			reviews: [review('a', '2026-11-01T00:00:00Z'), review('b', '2026-11-02T00:00:00Z')],
			drillAnswers: drillAnswersOf(1, [
				{ id: '01KB00000000000000000D0001', workspaceId: 1, device: 'web', ts: '2026-11-03T00:00:00Z', type: 'drill.look-alikes', payload: { item: '未末', mode: 'recognise', grade: 3 } },
				{ id: '01KB00000000000000000D0002', workspaceId: 1, device: 'web', ts: '2026-11-04T00:00:00Z', type: 'drill.look-alikes', payload: { item: '未末', mode: 'choose', grade: 1 } },
				{ id: '01KB00000000000000000D0003', workspaceId: 1, device: 'web', ts: '2026-11-04T00:00:00Z', type: 'drill.tone-pairs', payload: { item: '鸟乌', mode: 'x', grade: 1 } }
			])
		};
		const items = lookAlikeItems(zh, 'zh', history);
		expect(items.map((i) => i.key)).toEqual(['未末', '鸟乌']);
		const data = items.map((i) => i.data as LookAlikeItemData);
		expect(data.map((d) => d.answers)).toEqual([2, 0]);
		expect(data[0].set.members).toEqual(['未', '末']);
		expect(data[0].language).toBe('zh');
		expect(data[0].file).toBe(zh);
	});

	it('gives the kana sets of a Japanese workspace with nothing studied', () => {
		expect(lookAlikeItems(ja, 'ja', { cards: [], reviews: [] }).map((i) => i.key)).toEqual(['ソン', 'カ力']);
	});
});

describe('loadSetsFile', () => {
	it('loads the bundled file of a workspace language', async () => {
		expect((await loadSetsFile('zh-Hant'))?.language).toBe('zh');
		expect((await loadSetsFile('ja'))?.language).toBe('ja');
		expect(await loadSetsFile('ko')).toBeNull();
	});
});
