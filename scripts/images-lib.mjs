// Shared helpers of the images packs (#216): the readers of the upstream
// files, the TSV formats of the pack, and the pack assembly. Pure functions
// (no network, no archive tools) so scripts/images-lib.test.mjs can test them;
// build-picture-map.mjs and prepare-images-pack.mjs add the I/O.
import { createHash } from 'node:crypto';

export const MAP_HEADER = ['language', 'target', 'sense', 'concept', 'score', 'basis', 'note'];
export const PICTURES_HEADER = ['concept', 'file', 'label', 'credit'];
export const MANUAL_HEADER = ['language', 'target', 'sense', 'concept', 'note'];
/** What a concept id may look like: it is also the picture's file name. */
export const CONCEPT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- TSV (one header line, tab separated, no quoting: values may not hold tabs or newlines)

const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ').trim();

export function formatTsv(header, rows) {
	return [header.join('\t'), ...rows.map((r) => header.map((h) => cell(r[h])).join('\t'))].join('\n') + '\n';
}

export function parseTsv(text, header) {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	if (lines.at(-1) === '') lines.pop();
	if (lines[0] !== header.join('\t')) throw new Error(`TSV header is not ${header.join('\\t')}`);
	return lines.slice(1).map((line, i) => {
		const f = line.split('\t');
		if (f.length !== header.length) throw new Error(`TSV line ${i + 2}: ${f.length} fields, want ${header.length}`);
		return Object.fromEntries(header.map((h, k) => [h, f[k]]));
	});
}

// ---- dictionaries

/** CC-CEDICT text -> entries grouped by simplified form, one sense per line in
 * file order (as the server's importer stores them). */
export function parseCedict(text) {
	const byKey = new Map();
	const out = [];
	for (const line of text.split('\n')) {
		if (!line || line.startsWith('#')) continue;
		const m = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/.exec(line);
		if (!m) continue;
		const glosses = m[4].split('/').map((g) => g.trim()).filter(Boolean);
		if (glosses.length === 0) continue;
		let e = byKey.get(m[2]);
		if (!e) {
			e = { target: m[2], forms: [m[2]], senses: [], note: m[3], rank: m[2].length * 1e6 + out.length };
			byKey.set(m[2], e);
			out.push(e);
		}
		if (m[1] !== m[2] && !e.forms.includes(m[1])) e.forms.push(m[1]);
		e.senses.push(glosses);
	}
	return out;
}

