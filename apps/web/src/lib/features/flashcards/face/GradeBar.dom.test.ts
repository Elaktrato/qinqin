import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GradeBar from './GradeBar.svelte';
import source from './GradeBar.svelte?raw';

afterEach(cleanup);

const MIN = 60_000;
const DAY = 86_400_000;
// A new card with the default weights (next-intervals.json "a new card").
const NEW_CARD = { 1: MIN, 2: 6 * MIN, 3: 10 * MIN, 4: 8 * DAY };

describe('GradeBar (#101)', () => {
	it('four buttons in grade order named with grade, next review and key', () => {
		render(GradeBar, { intervals: { 1: MIN, 2: 6 * MIN, 3: DAY, 4: 4 * DAY }, suggested: null, busy: false, ongrade: vi.fn() });
		const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
		expect(names).toEqual([
			'Again, next review in 1 minute, key 1',
			'Hard, next review in 6 minutes, key 2',
			'Good, next review in 1 day, key 3',
			'Easy, next review in 4 days, key 4'
		]);
	});

	it('each shows the short interval as visible text', () => {
		render(GradeBar, { intervals: NEW_CARD, suggested: null, busy: false, ongrade: vi.fn() });
		const shown = screen.getAllByRole('button').map((b) => b.querySelector('.when')!.textContent);
		expect(shown).toEqual(['<1m', '6m', '10m', '8d']);
		expect(screen.getAllByRole('button').map((b) => b.querySelector('.name')!.textContent)).toEqual([
			'Again',
			'Hard',
			'Good',
			'Easy'
		]);
	});

	it('the suggested one is named "(suggested)" and carries data-suggested', () => {
		render(GradeBar, { intervals: NEW_CARD, suggested: 3, busy: false, ongrade: vi.fn() });
		const good = screen.getByRole('button', { name: 'Good (suggested), next review in 10 minutes, key 3' });
		expect(good.hasAttribute('data-suggested')).toBe(true);
		expect(document.querySelectorAll('[data-suggested]')).toHaveLength(1);
	});

	it('practice: names say practice only and the interval text is "practice"', () => {
		render(GradeBar, { intervals: null, suggested: 1, busy: false, ongrade: vi.fn() });
		const buttons = screen.getAllByRole('button');
		expect(buttons[1].getAttribute('aria-label')).toBe('Hard, practice only, key 2');
		expect(buttons[0].getAttribute('aria-label')).toBe('Again (suggested), practice only, key 1');
		expect(buttons.map((b) => b.querySelector('.when')!.textContent)).toEqual(Array(4).fill('practice'));
	});

	it('busy disables all four with aria-busy on the group', () => {
		render(GradeBar, { intervals: NEW_CARD, suggested: null, busy: true, ongrade: vi.fn() });
		expect(screen.getAllByRole('button').every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
		expect(screen.getByRole('group').getAttribute('aria-busy')).toBe('true');
	});

	it('detail 0 click reports activation, a pointer click reports click', async () => {
		const ongrade = vi.fn();
		render(GradeBar, { intervals: NEW_CARD, suggested: null, busy: false, ongrade });
		const good = screen.getAllByRole('button')[2];
		await fireEvent.click(good, { detail: 0 });
		await fireEvent.click(good, { detail: 1 });
		expect(ongrade.mock.calls).toEqual([
			[3, 'activation'],
			[3, 'click']
		]);
	});

	it('role group named Grade this card', () => {
		render(GradeBar, { intervals: NEW_CARD, suggested: null, busy: false, ongrade: vi.fn() });
		expect(screen.getByRole('group', { name: 'Grade this card' })).toBeTruthy();
	});

	it('source: grade text in --readable-grade-*, lines in --grade-*, no title, forced colours', () => {
		const style = source.slice(source.indexOf('<style'));
		for (const g of ['again', 'hard', 'good', 'easy']) {
			expect(style).toContain(`var(--readable-grade-${g})`);
			expect(style).toContain(`var(--grade-${g})`);
		}
		expect(style).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|opacity|text-transform/);
		expect(source).not.toMatch(/\btitle=/);
		expect(style).toMatch(/@media \(forced-colors: active\)[\s\S]*ButtonText[\s\S]*Highlight/);
		expect(style).toMatch(/tabular-nums/);
	});

	it('Back (#131): the previous grade is pressed and says "your grade"', () => {
		render(GradeBar, { intervals: NEW_CARD, suggested: 3, chosen: 1, busy: false, ongrade: vi.fn() });
		const buttons = screen.getAllByRole('button');
		expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
		expect(buttons[0].textContent).toContain('your grade');
		expect(buttons[1].textContent).not.toContain('your grade');
	});

	it('without a previous grade the buttons are not toggles', () => {
		render(GradeBar, { intervals: NEW_CARD, suggested: null, busy: false, ongrade: vi.fn() });
		expect(screen.getAllByRole('button').every((b) => !b.hasAttribute('aria-pressed'))).toBe(true);
	});
});
