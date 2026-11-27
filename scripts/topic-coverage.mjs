#!/usr/bin/env node
// The coverage report of the topic labels (#220): per level, the share of a
// level list's words that have a topic (the lookup rule of
// docs/contracts/topics/README.md), on the shipped labels files.
//
//   node scripts/topic-coverage.mjs [--ja-list <levels.json>] [--missing]
//
// Chinese: HSK 1-4 of plugins/data/hsk-words. Japanese: ≈ N5-N3 of
// plugins/data/jlpt-words (#219) or --ja-list. --missing prints the words
// without a topic. Rerun it whenever a list or the labels change.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverage } from './topics-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LEVELS = { zh: ['HSK 1', 'HSK 2', 'HSK 3', 'HSK 4'], ja: ['≈ N5', '≈ N4', '≈ N3'] };
export const LISTS = { zh: join(root, 'plugins/data/hsk-words/levels.json'), ja: join(root, 'plugins/data/jlpt-words/levels.json') };

/** The coverage rows of one language's shipped labels against a levels file, or null when the list is missing. */
export function report(lang, listPath = LISTS[lang]) {
	if (!existsSync(listPath)) return null;
	const file = JSON.parse(readFileSync(join(root, 'server/internal/topics/labels', `${lang}.json`), 'utf8'));
	const levels = JSON.parse(readFileSync(listPath, 'utf8'));
	levels.levels = levels.levels.filter((l) => LEVELS[lang].includes(l.name));
	return coverage(levels, file);
}

function main() {
	const a = process.argv.slice(2);
	const i = a.indexOf('--ja-list');
	const paths = { zh: LISTS.zh, ja: i >= 0 ? a[i + 1] : LISTS.ja };
	for (const lang of ['zh', 'ja']) {
		const rows = report(lang, paths[lang]);
		if (!rows) {
			console.log(`${lang}: no list at ${paths[lang]} (pass --ja-list for Japanese)`);
			continue;
		}
		let words = 0;
		let labelled = 0;
		for (const r of rows) {
			words += r.words;
			labelled += r.labelled;
			console.log(`${lang}\t${r.level}\t${r.labelled}/${r.words}\t${(100 * r.share).toFixed(1)} %`);
			if (a.includes('--missing') && r.missing.length) console.log(`\tmissing: ${r.missing.join(' ')}`);
		}
		console.log(`${lang}\tall\t${labelled}/${words}\t${((100 * labelled) / words).toFixed(1)} %`);
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
