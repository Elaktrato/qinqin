import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Entry } from '$lib/api/types';
import type { FlowItem } from '../session/cardFlow';

vi.mock('$lib/components/PlayButton.svelte', () => ({ default: () => ({}) }));

import ToneCard from './ToneCard.svelte';
import CardHarness from '../face/testing/CardHarness.svelte';
import source from './ToneCard.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const entry = {
	id: 1,
	language: 'zh',
	kind: 'word',
	written: '你好',
	readings: [{ type: 'pinyin', value: 'nǐ hǎo', plain: 'ni3hao3', ord: 0 }],
	senses: [],
	variants: [],
	sentences: [],
	badges: []
} as unknown as Entry;
const item: FlowItem = { cardId: 't1', kind: 'tone', entryId: 1, virtual: false, card: null };

afterEach(cleanup);

function setup(over: Record<string, unknown> = {}) {
	const onDone = vi.fn();
	const view = render(CardHarness, { props: { card: ToneCard, cardProps: { item, entry, done: false, onDone, ...over }, kindLabel: 'Tones' }, context: ctx.context });
	return { onDone, ...view };
}

function pads(): HTMLElement[] {
	return screen.getAllByRole('img').filter((el) => el.classList.contains('pad'));
}

async function key(k: string): Promise<KeyboardEvent> {
	const event = new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true });
	window.dispatchEvent(event);
	await Promise.resolve();
	return event;
}

describe('ToneCard answer readings', () => {
	const several = {
		...entry,
		written: '行',
		readings: [
			{ type: 'pinyin', value: 'xíng', plain: 'xing2', ord: 0 },
			{ type: 'pinyin', value: 'háng', plain: 'hang2', ord: 1 }
		]
	} as unknown as Entry;

	it('names Pinyin once and joins the readings with " | ", each in <strong>', () => {
		setup({ entry: several, done: true });
		const table = screen.getByRole('table', { name: 'Readings' });
		expect(table.textContent?.replace(/\s+/g, ' ').trim()).toBe('Pinyin xíng | háng');
		expect([...table.querySelectorAll('strong')].map((el) => el.textContent)).toEqual(['xíng', 'háng']);
	});

	it('one reading: a single value', () => {
		setup({ done: true });
		expect(screen.getByRole('table', { name: 'Readings' }).textContent?.replace(/\s+/g, ' ').trim()).toBe('Pinyin nǐ hǎo');
	});

	it('shows no table before the answer', () => {
		setup();
		expect(screen.queryByRole('table')).toBeNull();
	});
});

describe('ToneCard on the open page (#101)', () => {
	it('one pad per syllable with role img and its tone in the name', () => {
		setup();
		expect(pads().map((p) => p.getAttribute('aria-label'))).toEqual([
			'Syllable 1, 你: no tone yet',
			'Syllable 2, 好: no tone yet'
		]);
	});

	it('1–5 sets the highlighted syllable, ←/→ move, Backspace clears, Enter checks (keys unchanged)', async () => {
		const { onDone } = setup();
		expect((await key('3')).defaultPrevented).toBe(true);
		expect(pads()[0].getAttribute('aria-label')).toBe('Syllable 1, 你: third tone, dipping');
		await key('ArrowLeft');
		await key('Backspace');
		expect(pads()[0].getAttribute('aria-label')).toBe('Syllable 1, 你: no tone yet');
		await key('3');
		await key('ArrowRight');
		await key('3');
		expect(pads()[1].getAttribute('aria-label')).toBe('Syllable 2, 好: third tone, dipping');
		await key('Enter');
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].suggested).toBe(3);
	});

	it('primary Check is disabled until every syllable has a tone', async () => {
		const { onDone } = setup();
		const check = screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement;
		expect(check.closest('.dock')).not.toBeNull();
		expect(check.disabled).toBe(true);
		await key('3');
		expect(check.disabled).toBe(true);
		await key('4');
		expect(check.disabled).toBe(false);
		await fireEvent.click(check);
		expect(onDone).toHaveBeenCalledTimes(1);
		expect(onDone.mock.calls[0][0].meta.mistakes).toBe(1);
	});

	it('the selected tone number is pressed (aria-pressed) and underlined, not filled', async () => {
		setup();
		await fireEvent.click(screen.getAllByRole('button', { name: '2: second tone, rising' })[0]);
		const pressed = document.querySelectorAll('.tone-buttons button[aria-pressed="true"]');
		expect(pressed).toHaveLength(1);
		const style = source.slice(source.indexOf('<style'));
		const selected = style.match(/\.tone-buttons button\.selected\s*\{([^}]*)\}/)?.[1] ?? '';
		expect(selected).toMatch(/color:\s*var\(--reading-accent\)/);
		expect(selected).not.toMatch(/background(-color)?:\s*(?!transparent)/);
		expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|opacity/);
	});

	it('the pads are in the work area; the word is the prompt', () => {
		setup();
		expect(document.querySelector('.face-prompt .fp-word')?.textContent).toBe('你好');
		expect(pads()[0].closest('.face-work')).not.toBeNull();
	});
});

