#!/usr/bin/env node
// Build the word -> picture mappings of the images packs (#216):
//
//   node scripts/build-picture-map.mjs --cache <dir> [--report <dir>]
//
// A maintainer step, not part of the image build: it reads the pinned upstream
// metadata (scripts/images/pins.json: OpenMoji openmoji.json, the CLDR emoji
// annotations of zh and ja, Mulberry symbol-info.csv), the committed
// dictionaries (plugins/data/cedict, plugins/data/jmdict) and the hand-made
// scripts/images/<pack>/manual.tsv, runs the matcher (scripts/picture-match.mjs)
// and writes scripts/images/<pack>/map.tsv, which is committed. The pack
// builder (prepare-images-pack.mjs) turns a map into a pack at image build time.
//
// --report writes review-<pack>-<lang>.tsv: the words the matcher did not
// accept (ambiguous, weak, over the cap) with their candidates, for a human.
//
// Rules: Chinese uses every CC-CEDICT word (Mulberry: only HSK 3.0 words); Japanese only JMdict words with a
// priority marking (the words a learner meets), because JMdict holds 200,000
// entries and most of the rest is vocabulary no picture is wanted for. A
// concept is kept for at most MAX_PER_CONCEPT words per language. Mulberry gets
// only the words OpenMoji did not map (one consistent picture style where
// there is a choice, and fewer large files), scored 5 below OpenMoji's.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
	MANUAL_HEADER,
	MAP_HEADER,
	applyManual,
	formatTsv,
	mulberryConcepts,
	openmojiConcepts,
	parseCedict,
	parseJMdict,
	parseTsv,
	sortRows,
	svgLooksPlain
} from './images-lib.mjs';
import { die, fetchPinned, zipExtract, zipList } from './images-io.mjs';
import { matchEntries } from './picture-match.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_PER_CONCEPT = 12;
const LANGS = ['zh', 'ja'];

function args() {
	const o = { cache: '', report: '' };
	const a = process.argv.slice(2);
	for (let i = 0; i < a.length; i += 2) {
		if (!['--cache', '--report'].includes(a[i]) || !a[i + 1]) die('usage: node scripts/build-picture-map.mjs --cache <dir> [--report <dir>]');
		o[a[i].slice(2)] = a[i + 1];
	}
	if (!o.cache) die('--cache <dir> is required (the pinned downloads go there)');
	return o;
}

const readManual = (pack) => {
	const f = join(root, 'scripts/images', pack, 'manual.tsv');
	return existsSync(f) ? parseTsv(readFileSync(f, 'utf8'), MANUAL_HEADER) : [];
};

function toRows(lang, matched) {
	return matched.map((r) => ({ language: lang, target: r.target, sense: String(r.sense), concept: r.concept, score: String(r.score), basis: r.basis, note: r.note }));
}

