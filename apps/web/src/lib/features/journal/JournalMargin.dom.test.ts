import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import type { Correction } from './corrections';
import type { AiGate } from './editorLogic';

import JournalMargin from './JournalMargin.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

function correction(id: string, kind: 'mistake' | 'suggestion', state: Correction['state'], index: number): Correction {
	return {
		annotation: {
			id,
			quote: id,
			prefix: '',
			suffix: '',
			correction: `${id}fixed`,
			explanation: `${id} why`,
			category: kind === 'suggestion' ? 'style' : 'grammar',
			kind
		},
		kind,
		state,
		index
	};
}

const list = [
	correction('a', 'mistake', 'placed', 0),
	correction('b', 'suggestion', 'placed', 1),
	correction('c', 'mistake', 'listOnly', 2),
	correction('d', 'suggestion', 'missing', 3)
];

const gate: AiGate = { enabled: true, hint: null, settingsLink: false };
const ideas = { workspaceId: 1, gate, onstart: vi.fn(), studyLang: 'zh-Hans', explanationLang: 'en' };

afterEach(cleanup);

describe('JournalMargin (#103)', () => {
	it('corrections: heading, counts and one note per correction in order', () => {
		render(JournalMargin, { props: { mode: 'corrections', corrections: list, openId: null, onopen: vi.fn(), ...ideas }, context: ctx.context });
		expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('3 corrections');
		expect(document.querySelector('.counts')?.textContent).toBe('2 mistakes · 1 suggestion');
		const notes = [...document.querySelectorAll('button.note')];
		expect(notes.map((n) => n.id)).toEqual(['correction-a', 'correction-b', 'correction-c']);
		expect(document.querySelector('.missing')?.textContent).toContain('d');
	});

	it('expands only the open note', () => {
		render(JournalMargin, { props: { mode: 'corrections', corrections: list, openId: 'b', onopen: vi.fn(), ...ideas }, context: ctx.context });
		const notes = [...document.querySelectorAll('button.note')];
		expect(notes.map((n) => n.getAttribute('aria-expanded'))).toEqual(['false', 'true', 'false']);
	});

	it('opening a note calls onopen and scrolls it into view', async () => {
		const onopen = vi.fn();
		render(JournalMargin, { props: { mode: 'corrections', corrections: list, openId: null, onopen, ...ideas }, context: ctx.context });
		const note = document.getElementById('correction-a')!;
		const scroll = vi.fn();
		note.scrollIntoView = scroll;
		await fireEvent.click(note);
		expect(onopen).toHaveBeenCalledWith('a');
		await Promise.resolve();
		expect(scroll).toHaveBeenCalled();
	});

	it('separates list-only and missing corrections with the existing words', () => {
		render(JournalMargin, { props: { mode: 'corrections', corrections: list, openId: null, onopen: vi.fn(), ...ideas }, context: ctx.context });
		const text = document.querySelector('aside')!.textContent!;
		expect(text).toContain('Not placed in the text');
		expect(text).toContain('No longer in the text');
		expect(text).toContain('You changed these words after the review.');
	});

	it('Escape closes the open note and focuses its mark', async () => {
		const mark = document.createElement('button');
		mark.id = 'mark-a';
		document.body.append(mark);
		const onopen = vi.fn();
		render(JournalMargin, { props: { mode: 'corrections', corrections: list, openId: 'a', onopen, ...ideas }, context: ctx.context });
		await fireEvent.keyDown(screen.getByRole('complementary'), { key: 'Escape' });
		expect(onopen).toHaveBeenCalledWith(null);
		expect(document.activeElement).toBe(mark);
	});

	it('says when there are no corrections', () => {
		render(JournalMargin, { props: { mode: 'corrections', corrections: [], openId: null, onopen: vi.fn(), ...ideas }, context: ctx.context });
		expect(screen.getByText('No corrections in the current text.')).toBeTruthy();
	});

	it('ideas mode renders IdeasPanel and the margin is a landmark', () => {
		render(JournalMargin, { props: { mode: 'ideas', corrections: [], openId: null, onopen: vi.fn(), ...ideas }, context: ctx.context });
		expect(screen.getByRole('complementary', { name: 'Margin' })).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Ideas for today' })).toBeTruthy();
	});
});