describe('ToneCard with pinyin hidden (#284, owner decision)', () => {
	function hidePinyin() {
		const ws = { id: 4, language: 'zh', name: '', settings: { romanisation: { pinyin: 'never' } }, updatedAt: 't' };
		updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	}

	it('asks for the tones of the characters and answers with tone numbers and contours, never pinyin', async () => {
		hidePinyin();
		const { container } = setup();
		expect(pads().map((p) => p.getAttribute('aria-label'))).toEqual(['Syllable 1, 你: no tone yet', 'Syllable 2, 好: no tone yet']);
		await key('3');
		await key('2');
		await key('Enter');
		const answers = [...container.querySelectorAll<HTMLElement>('.answer')];
		expect(answers.map((a) => a.dataset.answerTone)).toEqual(['3', '3']);
		expect(answers[0].querySelector('svg.answer-contour')).not.toBeNull();
		expect(answers[0].textContent).toContain('third tone, dipping');
		expect(container.textContent).not.toMatch(/nǐ|hǎo|ni|hao/);
	});

	it('the answer has no pinyin table', () => {
		hidePinyin();
		const { container } = setup({ done: true });
		expect(screen.queryByRole('table', { name: 'Readings' })).toBeNull();
		expect(container.textContent).not.toContain('nǐ hǎo');
	});

	it('names syllables by number, not pinyin, when the characters do not line up', () => {
		hidePinyin();
		const erhua = { ...entry, written: '一点儿', readings: [{ type: 'pinyin', value: 'yì diǎnr', plain: 'yi4dianr3', ord: 0 }] } as unknown as Entry;
		const { container } = setup({ entry: erhua });
		expect(pads().map((p) => p.getAttribute('aria-label'))).toEqual(['Syllable 1: no tone yet', 'Syllable 2: no tone yet']);
		expect(container.textContent).not.toMatch(/yi|dian/);
	});
});

