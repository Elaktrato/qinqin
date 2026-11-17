#!/usr/bin/env node
// Build the stroke-order data pack `hanzi-writer-strokes` (type strokes,
// format hanzi-writer-jsonl-gz) from the hanzi-writer-data npm package:
//
//   node scripts/prepare-strokes-pack.mjs --out <dir> [--source <dir>]
//
// --source defaults to apps/web/node_modules/hanzi-writer-data (the version
// pinned by apps/web/package-lock.json; run `npm --prefix apps/web ci`
// first). The pack holds:
//
//   manifest.json      id, type, format, languages ["zh","ja"], the npm
//                      package version, licence and attribution
//   strokes.jsonl.gz   one line per character, sorted by code point:
//                      {"char":"好","data":<the npm file's JSON, verbatim>}
//   LICENSE            the package's ARPHICPL.TXT, which must be byte-equal
//                      to apps/web/static/ARPHICPL.TXT (the licence text the
//                      app links to); the script refuses otherwise
//   ATTRIBUTION.md     where the data comes from
//
// The data is the Make Me a Hanzi dataset as hanzi-writer-data publishes it,
// licensed under the Arphic Public License and used unmodified. The pack is
// built at image build time (Dockerfile) or locally into the gitignored
// plugins/data-strokes/; it is never committed.
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_ID = 'hanzi-writer-strokes';
export const FORMAT = 'hanzi-writer-jsonl-gz';
const NAME = 'Hanzi Writer stroke data';
const LICENSE = 'Arphic Public License';
const ATTRIBUTION = 'Make Me a Hanzi (Shaunak Kishore) via hanzi-writer-data (David Chanin)';
const NOTICE =
	'Stroke-order animations use hanzi-writer-data, derived from the [Make Me a Hanzi](https://github.com/skishore/makemeahanzi) dataset. That data is licensed under the Arphic Public License and is used unmodified.';

const defaultSource = fileURLToPath(new URL('../apps/web/node_modules/hanzi-writer-data', import.meta.url));
const appLicense = fileURLToPath(new URL('../apps/web/static/ARPHICPL.TXT', import.meta.url));

function usage(msg) {
	if (msg) console.error(msg);
	console.error('usage: node scripts/prepare-strokes-pack.mjs --out <dir> [--source <hanzi-writer-data dir>]');
	process.exit(2);
}

function fail(msg) {
	console.error(`prepare-strokes-pack: ${msg}`);
	process.exit(1);
}

function parseArgs(argv) {
	const opts = { source: defaultSource, out: '' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--out' || a === '--source') {
			const v = argv[++i];
			if (!v) usage(`${a} needs a value`);
			opts[a.slice(2)] = v;
		} else {
			usage(`unknown argument ${a}`);
		}
	}
	if (!opts.out) usage('--out is required');
	return opts;
}

/** readStrokes returns [char, data] pairs sorted by code point. */
function readStrokes(source) {
	const rows = [];
	for (const name of readdirSync(source)) {
		if (!name.endsWith('.json') || name === 'package.json') continue;
		const chars = [...name.slice(0, -'.json'.length)];
		if (chars.length !== 1) fail(`${name}: the file name is not one character`);
		const data = readFileSync(join(source, name), 'utf8');
		let parsed;
		try {
			parsed = JSON.parse(data);
		} catch (err) {
			fail(`${name}: not JSON (${err.message})`);
		}
		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail(`${name}: not a JSON object`);
		if (data !== data.trim() || data.includes('\n')) fail(`${name}: the file has surrounding whitespace or a line break`);
		rows.push([chars[0], data]);
	}
	if (rows.length === 0) fail(`no stroke files found in ${source}`);
	rows.sort((a, b) => a[0].codePointAt(0) - b[0].codePointAt(0));
	return rows;
}

function main() {
	const { source, out } = parseArgs(process.argv.slice(2));
	const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
	if (typeof pkg.version !== 'string' || pkg.version === '') fail(`${source}/package.json has no version`);
	const license = readFileSync(join(source, 'ARPHICPL.TXT'));
	if (!license.equals(readFileSync(appLicense))) {
		fail(`${source}/ARPHICPL.TXT differs from apps/web/static/ARPHICPL.TXT; check the licence before building`);
	}
	const rows = readStrokes(source);
	const jsonl = rows.map(([c, data]) => `{"char":${JSON.stringify(c)},"data":${data}}\n`).join('');

	const manifest = {
		id: PACK_ID,
		name: NAME,
		version: pkg.version,
		type: 'strokes',
		languages: ['zh', 'ja'],
		license: LICENSE,
		attribution: ATTRIBUTION,
		notice: NOTICE,
		format: FORMAT
	};
	const attribution = [
		`# ${NAME}`,
		'',
		`Stroke-order data for ${rows.length} characters from the npm package`,
		`[hanzi-writer-data](https://www.npmjs.com/package/hanzi-writer-data) ${pkg.version}`,
		'(David Chanin), derived from the [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)',
		'dataset (Shaunak Kishore).',
		'',
		`Licence: ${LICENSE} (the full text is in LICENSE). The data is used unmodified;`,
		'each line of strokes.jsonl.gz holds one character file of the package verbatim.',
		''
	].join('\n');

	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, '\t') + '\n');
	writeFileSync(join(out, 'strokes.jsonl.gz'), gzipSync(Buffer.from(jsonl, 'utf8'), { level: 9 }));
	writeFileSync(join(out, 'LICENSE'), license);
	writeFileSync(join(out, 'ATTRIBUTION.md'), attribution);
	console.log(`strokes pack: ${rows.length} characters written to ${out}`);
}

main();
