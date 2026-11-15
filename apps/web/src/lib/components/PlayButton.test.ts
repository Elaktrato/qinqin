import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import type { AudioClip } from '../api/audio';
import type { Reading } from '../api/types';
import PlayButton from './PlayButton.svelte';
import Readings from './Readings.svelte';

const clip = (n: string): AudioClip => ({ url: `/api/audio/clips/${n}.opus`, packId: 'p', license: 'CC BY 4.0', attribution: 'Kanji alive', source: '' });
const html = (body: string) => body.replace(/<!--[^>]*-->/g, '');

describe('PlayButton', () => {
	it('renders a labelled, not-pressed button titled with the credit when it has clips', () => {
		const { body } = render(PlayButton, { props: { clips: [clip('a')], lang: 'ja', deviceVoice: true } });
		const out = html(body);
		expect(out).toContain('aria-label="Play pronunciation"');
		expect(out).toContain('aria-pressed="false"');
		expect(out).toContain('title="Audio: Kanji alive · CC BY 4.0"');
	});
	it('renders nothing without clips and without a usable voice (no dead button)', () => {
		const { body } = render(PlayButton, { props: { clips: [], speakText: '風', lang: 'ja', deviceVoice: true } });
		expect(html(body)).not.toContain('<button');
		const off = render(PlayButton, { props: { clips: [], lang: 'ja', deviceVoice: false } });
		expect(html(off.body)).not.toContain('<button');
	});
});

describe('PlayButton accessible name', () => {
	it('names the word or reading when it is given', () => {
		const { body } = render(PlayButton, { props: { clips: [clip('a')], lang: 'zh', deviceVoice: true, label: '行 (xíng)' } });
		expect(html(body)).toContain('aria-label="Play pronunciation of 行 (xíng)"');
	});
});

describe('Readings with audio', () => {
	const readings: Reading[] = [
		{ type: 'pinyin', value: 'xíng', plain: 'xing2', ord: 0 },
		{ type: 'pinyin', value: 'háng', plain: 'hang2', ord: 1 },
		{ type: 'bopomofo', value: 'ㄒㄧㄥˊ', plain: '', ord: 2 }
	];
	it('has a play button for each pinyin reading that has clips, and none without audioFor', () => {
		const withAudio = render(Readings, {
			props: { readings, word: '行', lang: 'zh', deviceVoice: false, audioFor: (r: Reading, i: number) => (i === 0 || i === 1 ? [clip(`s${i}`)] : null) }
		});
		expect(html(withAudio.body).match(/aria-label="Play pronunciation of 行 \(/g)).toHaveLength(2);
		expect(html(withAudio.body)).toContain('aria-label="Play pronunciation of 行 (xíng)"');
		expect(html(withAudio.body)).toContain('aria-label="Play pronunciation of 行 (háng)"');
		const without = render(Readings, { props: { readings } });
		expect(html(without.body)).not.toContain('Play pronunciation');
	});
	it('skips a pinyin reading whose sequence is incomplete', () => {
		const { body } = render(Readings, {
			props: { readings, lang: 'zh', deviceVoice: false, audioFor: (_r: Reading, i: number) => (i === 1 ? [clip('h')] : null) }
		});
		expect(html(body).match(/aria-label="Play pronunciation/g)).toHaveLength(1);
	});
});
