import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import Stat from './Stat.svelte';
import LayoutHarness from './testing/LayoutHarness.svelte';
import chipSource from './Chip.svelte?raw';
import statSource from './Stat.svelte?raw';
import sectionSource from './Section.svelte?raw';
import panelSource from './Panel.svelte?raw';

const css = (s: string) => s.slice(s.indexOf('<style>'));

describe('Section and Panel', () => {
	it('a Section is a region headed by its title at the given level, unboxed', () => {
		render(LayoutHarness);
		const meanings = screen.getByRole('region', { name: 'Meanings' });
		expect(meanings.tagName).toBe('SECTION');
		expect(screen.getByRole('heading', { level: 2, name: 'Meanings' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 3, name: 'Characters' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Characters' }).querySelector('button')!.textContent).toBe('Edit');
		expect(css(sectionSource)).not.toMatch(/background|box-shadow/);
		expect(css(sectionSource)).toMatch(/:global\(\.qq-section \+ \.qq-section\) \{\s*border-top: 1px solid var\(--hair\)/);
		// The line sits between instances: every Section carries the global class.
		expect(meanings.className).toContain('qq-section');
	});

	it('a Panel is the one box: a surface with the large radius, attributes passed through', () => {
		render(LayoutHarness);
		const panel = screen.getByTestId('panel');
		expect(panel.className).toContain('panel');
		expect(css(panelSource)).toMatch(/background: var\(--panel\)/);
		expect(css(panelSource)).toMatch(/border-radius: var\(--radius-large\)/);
	});
});

describe('Chip', () => {
	it('says its meaning in text; the good tone adds a dot (a shape), never colour alone', () => {
		render(LayoutHarness);
		const good = screen.getByText('In 2 decks').closest('.chip')!;
		expect(good.querySelector('.dot')!.getAttribute('aria-hidden')).toBe('true');
		expect(screen.getByText('HSK 1').closest('.chip')!.querySelector('.dot')).toBeNull();
		expect(css(chipSource)).not.toMatch(/border:/);
		expect(css(chipSource)).toMatch(/background: var\(--raised\)/);
		expect(css(chipSource)).toMatch(/color: var\(--reading-accent\)/);
		expect(css(chipSource)).toMatch(/var\(--font-size-label\)/);
	});
});

describe('Stat', () => {
	it('reads label then value; the change has its words and an arrow shape', () => {
		render(Stat, { value: '1,204', label: 'Words known', change: { text: '+38 since last week', direction: 'up' } });
		const stat = screen.getByText('1,204').closest('.stat')!;
		expect(stat.textContent!.replace(/\s+/g, ' ').trim()).toBe('Words known 1,204 +38 since last week');
		const change = screen.getByText('+38 since last week').closest('.change')!;
		expect(change.className).toContain('up');
		expect(change.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
	});

	it('has no arrow when nothing changed', () => {
		render(Stat, { value: '12', label: 'Streak', change: { text: 'Same as last week', direction: 'same' } });
		expect(screen.getByText('Same as last week').closest('.change')!.querySelector('svg')).toBeNull();
	});

	it('big light number, small muted label', () => {
		const c = css(statSource);
		expect(c).toMatch(/font-size: var\(--font-size-xxl\)/);
		expect(c).toMatch(/font-weight: var\(--weight-regular\)/);
		expect(c).toMatch(/letter-spacing: var\(--tracking-tight\)/);
		expect(c).toMatch(/color: var\(--readable-muted\)/);
		expect(c).toMatch(/var\(--good\)/);
		expect(c).toMatch(/var\(--grade-hard\)/);
	});
});
