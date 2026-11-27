// The hidden-romanisation guard (#284), used by romanisation.lint.test.ts: a source scan, not an AST analysis.
// A Svelte component whose MARKUP prints a known reading field must ask the one rule (`useRomanisation`, or render
// through `ReadingText` / `ReadingTable`, which ask it). Kept beside the rule so a new reading field is added here.

/** Markup that prints a reading (string literals are stripped first, so message keys never match). */
export const READING_FIELDS: readonly { name: string; pattern: RegExp }[] = [
	{ name: 'a sentence or draft reading (.pinyin)', pattern: /\.pinyin\b/ },
	{ name: 'a reading value (reading.value, readings[n].value)', pattern: /\breadings?(\[\d+\])?\??\.value\b/ },
	{ name: 'a plain reading string (.reading)', pattern: /\.reading\b(?![-\w])/ },
	{ name: 'the trainer romanisation (.roman)', pattern: /\.roman\b/ },
	{ name: 'a reading beside a word (readingBeside)', pattern: /\breadingBeside\(/ },
	{ name: 'the popup reading line (readingLine)', pattern: /\breadingLine\(/ },
	{ name: 'a character-map reading (row.r)', pattern: /\brow\.r\b/ },
	{ name: 'a tone syllable (syllable.plain, .text of a verdict)', pattern: /\bsyllable\.plain\b|\bbest\?\.\[/ },
	{ name: 'a reading drawn with tone colours (<ToneText)', pattern: /<ToneText\b/ },
	{ name: 'a Starter annotation (front.annotation)', pattern: /\bfront\.annotation\b/ },
	{ name: 'ruby text over the reader text (.ruby, .rt)', pattern: /\.ruby\b|\.rt\b/ },
	{ name: 'a trainer prompt (q.prompt)', pattern: /\bq\.prompt\b/ }
];

/** What counts as asking the rule. */
export const HELPERS = /\buseRomanisation\b|<ReadingText\b|<ReadingTable\b/;

/** markupOf: the component without its <script> and <style> blocks, comments and string literals. */
export function markupOf(source: string): string {
	return source
		.replace(/<script[\s\S]*?<\/script>/g, '')
		.replace(/<style[\s\S]*?<\/style>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
		.replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => (m.includes('{') ? m : '""'));
}

/** readingFields: the reading fields a component's markup prints. */
export function readingFields(source: string): string[] {
	const markup = markupOf(source);
	return READING_FIELDS.filter((f) => f.pattern.test(markup)).map((f) => f.name);
}

/** usesHelper: the component asks the rule (in its script or its markup). */
export function usesHelper(source: string): boolean {
	return HELPERS.test(source.replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, ''));
}

export interface GuardFinding {
	path: string;
	problem: string;
}

/**
 * romanisationFindings: every component that prints a reading field is listed (`renderers`, which must ask the rule)
 * or exempt (with its reason); a listed renderer that no longer prints one is stale.
 */
export function romanisationFindings(
	files: readonly { path: string; source: string }[],
	renderers: readonly string[],
	exempt: Readonly<Record<string, string>>
): GuardFinding[] {
	const out: GuardFinding[] = [];
	const seen = new Set<string>();
	for (const { path, source } of files) {
		const fields = readingFields(source);
		if (fields.length === 0) continue;
		seen.add(path);
		if (path in exempt) continue;
		if (!renderers.includes(path)) {
			out.push({ path, problem: `prints ${fields.join(', ')} but is not in RENDERERS: render through useRomanisation() or ReadingText (lib/languages/useRomanisation.ts) and list it` });
		} else if (!usesHelper(source)) {
			out.push({ path, problem: `prints ${fields.join(', ')} without asking the hidden-romanisation rule (useRomanisation, ReadingText or ReadingTable)` });
		}
	}
	for (const path of [...renderers, ...Object.keys(exempt)]) {
		if (!seen.has(path)) out.push({ path, problem: 'listed but prints no reading field any more (or is gone): take it off the list' });
	}
	return out;
}
