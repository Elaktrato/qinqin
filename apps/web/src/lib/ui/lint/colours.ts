// The colour lint (#98, PART B): components paint with the theme tokens only (design §6), so a forced Light or
// Dark appearance works on every page. A finding is a literal colour in a style — `#rgb`, `#rgba`, `#rrggbb`,
// `#rrggbbaa`, a colour function (`rgb(` … `color(`), a named colour (`white`, `red`, …), a CSS system colour
// outside an `@media (forced-colors: active)` block — or `prefers-color-scheme` anywhere (it follows the OS, not
// the painted theme). Scanned: a `.css` file whole; in a `.svelte` file the `<style>` contents, `style=` and
// `style:` attribute values, and the colour presentation attributes (`fill`, `stroke`, `stop-color`, …) of the
// markup. Comments are stripped, a selector (`#id`) and `url(#ref)` are not colours, the script is not scanned.
// The walk over src/ (exemptions, allowlist, the pending baseline) is colourWalk.test.ts.

export interface Finding {
	line: number;
	text: string;
}

export type StyleKind = 'svelte' | 'css';

/** The CSS named colours (CSS Color 4), lower case; `transparent` and `currentcolor` are not literals. */
const NAMED = new Set(
	(
		'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood ' +
		'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray ' +
		'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
		'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue ' +
		'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew ' +
		'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
		'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray ' +
		'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue ' +
		'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred ' +
		'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
		'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple ' +
		'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue ' +
		'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white ' +
		'whitesmoke yellow yellowgreen'
	).split(' ')
);

/** The CSS system colours: they follow `color-scheme`, not the theme, so only forced-colours blocks may use them. */
const SYSTEM = new Set(
	(
		'canvas canvastext linktext visitedtext activetext buttonface buttontext buttonborder field fieldtext highlight ' +
		'highlighttext selecteditem selecteditemtext mark marktext graytext accentcolor accentcolortext'
	).split(' ')
);

const blank = (s: string): string => s.replace(/[^\n]/g, ' ');

/** An expression's string-literal contents only (everything else blanked, same length). */
function keepStrings(expr: string): string {
	let out = '';
	let quote = '';
	for (const c of expr) {
		if (quote) {
			if (c === quote) {
				quote = '';
				out += ' ';
			} else out += c;
		} else if (c === "'" || c === '"' || c === '`') {
			quote = c;
			out += ' ';
		} else out += c === '\n' ? '\n' : ' ';
	}
	return out;
}

/** A quoted attribute value with its `{…}` interpolations reduced to their strings. */
const maskInterpolations = (value: string): string => value.replace(/\{[^}]*\}/g, keepStrings);

interface Hit {
	at: number;
	text: string;
}

function scanValue(value: string, at: number, forced: boolean, hits: Hit[]): void {
	const v = value.replace(/url\([^)]*\)/gi, blank);
	for (const m of v.matchAll(/(?<![\w-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g))
		hits.push({ at: at + m.index, text: m[0] });
	for (const m of v.matchAll(/(?<![\w-])(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/gi))
		hits.push({ at: at + m.index, text: m[0] });
	for (const m of v.matchAll(/(?<![\w-])[a-zA-Z]+(?![\w(-])/g)) {
		const word = m[0].toLowerCase();
		if (NAMED.has(word) || (!forced && SYSTEM.has(word))) hits.push({ at: at + m.index, text: m[0] });
	}
}

/** A stylesheet (or a declaration list): values of declarations, tracking forced-colours blocks. */
function scanCss(css: string, at: number, hits: Hit[]): void {
	const text = css.replace(/\/\*[\s\S]*?\*\//g, blank);
	for (const m of text.matchAll(/prefers-color-scheme/g)) hits.push({ at: at + m.index, text: m[0] });
	const forced: boolean[] = [];
	let start = 0;
	const declaration = (end: number) => {
		const seg = text.slice(start, end);
		const colon = seg.indexOf(':');
		if (colon >= 0) scanValue(seg.slice(colon + 1), at + start + colon + 1, forced.at(-1) ?? false, hits);
	};
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '{') {
			const prelude = text.slice(start, i);
			forced.push((forced.at(-1) ?? false) || /forced-colors\s*:\s*active/.test(prelude));
			start = i + 1;
		} else if (c === ';' || c === '}') {
			declaration(i);
			if (c === '}') forced.pop();
			start = i + 1;
		}
	}
	declaration(text.length);
}

const ATTR_VALUE = String.raw`=("[^"]*"|'[^']*'|\{[^}]*\})`;

/** The value of an attribute match (quotes or braces removed) and its offset, interpolations reduced to strings. */
function attrValue(raw: string, at: number): { value: string; at: number } {
	const inner = raw.slice(1, -1);
	return {
		value: raw.startsWith('{') ? keepStrings(inner) : maskInterpolations(inner),
		at: at + 1
	};
}

function svelteHits(src: string): Hit[] {
	const hits: Hit[] = [];
	for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
		scanCss(m[1], m.index + m[0].indexOf('>') + 1, hits);
	const markup = src
		.replace(/<script[^>]*>[\s\S]*?<\/script>/g, blank)
		.replace(/<style[^>]*>[\s\S]*?<\/style>/g, blank)
		.replace(/<!--[\s\S]*?-->/g, blank);
	for (const m of markup.matchAll(new RegExp(String.raw`\sstyle` + ATTR_VALUE, 'g'))) {
		const v = attrValue(m[1], m.index + m[0].indexOf('=') + 1);
		scanCss(v.value, v.at, hits);
	}
	for (const m of markup.matchAll(new RegExp(String.raw`\sstyle:[\w-]+(?:\|important)?` + ATTR_VALUE, 'g'))) {
		const v = attrValue(m[1], m.index + m[0].indexOf('=') + 1);
		scanValue(v.value, v.at, false, hits);
	}
	for (const m of markup.matchAll(
		new RegExp(String.raw`\s(?:fill|stroke|stop-color|flood-color|lighting-color|color)` + ATTR_VALUE, 'g')
	)) {
		const v = attrValue(m[1], m.index + m[0].indexOf('=') + 1);
		scanValue(v.value, v.at, false, hits);
	}
	return hits;
}

/** The 1-based line of an offset. */
export function lineAt(src: string, at: number): number {
	let line = 1;
	for (let i = 0; i < at; i++) if (src.charCodeAt(i) === 10) line++;
	return line;
}

/** Every colour finding of a source, in source order. */
export function colourFindings(src: string, kind: StyleKind): Finding[] {
	const hits: Hit[] = [];
	if (kind === 'css') scanCss(src, 0, hits);
	else hits.push(...svelteHits(src));
	return hits.sort((a, b) => a.at - b.at).map((h) => ({ line: lineAt(src, h.at), text: h.text }));
}
