// The restyle rules (#106): weight (type tops out at 600), caps (sentence
// case, no text-transform), border (a border wider than 1px outside focus and
// selected states), shadow (only --shadow-float, none or a hairline inset) and
// control (a raw text-like control in a page file; lib/ui owns the controls).

export interface Finding {
	rule: 'weight' | 'caps' | 'border' | 'shadow' | 'control';
	line: number;
	text: string;
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

function exemptBorder(selector: string): boolean {
	return /:focus-visible|\[aria-selected|\[aria-current|\.selected/.test(selector);
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
			if (/^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(prop) && !exemptBorder(block.selector)) {
				const m = /(\d+(?:\.\d+)?)px/.exec(value);
				if (m && Number(m[1]) > 1) out.push({ rule: 'border', line, text });
			}
			if (prop === 'box-shadow') {
				const ok =
					value === 'none' ||
					value.includes('var(--shadow-float)') ||
					/^inset 0 0 0 1px /.test(value) ||
					/^inset 0 -1px 0 /.test(value) ||
					/^inset 2px 0 0 /.test(value);
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