describe('ToneCard and tone sandhi (#300)', () => {
	const buKeQi = {
		...entry,
		written: '不客气',
		readings: [{ type: 'pinyin', value: 'bù kè qi', plain: 'bu4ke4qi5', ord: 0 }]
	} as unknown as Entry;

	function workspace(settings: Record<string, unknown>) {
		const ws = { id: 4, language: 'zh', name: '', settings, updatedAt: 't' };
		updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	}

	async function answer(...tones: string[]): Promise<void> {
		for (const t of tones) await key(t);
		await key('Enter');
	}

	const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.answer')];
	/** Each answer row as "citation" or "citation → spoken" (the arrow is decoration, the spoken part has a name). */
	const shown = (container: HTMLElement) =>
		rows(container).map((row) => {
			const citation = row.querySelector('.citation')?.textContent?.trim() ?? '';
			const spoken = row.querySelector('.spoken .shown')?.textContent?.trim();
			return spoken === undefined ? citation : `${citation} → ${spoken}`;
		});

	it('by default 2-4-5 (spoken) is right, and the answer shows bù → bú', async () => {
		const { onDone, container } = setup({ entry: buKeQi });
		await answer('2', '4', '5');
		expect(onDone.mock.calls[0][0]).toMatchObject({ suggested: 3, meta: { mistakes: 0 } });
		expect(shown(container)).toEqual(['bù → bú', 'kè', 'qi']);
		expect(rows(container)[0].dataset.spokenTone).toBe('2');
		expect(rows(container)[0].querySelector('.spoken .sr-only')?.textContent).toBe('spoken as bú');
	});

	it('by default 4-4-5 (citation) is right too', async () => {
		const { onDone } = setup({ entry: buKeQi });
		await answer('4', '4', '5');
		expect(onDone.mock.calls[0][0]).toMatchObject({ suggested: 3, meta: { mistakes: 0 } });
	});

	it('with "Grade spoken tones" only 2-4-5 is right, and the card says so', async () => {
		workspace({ tones: { gradeSpoken: true } });
		const { onDone, container } = setup({ entry: buKeQi });
		expect(container.querySelector('.face-prompt')?.textContent).toContain('Mark the tones as spoken (tone sandhi).');
		await answer('4', '4', '5');
		expect(onDone.mock.calls[0][0]).toMatchObject({ suggested: 2, meta: { mistakes: 1 } });
		expect(rows(container)[0].classList.contains('wrong')).toBe(true);
		cleanup();
		const again = setup({ entry: buKeQi });
		await answer('2', '4', '5');
		expect(again.onDone.mock.calls[0][0]).toMatchObject({ suggested: 3, meta: { mistakes: 0 } });
	});

	it('says nothing about spoken tones by default', () => {
		const { container } = setup({ entry: buKeQi });
		expect(container.querySelector('.face-prompt')?.textContent).not.toContain('spoken');
	});

	it('with "Show tone sandhi" off the answer shows citation tones only', async () => {
		workspace({ tones: { showSandhi: false } });
		const { onDone, container } = setup({ entry: buKeQi });
		await answer('2', '4', '5');
		expect(onDone.mock.calls[0][0]).toMatchObject({ meta: { mistakes: 0 } });
		expect(shown(container)).toEqual(['bù', 'kè', 'qi']);
		expect(container.querySelector('.spoken')).toBeNull();
	});

	it('with pinyin hidden the spoken tone is a tone number and contour too, never pinyin', async () => {
		workspace({ romanisation: { pinyin: 'never' } });
		const { container } = setup({ entry: buKeQi });
		await answer('2', '4', '5');
		const first = rows(container)[0];
		expect(first.querySelectorAll('svg.answer-contour')).toHaveLength(2);
		expect(first.textContent?.replace(/\s+/g, ' ')).toContain('4ˋ');
		expect(first.textContent?.replace(/\s+/g, ' ')).toContain('2ˊ');
		expect(first.querySelector('.spoken .sr-only')?.textContent).toBe('spoken as second tone, rising');
		expect(container.textContent).not.toMatch(/bù|bú|kè/);
	});

	it('the "1-1-5" report: the answer shows the dictionary tones, never the marked ones', async () => {
		const { onDone, container } = setup({ entry: buKeQi });
		await answer('1', '1', '5');
		expect(onDone.mock.calls[0][0]).toMatchObject({ suggested: 1, meta: { mistakes: 2 } });
		expect(shown(container)).toEqual(['bù → bú', 'kè', 'qi']);
		expect(rows(container).map((row) => row.dataset.answerTone)).toEqual(['4', '4', '5']);
		expect(rows(container).map((row) => row.classList.contains('wrong'))).toEqual([true, true, false]);
	});

	it('你好: 3-3 and 2-3 are both right; the answer shows nǐ → ní', async () => {
		const { onDone, container } = setup();
		await answer('2', '3');
		expect(onDone.mock.calls[0][0]).toMatchObject({ meta: { mistakes: 0 } });
		expect(shown(container)).toEqual(['nǐ → ní', 'hǎo']);
	});
});
