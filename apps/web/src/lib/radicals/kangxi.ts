// The 214 Kangxi radicals: number, unified character, classical stroke
// count and the forms a learner sees. The data is a byte-identical copy of
// docs/contracts/radicals/kangxi.json (the web build cannot reach docs/;
// kangxi.test.ts keeps the two equal). Pure.
import table from './kangxi.json';

interface Row {
	n: number;
	c: string;
	s: number;
	forms: { all: string[]; zh: string[]; ja: string[] };
}

const rows = table.rows as Row[];
const byN = new Map(rows.map((r) => [r.n, r]));
const numbers = new Map<string, number>();
for (const r of rows) numbers.set(r.c, r.n);
// A form maps to the lowest number listing it, unless it is a radical's
// own character (月 is 74 though 130 lists it).
for (const r of rows) {
	for (const f of [...r.forms.all, ...r.forms.zh, ...r.forms.ja]) {
		if (!numbers.has(f)) numbers.set(f, r.n);
	}
}

export interface RadicalTile {
	n: number;
	c: string;
	/** forms.all followed by the language's own forms */
	forms: string[];
}

export interface RadicalGroup {
	/** classical radical stroke count, 1–17 */
	s: number;
	radicals: RadicalTile[];
}

/** primaryLanguage is the primary subtag: `zh-TW` -> `zh`. */
export function primaryLanguage(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/** radicalTable is the table in 17 stroke groups with the language's forms. */
export function radicalTable(language: string): RadicalGroup[] {
	const lang = primaryLanguage(language);
	const groups: RadicalGroup[] = [];
	for (const r of rows) {
		const own = lang === 'zh' ? r.forms.zh : lang === 'ja' ? r.forms.ja : [];
		const tile = { n: r.n, c: r.c, forms: [...r.forms.all, ...own] };
		const last = groups.at(-1);
		if (last && last.s === r.s) last.radicals.push(tile);
		else groups.push({ s: r.s, radicals: [tile] });
	}
	return groups;
}

/** radicalNumber maps a radical's character or any of its forms to its number; 0 when none. */
export function radicalNumber(char: string): number {
	return numbers.get(char) ?? 0;
}

/** radicalStrokes is the classical stroke count of radical n; 0 when n is not a radical. */
export function radicalStrokes(n: number): number {
	return byN.get(n)?.s ?? 0;
}

/** radicalChar is the unified character of radical n; '' when n is not a radical. */
export function radicalChar(n: number): string {
	return byN.get(n)?.c ?? '';
}

/** isRadical reports whether n is a Kangxi radical number (1–214). */
export function isRadical(n: number): boolean {
	return byN.has(n);
}
