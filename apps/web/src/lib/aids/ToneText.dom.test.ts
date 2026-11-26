import { testContext, updateWorkspaces, type TestContext } from '$lib/testing/context';
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Workspace } from '$lib/api/types';

import ToneText from './ToneText.svelte';

function open(props: { value: string; type?: string; force?: boolean }, settings: Record<string, unknown> = {}) {
	const ctx: TestContext = testContext();
	const ws: Workspace = { id: 4, language: 'zh', name: '', settings, updatedAt: 't' };
	updateWorkspaces(ctx.session.workspaces, () => ({ list: [ws], current: ws }));
	return render(ToneText, { props, context: ctx.context });
}

afterEach(cleanup);

describe('ToneText (#212)', () => {
	it('draws each pinyin syllable with its tone, a colour property and a contour that is not a colour', () => {
		const { container } = open({ value: 'nǐ hǎo mā' });
		const syllables = [...container.querySelectorAll<HTMLElement>('.syl')];
		expect(syllables.map((s) => [s.textContent, s.dataset.tone])).toEqual([
			['nǐ', '3'],
			['hǎo', '3'],
			['mā', '1']
		]);
		expect(syllables[0].style.color).toBe('var(--tone-3)');
		expect(syllables[0].title).toBe('Third tone: falling, then rising');
		for (const s of syllables) {
			const svg = s.querySelector('svg');
			expect(svg?.getAttribute('aria-hidden')).toBe('true');
			expect(svg?.querySelector('path')?.getAttribute('d')).toBeTruthy();
		}
		expect(container.querySelector('.tones')?.getAttribute('style')).toMatch(/--tone-1: #[0-9a-f]{6}; --tone-2:/);
	});

	it('reads as the plain text to a screen reader (the contours add no text)', () => {
		const { container } = open({ value: 'nǐ hǎo' });
		expect(container.textContent).toBe('nǐ hǎo');
	});

	it('is the plain text when the aid is off', () => {
		const { container } = open({ value: 'nǐ hǎo' }, { visualAids: { toneColors: false, toneContour: false } });
		expect(container.querySelector('.syl')).toBeNull();
		expect(container.textContent).toBe('nǐ hǎo');
	});

	it('colours and contour are independent switches', () => {
		const colourOnly = open({ value: 'nǐ hǎo' }, { visualAids: { toneContour: false } }).container;
		expect(colourOnly.querySelectorAll('.syl')).toHaveLength(2);
		expect(colourOnly.querySelector('.contour')).toBeNull();
		expect((colourOnly.querySelector('.syl') as HTMLElement).style.color).toBe('var(--tone-3)');
		cleanup();
		const contourOnly = open({ value: 'nǐ hǎo' }, { visualAids: { toneColors: false, toneContour: true } }).container;
		expect(contourOnly.querySelectorAll('.contour')).toHaveLength(2);
		expect((contourOnly.querySelector('.syl') as HTMLElement).style.color).toBe('');
		expect(contourOnly.textContent).toBe('nǐ hǎo');
	});

	it('is the plain text for a reading that is not pinyin', () => {
		const { container } = open({ value: 'ねこ', type: 'kana' });
		expect(container.querySelector('.syl')).toBeNull();
		expect(container.textContent).toBe('ねこ');
	});

	it('force draws the colours although the switch is off (the preview)', () => {
		const { container } = open({ value: 'mā', force: true }, { visualAids: { toneColors: false, toneContour: false } });
		expect(container.querySelectorAll('.syl')).toHaveLength(1);
	});

	it('draws nothing special outside an app context', () => {
		const { container } = render(ToneText, { props: { value: 'nǐ' } });
		expect(container.querySelector('.syl')).toBeNull();
		expect(container.textContent).toBe('nǐ');
	});
});
