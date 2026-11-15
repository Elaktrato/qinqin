import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { CardAudio } from '$lib/study/audioCue';
import type { FlowItem } from '$lib/study/cardFlow';
import ToneCard from './ToneCard.svelte';
import VocabCard from './VocabCard.svelte';

const entry = {
	id: 1,
	language: 'zh',
	kind: 'word',
	written: '你好',
	readings: [{ type: 'pinyin', value: 'nǐ hǎo', plain: 'ni3hao3', ord: 0 }],
	attrs: {},
	radicalId: null,
	badges: [],
	variants: [],
	sentences: [],
	senses: []
} as unknown as Entry;
const item = { cardId: 'c', entryId: 1, kind: 'vocab', virtual: true } as unknown as FlowItem;
const audio: CardAudio = {
	clips: [{ url: '/api/audio/clips/a.opus', packId: 'p', license: 'CC0', attribution: 'A', source: '' }],
	speakText: '你好',
	lang: 'zh',
	deviceVoice: true
};
const noop = () => {};
const text = (html: string) => html.replace(/<!--[^>]*-->/g, '');

describe('VocabCard audio', () => {
	it('has no play button before the answer is revealed (it would give the answer away)', () => {
		const { body } = render(VocabCard, { props: { item, entry, revealed: false, onDone: noop, audio } });
		expect(text(body)).not.toContain('Play pronunciation');
	});
	it('shows it after the reveal', () => {
		const { body } = render(VocabCard, { props: { item, entry, revealed: true, onDone: noop, audio } });
		expect(text(body)).toContain('aria-label="Play pronunciation of 你好"');
	});
	it('shows the credit as visible text after the reveal, not only as a tooltip', () => {
		const { body } = render(VocabCard, { props: { item, entry, revealed: true, onDone: noop, audio } });
		expect(text(body)).toMatch(/<p class="credit[^"]*">Audio: A · CC0<\/p>/);
		const before = render(VocabCard, { props: { item, entry, revealed: false, onDone: noop, audio } });
		expect(text(before.body)).not.toContain('class="credit');
	});
	it('keeps the play button out of the answer heading', () => {
		const { body } = render(VocabCard, { props: { item, entry, revealed: true, onDone: noop, audio } });
		const h2 = /<h2[^>]*>[\s\S]*?<\/h2>/.exec(text(body))?.[0] ?? '';
		expect(h2).not.toContain('button');
	});
	it('names the word in the button label', () => {
		const { body } = render(VocabCard, { props: { item, entry, revealed: true, onDone: noop, audio } });
		expect(text(body)).toContain('aria-label="Play pronunciation of 你好"');
	});
	it('shows none without audio', () => {
		const { body } = render(VocabCard, { props: { item, entry, revealed: true, onDone: noop } });
		expect(text(body)).not.toContain('Play pronunciation');
	});
});

describe('ToneCard audio', () => {
	const toneItem = { ...item, kind: 'tone' } as unknown as FlowItem;
	it('shows the play button only once the card is done', () => {
		const before = render(ToneCard, { props: { item: toneItem, entry, done: false, onDone: noop, audio } });
		expect(text(before.body)).not.toContain('Play pronunciation');
		const after = render(ToneCard, { props: { item: toneItem, entry, done: true, onDone: noop, audio } });
		expect(text(after.body)).toContain('aria-label="Play pronunciation of 你好"');
		expect(text(after.body)).toMatch(/class="credit/);
	});
});
