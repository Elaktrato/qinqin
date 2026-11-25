#!/usr/bin/env node
// Build an images pack (type images, format images-svg, #216) from the pinned
// upstream release and the committed mapping:
//
//   node scripts/prepare-images-pack.mjs --pack openmoji|mulberry --out <dir> [--cache <dir>]
//
// It downloads the pinned zip and metadata of scripts/images/pins.json (every
// file checked by SHA-256), keeps only the pictures scripts/images/<pack>/map.tsv
// uses, and writes manifest.json, LICENSE, ATTRIBUTION.md, map.tsv,
// pictures.tsv and pictures/<concept>.svg to --out. Nothing it writes is
// committed: the Dockerfile runs it in the `images` stage (about 1.5 MB of
// pictures for OpenMoji, about 6 MB for Mulberry), and a developer can run it into the
// gitignored plugins/data-images/. The SVG files are copied byte for byte.
//
// Needs node (22 or newer) and `unzip`.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemblePack, mulberryConcepts, openmojiConcepts, sha256 } from './images-lib.mjs';
import { die, fetchPinned, zipList, zipRead } from './images-io.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function args() {
	const o = { pack: '', out: '', cache: '' };
	const a = process.argv.slice(2);
	for (let i = 0; i < a.length; i += 2) {
		if (!['--pack', '--out', '--cache'].includes(a[i]) || !a[i + 1]) die('usage: node scripts/prepare-images-pack.mjs --pack openmoji|mulberry --out <dir> [--cache <dir>]');
		o[a[i].slice(2)] = a[i + 1];
	}
	if (!['openmoji', 'mulberry'].includes(o.pack) || !o.out) die('--pack openmoji|mulberry and --out <dir> are required');
	return o;
}

const globEscape = (s) => s.replace(/[\\*?[\]]/g, '\\$&');

async function main() {
	const { pack, out, cache: cacheArg } = args();
	const cache = cacheArg || mkdtempSync(join(tmpdir(), 'images-'));
	const pins = JSON.parse(readFileSync(join(root, 'scripts/images/pins.json'), 'utf8'));
	const mapText = readFileSync(join(root, 'scripts/images', pack, 'map.tsv'), 'utf8');

	let concepts;
	let licenseText;
	let readSvg;
	if (pack === 'openmoji') {
		const p = pins.openmoji;
		const data = JSON.parse((await fetchPinned(p.data, cache)).buf.toString('utf8'));
		const zip = (await fetchPinned(p.zip, cache)).file;
		const licence = (await fetchPinned(p.license, cache)).buf.toString('utf8');
		if (!/Attribution-ShareAlike 4\.0 International/.test(licence)) die('openmoji LICENSE.txt is no longer the CC BY-SA 4.0 text');
		const have = new Set(zipList(zip).filter((n) => n.endsWith('.svg')).map((n) => n.replace(/\.svg$/, '')));
		concepts = openmojiConcepts(data, {}, have);
		licenseText = licence;
		readSvg = (c) => zipRead(zip, globEscape(`${c.id}.svg`));
	} else {
		const p = pins.mulberry;
		const csv = (await fetchPinned(p.data, cache)).buf.toString('utf8');
		const zip = (await fetchPinned(p.zip, cache)).file;
		const upstream = zipRead(zip, p.licenseInZip.path);
		if (sha256(upstream) !== p.licenseInZip.sha256) die('Mulberry LICENSE.txt changed: re-read the licence, then update the pin');
		if (!/Share[- ]Alike/i.test(upstream.toString('utf8')) || !/by-sa\/4\.0/.test(upstream.toString('utf8'))) die('Mulberry LICENSE.txt no longer names CC BY-SA 4.0');
		// Mulberry's LICENSE.txt is a notice that links the licence; the legal code of
		// CC BY-SA 4.0 is the one OpenMoji's pinned LICENSE.txt carries.
		const legal = (await fetchPinned(pins.openmoji.license, cache)).buf.toString('utf8');
		if (!/Attribution-ShareAlike 4\.0 International/.test(legal)) die('the pinned CC BY-SA 4.0 legal code is not that text');
		const have = new Set(zipList(zip).filter((n) => n.startsWith('EN-symbols/') && n.endsWith('.svg')).map((n) => n.slice('EN-symbols/'.length, -'.svg'.length)));
		concepts = mulberryConcepts(csv, have);
		licenseText = `${upstream.toString('utf8').trim()}\n\n----\n\n${legal}`;
		readSvg = (c) => zipRead(zip, globEscape(`EN-symbols/${c.file}.svg`));
	}

	let files;
	try {
		files = assemblePack(pack, mapText, concepts, readSvg, licenseText);
	} catch (e) {
		die(e.message);
	}
	rmSync(out, { recursive: true, force: true });
	mkdirSync(join(out, 'pictures'), { recursive: true });
	let bytes = 0;
	for (const [path, body] of files) {
		writeFileSync(join(out, path), body);
		if (path.startsWith('pictures/')) bytes += body.length;
	}
	console.log(`images pack ${pack}: ${files.size - 5} pictures, ${bytes} bytes of SVG, written to ${out}`);
}

main();
