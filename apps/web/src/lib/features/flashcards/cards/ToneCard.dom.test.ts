import { testContext, type TestContext } from '$lib/testing/context';
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