const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** JMdict XML -> entries keyed j:<ent_seq>; senses without an English gloss are
 * dropped (so the sense numbers are the importer's). common: the entry has a
 * priority marking (ke_pri / re_pri). */
export function parseJMdict(xml) {
	const out = [];
	for (const chunk of xml.split('<entry>').slice(1)) {
		const body = chunk.slice(0, chunk.indexOf('</entry>'));
		const seq = /<ent_seq>(\d+)<\/ent_seq>/.exec(body)?.[1];
		if (!seq) continue;
		const all = (tag) => [...body.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => xmlText(m[1]).trim()).filter(Boolean);
		const kebs = all('keb');
		const rebs = all('reb');
		const senses = [];
		for (const s of body.split('<sense>').slice(1)) {
			const glosses = [...s.matchAll(/<gloss(\s[^>]*)?>([^<]*)<\/gloss>/g)]
				.filter((m) => !m[1] || !/xml:lang=/.test(m[1]) || /xml:lang="eng"/.test(m[1]))
				.map((m) => xmlText(m[2]).trim())
				.filter(Boolean);
			if (glosses.length) senses.push(glosses);
		}
		if (!senses.length || !rebs.length) continue;
		const common = /<(ke|re)_pri>/.test(body);
		out.push({ target: `j:${seq}`, forms: [...kebs, ...rebs], senses, note: kebs[0] ?? rebs[0], common, rank: (common ? 0 : 1e9) + Number(seq) });
	}
	return out;
}

// ---- picture sets

const FE0F = /\uFE0F/g;
const SKIPPED_EXTRAS = new Set(['brand', 'flags', 'ui-element', 'queer-symbols']);

/** OpenMoji data/openmoji.json + CLDR annotations ({lang: annotations object}) ->
 * concepts. Skin-tone variants, flags, the Unicode private-use extras (the Apple logo) and the font's helper glyphs are left
 * out; `available` (a Set of hexcodes, optional) drops those without an SVG. */
export function openmojiConcepts(list, cldr, available) {
	const out = [];
	for (const o of list) {
		// a skin-tone variant has a skintone; the base emoji of a family names itself as its base
		if (o.skintone || (o.skintone_base_hexcode && o.skintone_base_hexcode !== o.hexcode) || o.group === 'component' || o.group === 'flags' || o.group === 'extras-unicode') continue;
		if (o.group === 'extras-openmoji' && SKIPPED_EXTRAS.has(o.subgroups)) continue; // brand logos and UI icons are not words
		if (/^[A-Z]/.test(o.annotation ?? '')) continue; // a capital: a zodiac sign or a proper name ("Cancer"), not a thing
		if (available && !available.has(o.hexcode)) continue;
		if (!CONCEPT_ID.test(o.hexcode)) continue;
		const native = {};
		for (const [lang, a] of Object.entries(cldr)) {
			const rec = o.emoji ? (a[o.emoji] ?? a[o.emoji.replace(FE0F, '')]) : undefined;
			if (rec) native[lang] = { name: rec.tts?.[0] ?? '', keywords: rec.default ?? [] };
		}
		const tags = [...(o.tags ? o.tags.split(',') : []), ...(o.openmoji_tags ? o.openmoji_tags.split(',') : [])].map((t) => t.trim()).filter(Boolean);
		out.push({ id: o.hexcode, label: o.annotation, tags, pos: 'noun', native, credit: o.openmoji_author ? `OpenMoji, ${o.openmoji_author}` : 'OpenMoji' });
	}
	return out;
}

/** A CSV line with optional double quotes. */
export function csvLine(line) {
	const f = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (q) {
			if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
			else if (c === '"') q = false;
			else cur += c;
		} else if (c === '"') q = true;
		else if (c === ',') (f.push(cur), (cur = ''));
		else cur += c;
	}
	f.push(cur);
	return f;
}

/** Mulberry symbol-info.csv -> concepts. A name "x_,_to" is the verb x; a
 * numbered variant of a symbol (baker_1b after baker_1a) is dropped for the
 * first; letters, numbers-in-words and interjections are left out. */
export function mulberryConcepts(csv, available) {
	const lines = csv.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
	const head = csvLine(lines[0]);
	const col = (n) => head.indexOf(n);
	const [iGrammar, iTags, iName] = [col('grammar'), col('tags'), col('symbol-en')];
	if ([iGrammar, iTags, iName].includes(-1)) throw new Error('symbol-info.csv: unexpected columns');
	const out = [];
	const seen = new Set();
	const ids = new Set();
	for (const line of lines.slice(1)) {
		const f = csvLine(line);
		const name = f[iName];
		const grammar = f[iGrammar];
		if (!name || ['Letter', 'Interjection'].includes(grammar)) continue;
		if (available && !available.has(name)) continue;
		let label = name;
		let pos = grammar === 'Verb' || grammar === 'VerbComplex' ? 'verb' : 'noun';
		if (/_,_to$/.test(label)) (label = label.replace(/_,_to$/, '')), (pos = 'verb');
		const base = label.replace(/_\d+[a-z]?$/, '');
		const key = `${pos}:${base}`;
		if (seen.has(key)) continue;
		seen.add(key);
		let id = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+/, '').replace(/_+/g, '_').slice(0, 60);
		if (!CONCEPT_ID.test(id)) continue;
		for (let n = 2; ids.has(id); n++) id = `${id.replace(/_\d+$/, '').slice(0, 56)}_${n}`; // "close to" and the verb "close, to"
		ids.add(id);
		out.push({ id, file: name, label: base, tags: (f[iTags] ?? '').split(/\s+/).filter(Boolean), pos, native: {}, credit: 'Mulberry Symbols, Steve Lee' });
	}
	return out;
}

