import { afterEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import { englishText, renderPseudo } from '$lib/testing/pseudo';
import { resetCatalogue } from './index';
import PseudoStub from './PseudoStub.test.svelte';
import AppSection from '$lib/pwa/AppSection.svelte';

// The pseudo-locale sample (spec Ruling): each extraction task adds one component of its area to SAMPLES; the
// test renders it in en-XA and fails on any text node that is still plain ASCII English (a missed string, or
// English glued around a translated part). Props should carry non-English data (CJK, digits) so only
// interface text is judged.

afterEach(() => resetCatalogue());

type Sample = { name: string; component: Component<any>; props: Record<string, unknown>; allow?: string[] };
const SAMPLES: Sample[] = [
	// shell (Task 9): jsdom is not a secure context, so the HTTPS note shows
	{ name: 'AppSection', component: AppSection, props: {} }
];

describe('renderPseudo', () => {
	it('finds hard-coded English next to catalogue text', () => {
		const { container } = renderPseudo(PseudoStub, { word: '勤' });
		expect(englishText(container)).toEqual(['Hard coded words']);
		expect(container.textContent).toContain('勤');
	});

	it('ignores aria-hidden subtrees, scripts and styles, and honours an allow list', () => {
		const { container } = renderPseudo(PseudoStub, { word: '勤' });
		expect(englishText(container, ['Hard coded words'])).toEqual([]);
	});
});

describe('pseudo-locale sample', () => {
	it('starts empty; extraction tasks add one component per area', () => {
		expect(Array.isArray(SAMPLES)).toBe(true);
	});
	for (const s of SAMPLES)
		it(`${s.name} shows no plain English`, () => {
			const { container } = renderPseudo(s.component, s.props);
			expect(englishText(container, s.allow)).toEqual([]);
		});
});