async function main() {
	const { cache, report } = args();
	const pins = JSON.parse(readFileSync(join(root, 'scripts/images/pins.json'), 'utf8'));

	const om = JSON.parse((await fetchPinned(pins.openmoji.data, cache)).buf.toString('utf8'));
	const omZip = (await fetchPinned(pins.openmoji.zip, cache)).file;
	const omDir = zipExtract(omZip, join(cache, 'openmoji-svg'));
	// only pictures the server will accept (no <style>, <script>, <image> ...)
	const plain = (dir, names) => new Set(names.filter((n) => svgLooksPlain(readFileSync(join(dir, n + '.svg'), 'utf8'))));
	const have = plain(omDir, zipList(omZip).filter((n) => n.endsWith('.svg')).map((n) => n.replace(/\.svg$/, '')));
	const cldr = {};
	for (const l of LANGS) cldr[l] = JSON.parse((await fetchPinned(pins.cldr[l], cache)).buf.toString('utf8')).annotations.annotations;
	const mbCsv = (await fetchPinned(pins.mulberry.data, cache)).buf.toString('utf8');

	const all = {
		zh: parseCedict(gunzipSync(readFileSync(join(root, 'plugins/data/cedict/dictionary.txt.gz'))).toString('utf8')),
		ja: parseJMdict(gunzipSync(readFileSync(join(root, 'plugins/data/jmdict/jmdict.xml.gz'))).toString('utf8'))
	};
	const dict = { zh: all.zh, ja: all.ja.filter((e) => e.common) };
	// a manual row must name a word the dictionary has (its key or one of its forms)
	const words = Object.fromEntries(LANGS.map((l) => [l, new Set(all[l].flatMap((e) => [e.target, ...e.forms]))]));

	// Mulberry's pictures are large and cover abstract words: for Chinese only the
	// words of the HSK 3.0 word list get one (a gate here; no list data is copied).
	const hsk = new Set(JSON.parse(readFileSync(join(root, 'plugins/data/hsk-words/levels.json'), 'utf8')).levels.flatMap((l) => l.entries.map((e) => e.form)));
	const mulberryPool = { zh: dict.zh.filter((e) => hsk.has(e.target)), ja: dict.ja };

	const omConcepts = openmojiConcepts(om, cldr, have);
	const mbZip = (await fetchPinned(pins.mulberry.zip, cache)).file;
	const mbDir = zipExtract(mbZip, join(cache, 'mulberry-svg'));
	const mbAll = zipList(mbZip).filter((n) => n.startsWith('EN-symbols/') && n.endsWith('.svg')).map((n) => n.slice('EN-symbols/'.length, -'.svg'.length));
	const mbConcepts = mulberryConcepts(
		mbCsv,
		new Set([...plain(join(mbDir, 'EN-symbols'), mbAll)])
	);
	console.log(`Mulberry symbols the server would refuse (style/script elements): ${mbAll.length - [...plain(join(mbDir, 'EN-symbols'), mbAll)].length}`);
	console.log(`OpenMoji concepts ${omConcepts.length}, Mulberry concepts ${mbConcepts.length}; CC-CEDICT words ${dict.zh.length}, JMdict common words ${dict.ja.length}`);

	const out = { openmoji: [], mulberry: [] };
	for (const lang of LANGS) {
		const a = matchEntries(dict[lang], omConcepts, lang, { maxPerConcept: MAX_PER_CONCEPT });
		out.openmoji.push(...toRows(lang, a.rows));
		const taken = new Set(a.rows.map((r) => r.target));
		const b = matchEntries(
			mulberryPool[lang].filter((e) => !taken.has(e.target)),
			mbConcepts,
			lang,
			{ maxPerConcept: MAX_PER_CONCEPT, styleOffset: -5 }
		);
		out.mulberry.push(...toRows(lang, b.rows));
		if (report) {
			mkdirSync(report, { recursive: true });
			for (const [pack, rv] of [['openmoji', a.review], ['mulberry', b.review]]) {
				const rows = rv.map((r) => `${r.target}\t${r.note}\t${r.reason}\t${r.candidates.join(' ')}`);
				writeFileSync(join(report, `review-${pack}-${lang}.tsv`), ['target\tnote\treason\tcandidates', ...rows].join('\n') + '\n');
			}
		}
	}
	for (const [pack, concepts] of [['openmoji', omConcepts], ['mulberry', mbConcepts]]) {
		const manual = readManual(pack);
		const missing = manual.filter((m) => !words[m.language]?.has(m.target));
		if (missing.length) die(`manual.tsv of ${pack}: not in the dictionary: ${missing.map((m) => m.language + ':' + m.target).join(', ')}`);
		const rows = sortRows(applyManual(out[pack], manual, new Set(concepts.map((c) => c.id))));
		writeFileSync(join(root, 'scripts/images', pack, 'map.tsv'), formatTsv(MAP_HEADER, rows));
		const perLang = Object.fromEntries(LANGS.map((l) => [l, rows.filter((r) => r.language === l).length]));
		console.log(`${pack}: ${rows.length} map rows`, perLang, `${new Set(rows.map((r) => r.concept)).size} pictures`);
	}
}

main();
