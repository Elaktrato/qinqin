// The restyle rules (#106): weight (type tops out at 600), caps (sentence
// case, no text-transform), border (a border wider than 1px outside focus and
// selected states), shadow (only --shadow-float, none or a hairline inset) and
// control (a raw text-like control in a page file; lib/ui owns the controls).

export type RestyleRule = 'weight' | 'caps' | 'border' | 'shadow' | 'control';

export interface Finding {
	rule: RestyleRule;
	line: number;
	text: string;
}

/**
 * stalePending: the files still in a ratchet list that no longer have a finding. The walk fails on a non-empty
 * answer ("clean now: remove it"), so a list may only shrink and only while its files are dirty.
 */
export function stalePending(list: readonly string[], offenders: readonly string[]): string[] {
	return list.filter((rel) => !offenders.includes(rel));
}

const linesOf = (src: string): string[] => src.split('\n');

/** styleBlocks: the CSS a Svelte file scopes, or the whole .css file. */
function styleBlocks(src: string, kind: 'svelte' | 'css'): string {
	if (kind === 'css') return src;
	const out: string[] = [];
	const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
	for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1]);
	return out.join('\n');
}

function ruleBlocks(style: string): { selector: string; body: string; start: number }[] {
	const out: { selector: string; body: string; start: number }[] = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	for (let m = re.exec(style); m; m = re.exec(style)) {
		out.push({ selector: m[1].trim(), body: m[2], start: style.slice(0, m.index).split('\n').length });
	}
	return out;
}

function exemptBorder(selector: string, prop: string, value: string): boolean {
	if (/:focus-visible|\[aria-selected|\[aria-current|\.selected/.test(selector)) return true;
	// Forced colours replace a state fill with a 2px system-colour border (design §5, Accessibility).
	if (/Highlight|CanvasText|ButtonText/.test(value)) return true;
	// The 3px inline-start bar is the non-colour cue of an error or a caution (design §5: never colour alone);
	// it is not a box around a group. Field.svelte carries the error bar.
	if (prop === 'border-inline-start' && /^3px solid var\(--(bad|warn)\)$/.test(value)) return true;
	return false;
}

export function restyleFindings(src: string, kind: 'svelte' | 'css'): Finding[] {
	const style = styleBlocks(src, kind);
	const allLines = linesOf(src);
	const out: Finding[] = [];
	for (const block of ruleBlocks(style)) {
		for (const decl of block.body.split(';')) {
			const [propRaw, ...rest] = decl.split(':');
			const prop = propRaw.trim().toLowerCase();
			const value = rest.join(':').trim();
			if (!prop || !value) continue;
			const line = block.start;
			const text = `${prop}: ${value}`;
			if (prop === 'font-weight') {
				const n = Number(value);
				if (value === 'bold' || value === 'bolder' || (Number.isFinite(n) && n > 600))
					out.push({ rule: 'weight', line, text: value });
			}
			if (prop === 'text-transform' && /uppercase|capitalize/.test(value))
				out.push({ rule: 'caps', line, text });
			if (prop === 'font-variant' && /small-caps/.test(value)) out.push({ rule: 'caps', line, text });
			if (
				/^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(prop) &&
				!exemptBorder(block.selector, prop, value)
			) {
				const m = /(\d+(?:\.\d+)?)px/.exec(value);
				if (m && Number(m[1]) > 1) out.push({ rule: 'border', line, text });
			}
			if (prop === 'box-shadow') {
				const ok =
					value === 'none' ||
					value.includes('var(--shadow-float)') ||
					/^inset 0 0 0 1px /.test(value) ||
					/^inset 0 -1px 0 /.test(value) ||
					/^inset 2px 0 0 /.test(value) ||
					// A vertical 1px hairline between regions (EntryView's column rule).
					/^inset 1px 0 0 /.test(value) ||
					// A tab's selected underline drawn as an inset shadow (Search, Stats characters).
					/^inset 0 -1\.5px 0 /.test(value) ||
					/^inset 0 -2px 0 /.test(value) ||
					// Field's focus underline: the 1px border plus this 1px accent line (bases, #106).
					value === '0 1px 0 0 var(--accent)';
				if (!ok) out.push({ rule: 'shadow', line, text });
			}
		}
	}
	// control: a page's own text-like control (lib/ui/** is exempt by the caller).
	for (let i = 0; i < allLines.length; i++) {
		const line = allLines[i];
		const m = /<(button|select|input)\b([^>]*)>/.exec(line);
		if (!m) continue;
		if (m[1] === 'input' && /type="(checkbox|radio|file|range|color)"/.test(m[2])) continue;
		if (m[1] === 'input' && /autocomplete="one-time-code"/.test(m[2])) continue;
		out.push({ rule: 'control', line: i + 1, text: line.trim().slice(0, 80) });
	}
	return out;
}
