// Pseudo-locale rendering for DOM tests (spec Ruling, src/lib/i18n/pseudo.dom.test.ts): render a component with
// the en-XA catalogue installed and list the interface text that is still plain ASCII English. Call
// `resetCatalogue()` from `$lib/i18n` in afterEach.
import { render } from '@testing-library/svelte';
import { testContext } from './context';
import type { Component } from 'svelte';
import { installCatalogue } from '$lib/i18n';
import en from '$lib/i18n/messages/en.json';
import { pseudoCatalogue } from '$lib/i18n/pseudo';

const ENGLISH = /[A-Za-z]{2,}/;
const TEXT_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'];

/** Installs en-XA (format locale `en`) and renders the component (in a fresh signed-in test context). */
export function renderPseudo(component: Component<any>, props: Record<string, unknown> = {}) {
	installCatalogue('en-XA', pseudoCatalogue(en), 'en');
	return render(component, { props, context: testContext().context });
}

function hidden(el: Element | null): boolean {
	for (let e = el; e !== null; e = e.parentElement) {
		if (e.getAttribute('aria-hidden') === 'true') return true;
		if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE') return true;
	}
	return false;
}

/** Text nodes and text attributes under `root` with two or more ASCII letters in a row, minus `allow`. */
export function englishText(root: Element, allow: readonly string[] = []): string[] {
	const out: string[] = [];
	const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
	for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
		const text = (n.textContent ?? '').trim();
		if (ENGLISH.test(text) && !hidden(n.parentElement) && !allow.includes(text)) out.push(text);
	}
	for (const el of root.querySelectorAll('*')) {
		if (hidden(el)) continue;
		for (const a of TEXT_ATTRIBUTES) {
			const v = el.getAttribute(a)?.trim();
			if (v && ENGLISH.test(v) && !allow.includes(v)) out.push(v);
		}
	}
	return out;
}
