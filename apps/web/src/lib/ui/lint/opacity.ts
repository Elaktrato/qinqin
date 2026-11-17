// The opacity lint (#98 PART B, Task B3): secondary text is `--readable-muted`, never faded with `opacity` (design
// §5) — a fade drops below 4.5:1 on the dark themes. A finding is a style rule that sets `opacity` above 0 and below
// 1, named by its selector. Exempt: disabled states (`:disabled`, `[disabled]`, `[aria-disabled='true']`, which WCAG
// exempts), transition and animation states (`@keyframes`, `.enter`, `.leave`, `[data-state]`). A non-text graphic
// that may fade is an allowlist entry with a reason. Scanned: a `.css` file whole, a `.svelte` file's `<style>`.
// The same fade through the colour is a finding too: `color:` with a `color-mix(…)` of `transparent` that leaves
// the colour below 100%.
import { lineAt, type Finding, type StyleKind } from './colours';

const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

const EXEMPT = /:disabled|\[disabled\]|\[aria-disabled=['"]?true|\.enter\b|\.leave\b|\[data-state/;

function faded(value: string): boolean {
	const m = /^\s*(\d*\.?\d+)(%?)\s*(?:!important)?\s*$/.exec(value);
	if (!m) return false;
	const v = Number(m[1]) / (m[2] ? 100 : 1);
	return v > 0 && v < 1;
}

/** The share of the visible colour in a `color-mix(in …, a [p%], b [q%])` with `transparent`, else null. */
function mixedShare(value: string): number | null {
	const m = /color-mix\(\s*in\s+[a-z-]+\s*,([\s\S]*)\)/i.exec(value);
	if (!m) return null;
	// The two stops: split at the top-level comma.
	let depth = 0;
	let cut = -1;
	for (let i = 0; i < m[1].length; i++) {
		const c = m[1][i];
		if (c === '(') depth++;
		else if (c === ')') depth--;
		else if (c === ',' && depth === 0) cut = i;
	}
	if (cut < 0) return null;
	const stops = [m[1].slice(0, cut), m[1].slice(cut + 1)].map((stop) => {
		const p = /(\d*\.?\d+)%\s*$/.exec(stop.trim());
		return { transparent: /^\s*transparent\b/i.test(stop), pct: p ? Number(p[1]) : null };
	});
	const seen = stops.findIndex((x) => !x.transparent);
	if (seen < 0 || !stops.some((x) => x.transparent)) return null;
	const own = stops[seen].pct;
	const other = stops[1 - seen].pct;
	return own ?? (other !== null ? 100 - other : 50);
}

function scan(css: string, at: number, src: string, out: Finding[]): void {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, blank);
	const preludes: string[] = [];
	let start = 0;
	let rule = -1; // the offset of the current rule's body
	let reportedRule = -2;
	const declaration = (end: number) => {
		const seg = text.slice(start, end);
		const m = /^\s*opacity\s*:([\s\S]*)$/.exec(seg);
		const c = /^\s*color\s*:([\s\S]*)$/.exec(seg);
		const share = c ? mixedShare(c[1]) : null;
		const fades = (m && faded(m[1])) || (share !== null && share < 100);
		if (!fades || reportedRule === rule) return;
		if (preludes.some((p) => /^@(-webkit-)?keyframes\b/.test(p))) return;
		const parts = (preludes.at(-1) ?? '').split(',').map((s) => s.trim());
		if (parts.every((p) => EXEMPT.test(p))) return;
		reportedRule = rule;
		out.push({ line: lineAt(src, at + start + seg.search(/\S/)), text: parts.join(', ') });
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '{') {
			preludes.push(text.slice(start, i).trim().replace(/\s+/g, ' '));
			start = rule = i + 1;
		} else if (c === ';' || c === '}') {
			declaration(i);
			if (c === '}') preludes.pop();
			start = i + 1;
		}
	}
}

/** Every rule that fades with opacity, in source order. */
export function opacityFindings(src: string, kind: StyleKind): Finding[] {
	const out: Finding[] = [];
	if (kind === 'css') scan(src, 0, src, out);
	else
		for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
			scan(m[1], m.index + m[0].indexOf('>') + 1, src, out);
	return out;
}