const PLAIN_ELEMENTS = 'svg|g|path|circle|ellipse|rect|line|polyline|polygon|defs|clipPath|mask|use|linearGradient|radialGradient|stop|title|desc';

/** A cheap pre-filter that mirrors the server's CheckSVG vocabulary: does the
 * picture use only drawing elements (no <style>, <script>, <image>, ...)? The
 * server's check is the authority; this keeps pictures it would refuse out of
 * the map. */
export function svgLooksPlain(text) {
	const stripped = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
	return !new RegExp(`<(?!/?(?:${PLAIN_ELEMENTS})[\\s>/])[A-Za-z]`).test(stripped) && !/\son[a-z]+\s*=/i.test(stripped);
}

// ---- manual overrides

/** Apply manual rows: they replace every automatic row of the same (language,
 * target) and score 100. Unknown concepts are an error. */
export function applyManual(rows, manual, conceptIds) {
	const keys = new Set(manual.map((m) => `${m.language}\t${m.target}`));
	const kept = rows.filter((r) => !keys.has(`${r.language}\t${r.target}`));
	for (const m of manual) {
		if (!conceptIds.has(m.concept)) throw new Error(`manual.tsv: unknown concept ${m.concept} for ${m.target}`);
		kept.push({ language: m.language, target: m.target, sense: m.sense || '0', concept: m.concept, score: 100, basis: 'manual', note: m.note });
	}
	return kept;
}

/** Drop the automatic rows a review removed (#274, scripts/images/<pack>/removed.tsv): each names one (language,
 * target, sense, concept). */
export function applyRemovals(rows, removed) {
	const drop = new Set(removed.map((r) => `${r.language}\t${r.target}\t${r.sense}\t${r.concept}`));
	return rows.filter((r) => !drop.has(`${r.language}\t${r.target}\t${r.sense}\t${r.concept}`));
}

/** Deterministic order of map rows: language, target, sense, score descending. */
export function sortRows(rows) {
	return [...rows].sort(
		(a, b) => a.language.localeCompare(b.language) || a.target.localeCompare(b.target, 'en') || Number(a.sense) - Number(b.sense) || Number(b.score) - Number(a.score) || a.concept.localeCompare(b.concept)
	);
}

// ---- pack assembly

/** The pack manifest from a spec and the map's languages. */
export function manifestFor(spec, languages) {
	return {
		id: spec.id,
		name: spec.name,
		version: spec.version,
		type: 'images',
		languages: [...languages].sort(),
		license: spec.license,
		attribution: spec.attribution,
		notice: spec.notice,
		format: 'images-svg'
	};
}

/** The pictures.tsv rows of the concepts a map uses (in concept order). */
export function picturesFor(mapRows, concepts) {
	const used = new Set(mapRows.map((r) => r.concept));
	return concepts
		.filter((c) => used.has(c.id))
		.sort((a, b) => a.id.localeCompare(b.id, 'en'))
		.map((c) => ({ concept: c.id, file: `pictures/${c.id}.svg`, label: c.label, credit: c.credit }));
}

// ---- the two packs

const UNICODE_NOTICE =
	'The word-to-picture mapping uses the Unicode CLDR emoji annotations (Copyright Unicode, Inc., [Unicode License v3](https://www.unicode.org/license.txt)) and the English glosses of CC-CEDICT and JMdict.';

