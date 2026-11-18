import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CardHarness from './testing/CardHarness.svelte';
import PrimaryCard from './testing/PrimaryCard.svelte';
import { useCardFace } from './cardFace.svelte';
import faceSource from './StudyFace.svelte?raw';
import topSource from './SessionTop.svelte?raw';
import headerSource from './FaceHeader.svelte?raw';
import dockSource from './ActionDock.svelte?raw';
import promptSource from './FacePrompt.svelte?raw';
import workSource from './FaceWork.svelte?raw';
import answerSource from './FaceAnswer.svelte?raw';
import { KIND_TASK_LABELS } from './kinds';

afterEach(cleanup);

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe('StudyFace (#101)', () => {
	it('renders session top, header, card regions and dock in this order', () => {
		render(CardHarness, { card: PrimaryCard, cardProps: { revealed: true }, done: true });
		const order = ['.session-top', '.face-head', '.face-prompt', '.face-work', '.face-answer', '.dock'].map(
			(sel) => document.querySelector(sel)
		);
		order.forEach((el, i) => expect(el, String(i)).not.toBeNull());
		for (let i = 1; i < order.length; i++) {
			expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		}
	});

	it('keeps the session messages above the card', () => {
		const status = createRawSnippet(() => ({ render: () => '<p class="session-message">3 related cards are buried</p>' }));
		render(CardHarness, { card: PrimaryCard, status });
		const message = document.querySelector('.session-message')!;
		const card = document.querySelector('.fc')!;
		expect(message.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('the close button is an IconButton named End session that links to /study, with a tooltip', () => {
		render(CardHarness, { card: PrimaryCard });
		const close = screen.getByRole('link', { name: 'End session' });
		expect(close.getAttribute('href')).toBe('/study');
		expect(close.classList.contains('icon-button')).toBe(true);
		expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('End session');
	});

	it('the progress line is a progressbar with aria-valuenow / valuemax and the count text', () => {
		render(CardHarness, { card: PrimaryCard });
		const bar = screen.getByRole('progressbar', { name: 'Cards done in this session' });
		expect(bar.getAttribute('aria-valuenow')).toBe('0');
		expect(bar.getAttribute('aria-valuemax')).toBe('3');
		expect(document.querySelector('.count')?.textContent).toBe('1 / 3');
	});

	it('announces the count through a polite live region', () => {
		render(CardHarness, { card: PrimaryCard });
		const count = document.querySelector('.count')!;
		expect(count.getAttribute('aria-live')).toBe('polite');
		expect(count.getAttribute('aria-atomic')).toBe('true');
	});

	it('the header shows the kind in the accent, deck · level on the right, and the re-show and tier chips', () => {
		const chips = createRawSnippet(() => ({ render: () => '<span class="chip">Again, look 2 of 3</span>' }));
		render(CardHarness, { card: PrimaryCard, kindLabel: 'Build the sentence', deckLevel: 'HSK · Level 1', chips });
		const head = document.querySelector('.face-head')!;
		expect(head.querySelector('.kind')?.textContent).toBe('Build the sentence');
		expect(head.querySelector('.deck')?.textContent).toBe('HSK · Level 1');
		expect(head.textContent).toContain('Again, look 2 of 3');
		expect(headerSource).toMatch(/\.kind\s*\{[^}]*color:\s*var\(--reading-accent\)/);
		expect(headerSource).toMatch(/\.deck\s*\{[^}]*color:\s*var\(--readable-muted\)/);
	});

	it('a registered primary renders one primary Button in the dock and runs on click', async () => {
		const run = vi.fn();
		render(CardHarness, { card: PrimaryCard, cardProps: { label: 'Check', run } });
		flushSync();
		const dock = document.querySelector('.dock')!;
		const buttons = dock.querySelectorAll('button');
		expect(buttons).toHaveLength(1);
		expect(buttons[0].textContent).toBe('Check');
		expect(buttons[0].classList.contains('primary')).toBe(true);
		await fireEvent.click(buttons[0]);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('a disabled primary is a disabled button', () => {
		render(CardHarness, { card: PrimaryCard, cardProps: { label: 'Check', disabled: true } });
		flushSync();
		expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('no primary and not done: the dock shows only the keys line', () => {
		render(CardHarness, { card: PrimaryCard, cardProps: { register: false } });
		flushSync();
		const dock = document.querySelector('.dock')!;
		expect(dock.querySelectorAll('button')).toHaveLength(0);
		expect(dock.querySelector('.keys')?.textContent).toBe('Keys: test');
	});

	it('useCardFace outside a face throws', () => {
		expect(() => useCardFace()).toThrow();
	});

	it("the face heading has tabindex -1 and the card's accessible name", () => {
		render(CardHarness, { card: PrimaryCard });
		const heading = screen.getByRole('heading', { level: 1 });
		expect(heading.getAttribute('tabindex')).toBe('-1');
		expect(heading.getAttribute('aria-label')).toBe('Recognise card, 1 of 3');
		expect(screen.getByLabelText('Recognise card').tagName).toBe('ARTICLE');
	});

	it('names the six tasks with the design words', () => {
		expect(KIND_TASK_LABELS).toEqual({
			vocab: 'Recognise',
			reverse: 'Recall',
			cloze: 'Fill the gap',
			sentence: 'Build the sentence',
			writing: 'Write',
			tone: 'Tones'
		});
	});

	it('source: no literal colours, the line uses --motion-medium, forced colours handled', () => {
		for (const src of [faceSource, topSource, headerSource, dockSource, promptSource, workSource, answerSource]) {
			expect(src.slice(src.indexOf('<style'))).not.toMatch(LITERAL);
			expect(src).not.toMatch(/text-transform|opacity/);
		}
		expect(topSource).toMatch(/transition:\s*width var\(--motion-medium\)/);
		expect(topSource).toMatch(/@media \(forced-colors: active\)/);
		expect(dockSource).toMatch(/position:\s*sticky/);
		expect(answerSource).toMatch(/var\(--hair\)/);
	});
});
