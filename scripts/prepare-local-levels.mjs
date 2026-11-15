#!/usr/bin/env node
// Turn a user-prepared TSV into a LOCAL-ONLY level pack (TBCL, curriculum
// tables, any list you may use privately). The result is never bundled: it
// goes under a directory named data-local (gitignored) and gets no LICENSE
// file, because none was granted.
//
// Usage:
//   node scripts/prepare-local-levels.mjs --id tbcl-words --name "TBCL words" \
//     --language zh --unit word --license "NAER, all rights reserved; local use" \
//     --attribution "國家教育研究院 臺灣華語文能力基準, https://coct.naer.edu.tw" \
//     [--version <v>] [--force-dir] <list.tsv> [<local-packs-dir>]
//
// <local-packs-dir> defaults to plugins/data-local and must be a directory
// named data-local unless --force-dir is given (so a typo cannot write into
// plugins/data). Input: UTF-8 TSV, header `level<TAB>form[<TAB>reading]`.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PackError, writePack } from './prepare-level-packs.mjs';

function fail(message) {
	throw new PackError(message);
}

const ZHUYIN = /[㄀-ㄯㆠ-ㆿ]/;

/**
 * parseLevelTsv reads the level TSV. Levels are ordered by first
 * appearance; a repeated form (with the same reading) keeps its first level.
 * A reading with zhuyin is dropped (counted in droppedZhuyin). Any malformed
 * row fails with its line number.
 */
export function parseLevelTsv(text, unit) {
	if (unit !== 'word' && unit !== 'character') fail(`unit must be word or character, not ${JSON.stringify(unit)}`);
	const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r\n|\n|\r/);
	const header = lines[0].split('\t').map((c) => c.trim());
	if (header[0] !== 'level' || header[1] !== 'form' || (header.length > 2 && (header.length !== 3 || header[2] !== 'reading'))) {
		fail(`header must be "level<TAB>form" or "level<TAB>form<TAB>reading", got ${JSON.stringify(lines[0])}`);
	}
	const levels = new Map();
	const seen = new Set();
	let droppedZhuyin = 0;
	for (let i = 1; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim() === '') continue;
		const cells = line.split('\t').map((c) => c.trim());
		if (cells.length < 2 || cells.length > header.length) fail(`line ${i + 1}: expected ${header.length} tab-separated columns, got ${cells.length}`);
		const [level, form, reading = ''] = cells;
		if (level === '') fail(`line ${i + 1}: empty level`);
		if (form === '') fail(`line ${i + 1}: empty form`);
		if (unit === 'character' && [...form].length !== 1) fail(`line ${i + 1}: unit character needs exactly one character, got ${JSON.stringify(form)}`);
		let kept = reading;
		if (ZHUYIN.test(reading)) {
			kept = '';
			droppedZhuyin++;
		}
		const key = `${form}\t${kept}`;
		if (!levels.has(level)) levels.set(level, []);
		if (seen.has(key)) continue;
		seen.add(key);
		levels.get(level).push(kept === '' ? form : { form, reading: kept });
	}
	// A level whose every row was a repeat still exists in order; drop empty ones.
	const result = [...levels].filter(([, entries]) => entries.length > 0).map(([name, entries]) => ({ name, entries }));
	if (result.length === 0) fail('no rows');
	return { levels: result, droppedZhuyin };
}

function parseArgs(argv) {
	const opts = {};
	const positional = [];
	const withValue = ['id', 'name', 'language', 'unit', 'license', 'attribution', 'version'];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--force-dir') opts.forceDir = true;
		else if (a.startsWith('--') && withValue.includes(a.slice(2))) {
			if (i + 1 >= argv.length) fail(`${a} needs a value`);
			opts[a.slice(2)] = argv[++i];
		} else if (a.startsWith('--')) fail(`unknown flag ${a}`);
		else positional.push(a);
	}
	return { opts, positional };
}

const USAGE =
	'usage: node scripts/prepare-local-levels.mjs --id <id> --name <name> --language <ja|zh|…> --unit <word|character> ' +
	'--license <text> --attribution <text> [--version <v>] [--force-dir] <list.tsv> [<local-packs-dir>]';

async function main() {
	const { opts, positional } = parseArgs(process.argv.slice(2));
	for (const required of ['id', 'name', 'language', 'unit', 'license', 'attribution']) {
		if (opts[required] === undefined || opts[required] === '') fail(`--${required} is required\n${USAGE}`);
	}
	if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.id)) fail(`--id must be lowercase letters, digits and hyphens, got ${JSON.stringify(opts.id)}`);
	if (positional.length < 1 || positional.length > 2) fail(USAGE);
	const here = dirname(fileURLToPath(import.meta.url));
	const out = resolve(positional[1] ?? join(here, '..', 'plugins', 'data-local'));
	if (basename(out) !== 'data-local' && !opts.forceDir) {
		fail(`refusing to write into ${out}: local-only packs go in a directory named data-local (pass --force-dir to override)`);
	}

	let buffer;
	try {
		buffer = await readFile(positional[0]);
	} catch (err) {
		fail(`read ${positional[0]}: ${err.code ?? err.message}`);
	}
	const sha = createHash('sha256').update(buffer).digest('hex');
	const { levels, droppedZhuyin } = parseLevelTsv(buffer.toString('utf8'), opts.unit);
	if (droppedZhuyin > 0) {
		console.warn(`prepare-local-levels: warning: dropped ${droppedZhuyin} zhuyin reading(s); pinyin or kana readings are kept`);
	}

	await writePack(join(out, opts.id), {
		manifest: {
			id: opts.id,
			name: opts.name,
			version: opts.version ?? `local-${sha.slice(0, 8)}`,
			type: 'levels',
			language: opts.language,
			license: opts.license,
			attribution: opts.attribution,
			format: 'json'
		},
		unit: opts.unit,
		levels,
		license: undefined,
		attribution: `# ${opts.name}

Generated by scripts/prepare-local-levels.mjs from a list the operator
prepared (not bundled, local use only): this directory is gitignored and has no
LICENSE file because no licence was granted. Do not commit or redistribute it.

- Source terms: ${opts.license}
- Attribution: ${opts.attribution}
- Input SHA-256: ${sha}
`
	});
	const total = levels.reduce((n, l) => n + l.entries.length, 0);
	console.log(`${opts.id}: ${total} entries; ${levels.map((l) => `${l.name} ${l.entries.length}`).join(', ')}`);
	console.log(`written to ${join(out, opts.id)} (not bundled, local use only)`);
}

// Run only as a script: the tests import parseLevelTsv.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		await main();
	} catch (err) {
		if (!(err instanceof PackError)) throw err;
		console.error(`prepare-local-levels: ${err.message}`);
		process.exit(1);
	}
}