/** What differs between the two packs. */
export const SPECS = {
	openmoji: {
		id: 'images-openmoji',
		name: 'OpenMoji pictures (black outline)',
		license: 'CC BY-SA 4.0',
		attribution: 'All emojis designed by OpenMoji – the open-source emoji and icon project. License: CC BY-SA 4.0 (https://openmoji.org)',
		notice:
			'Pictures: the black-outline SVG files of [OpenMoji](https://openmoji.org) 17.0.0, unmodified in this pack; the app draws them in the text colour of the theme. ' +
			'The pictures, the recoloured versions and this pack are shared under CC BY-SA 4.0 ([legal code](https://creativecommons.org/licenses/by-sa/4.0/)). Only the pictures some word uses are included.\n\n' +
			UNICODE_NOTICE,
		fileOf: (c) => `${c.id}.svg`
	},
	mulberry: {
		id: 'images-mulberry',
		name: 'Mulberry Symbols',
		license: 'CC BY-SA 4.0',
		attribution: 'Mulberry Symbols by Steve Lee are licenced under the Creative Commons Attribution-ShareAlike 4.0 License (https://mulberrysymbols.org)',
		notice:
			'Pictures: [Mulberry Symbols](https://mulberrysymbols.org) 3.6.1 by Steve Lee, in colour and unmodified; only the pictures some word uses are included, and only for words the OpenMoji pack has no picture for. ' +
			'The pictures and this pack are shared under CC BY-SA 4.0 ([legal code](https://creativecommons.org/licenses/by-sa/4.0/)).\n\n' +
			'The word-to-picture mapping uses the English glosses of CC-CEDICT and JMdict and the English names of the symbols.',
		fileOf: (c) => `EN-symbols/${c.file}.svg`
	}
};
SPECS.openmoji.version = '17.0.0';
SPECS.mulberry.version = '3.6.1';

export const MAX_SVG_BYTES = 256 << 10;

/**
 * The files of one pack (path -> string | Buffer): manifest.json, LICENSE,
 * ATTRIBUTION.md, map.tsv, pictures.tsv and pictures/<concept>.svg for every
 * concept the map uses. readSvg(concept) returns the picture's bytes. A map
 * row naming a concept that is not in `concepts`, or a picture that is
 * missing, too large or not an SVG, is an error: the map and the pinned
 * upstream release no longer fit.
 */
export function assemblePack(pack, mapText, concepts, readSvg, licenseText) {
	const spec = SPECS[pack];
	if (!spec) throw new Error(`unknown pack ${pack}`);
	const rows = parseTsv(mapText, MAP_HEADER);
	if (rows.length === 0) throw new Error(`${pack}: the map is empty`);
	const byId = new Map(concepts.map((c) => [c.id, c]));
	for (const r of rows) if (!byId.has(r.concept)) throw new Error(`${pack}: map names ${r.concept}, which the pinned release does not have`);
	const files = new Map();
	const pictures = picturesFor(rows, concepts);
	for (const p of pictures) {
		const buf = readSvg(byId.get(p.concept));
		if (!buf || buf.length === 0) throw new Error(`${pack}: picture ${p.concept} is missing`);
		if (buf.length > MAX_SVG_BYTES) throw new Error(`${pack}: picture ${p.concept} is ${buf.length} bytes (limit ${MAX_SVG_BYTES})`);
		if (!/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(buf.toString('utf8', 0, 400))) throw new Error(`${pack}: picture ${p.concept} is not an SVG`);
		if (!svgLooksPlain(buf.toString('utf8'))) throw new Error(`${pack}: picture ${p.concept} uses elements the server refuses (style, script, image ...): rebuild the map`);
		files.set(`pictures/${p.concept}.svg`, buf);
	}
	files.set('pictures.tsv', formatTsv(PICTURES_HEADER, pictures));
	files.set('map.tsv', mapText);
	files.set('manifest.json', JSON.stringify(manifestFor(spec, new Set(rows.map((r) => r.language))), null, 2) + '\n');
	files.set('LICENSE', licenseText);
	files.set('ATTRIBUTION.md', attributionFor(spec, pictures.length, rows.length));
	return files;
}

export function attributionFor(spec, pictures, rows) {
	const plain = spec.notice.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
	return `# ${spec.name}\n\n${spec.attribution}\n\nLicence: ${spec.license}. See LICENSE.\n\n${plain}\n\nThis pack holds ${pictures} pictures and ${rows} word-to-picture rows (map.tsv). Every picture is credited in pictures.tsv.\n`;
}
