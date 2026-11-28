#!/usr/bin/env node
// The doubtful-picture review (#274), a maintainer step like the picture matcher: `run` needs the `claude` command
// line and is never part of a build or a test.
//
//   node scripts/picture-review.mjs plan --pictures <openmoji pictures.tsv>,<mulberry pictures.tsv>
//       lists, word by word, the automatic mappings of scripts/images/<pack>/map.tsv that are doubtful
//       (picture-review-lib.mjs doubtReasons) for the words of the Starter sets, HSK 1-2 and ≈ N5-N4
//       (plugins/data/hsk-words, plugins/data/jlpt-words), into scripts/images/review/<lang>-batch-NN.json.
//       The pictures.tsv files are those of the built packs (scripts/prepare-images-pack.mjs): they give each
//       picture's English name.
//   node scripts/picture-review.mjs run <zh|ja> <a|b|c> [--jobs N] [--batches 1,3]
//       asks the stage's agent (scripts/images/review/reviewers.json): a and b are two teachers reviewing every
//       item independently, c decides the items where they disagree. Answers go into the batch file.
//   node scripts/picture-review.mjs apply --cache <dir>
//       writes the decisions into scripts/images/<pack>/removed.tsv and manual.tsv (a change names an OpenMoji or
//       Mulberry picture by its English name, read from the pinned upstream metadata in --cache); then run
//       scripts/build-picture-map.mjs to rebuild the maps.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { MANUAL_HEADER, MAP_HEADER, formatTsv, mulberryConcepts, openmojiConcepts, parseCedict, parseJMdict, parseTsv } from './images-lib.mjs';
import { fetchPinned } from './images-io.mjs';
import { batches, decideItem, decisionRows, doubtReasons, readVerdicts, REMOVED_HEADER } from './picture-review-lib.mjs';
import { jaTargets, parseJsonLines } from './topics-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'scripts/images/review');
const PACKS = ['openmoji', 'mulberry'];
const LANGUAGE = { zh: 'Mandarin Chinese', ja: 'Japanese' };

function opts(a) {
	const o = { pictures: '', cache: '', jobs: 4, batches: null };
	for (let i = 0; i < a.length; i += 2) {
		const k = a[i].replace(/^--/, '');
		if (!(k in o)) throw new Error(`unknown option ${a[i]}`);
		o[k] = k === 'jobs' ? Number(a[i + 1]) : k === 'batches' ? a[i + 1].split(',').map(Number) : a[i + 1];
	}
	return o;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const levelEntries = (level) => level.entries.map((e) => (typeof e === 'string' ? { form: e } : e));

/** The words the review covers, per language: key -> {word, reading, sources}. */
function scope() {
	const words = { zh: new Map(), ja: new Map() };
	const add = (lang, key, word, reading, source) => {
		if (!key) return;
		const w = words[lang].get(key) ?? { word, reading: reading ?? '', sources: [] };
		if (!w.sources.includes(source)) w.sources.push(source);
		words[lang].set(key, w);
	};
	const jmdict = parseJMdict(gunzipSync(readFileSync(join(root, 'plugins/data/jmdict/jmdict.xml.gz'))).toString('utf8'));
	for (const lang of ['zh', 'ja']) {
		const set = readJson(join(root, `server/internal/starter/sets/starter-${lang}.json`));
		if (lang === 'zh') for (const w of set.words) add('zh', w.picture?.target ?? w.form, w.form, w.reading, 'starter');
		else {
			const ts = jaTargets({ levels: [{ name: 'starter', entries: set.words.map((w) => ({ form: w.form, reading: w.reading })) }] }, jmdict, new Map(), ['starter']);
			set.words.forEach((w, k) => add('ja', w.picture?.target ?? ts[k]?.key, w.form, w.reading, 'starter'));
		}
	}
	const hsk = readJson(join(root, 'plugins/data/hsk-words/levels.json'));
	hsk.levels.slice(0, 2).forEach((level, n) => {
		for (const e of levelEntries(level)) add('zh', e.form, e.form, e.reading, `hsk${n + 1}`);
	});
	const jlpt = readJson(join(root, 'plugins/data/jlpt-words/levels.json'));
	for (const [name, source] of [['≈ N5', 'n5'], ['≈ N4', 'n4']]) {
		for (const t of jaTargets(jlpt, jmdict, new Map(), [name])) add('ja', t.key, t.form, t.reading, source);
	}
	return { words, jmdict };
}

function plan(o) {
	const labels = {};
	o.pictures.split(',').forEach((file, k) => {
		labels[PACKS[k]] = new Map(parseTsv(readFileSync(file, 'utf8'), ['concept', 'file', 'label', 'credit']).map((r) => [r.concept, r.label]));
	});
	const { words, jmdict } = scope();
	const zhSenses = new Map(parseCedict(gunzipSync(readFileSync(join(root, 'plugins/data/cedict/dictionary.txt.gz'))).toString('utf8')).map((e) => [e.target, e]));
	const jaSenses = new Map(jmdict.map((e) => [e.target, e]));
	const items = { zh: [], ja: [] };
	for (const pack of PACKS) {
		const rows = parseTsv(readFileSync(join(root, 'scripts/images', pack, 'map.tsv'), 'utf8'), MAP_HEADER);
		const shared = new Map();
		for (const r of rows) shared.set(`${r.language}\t${r.concept}`, (shared.get(`${r.language}\t${r.concept}`) ?? 0) + 1);
		for (const r of rows) {
			const w = words[r.language]?.get(r.target);
			if (!w) continue;
			const entry = (r.language === 'zh' ? zhSenses : jaSenses).get(r.target);
			const senses = entry?.senses ?? [];
			const why = doubtReasons(r, { senses: senses.length, shared: shared.get(`${r.language}\t${r.concept}`), length: [...w.word].length });
			if (!why.length) continue;
			const sense = Number(r.sense);
			items[r.language].push({
				id: `${pack}|${r.language}|${r.target}|${r.sense}|${r.concept}`,
				pack,
				language: r.language,
				target: r.target,
				word: w.word,
				reading: w.reading || (r.language === 'zh' ? (entry?.note ?? '') : ''),
				sources: w.sources,
				sense,
				senses: senses.slice(0, 6).map((g, k) => `${k + 1}) ${g.slice(0, 4).join('; ')}`),
				concept: r.concept,
				picture: labels[pack]?.get(r.concept) ?? '',
				score: Number(r.score),
				basis: r.basis,
				why
			});
		}
	}
	for (const lang of ['zh', 'ja']) {
		// Starter words first, then the levels in order: what the course uses first is reviewed first.
		const rank = (it) => Math.min(...it.sources.map((s) => ['starter', 'hsk1', 'n5', 'hsk2', 'n4'].indexOf(s)));
		const sorted = items[lang].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
		for (const b of batches(sorted)) {
			const file = join(dir, `${lang}-batch-${String(b.n).padStart(2, '0')}.json`);
			const doc = {
				version: 1,
				rule: 'images/review',
				note: 'Doubtful automatic word -> picture mappings (#274): word, reading, the sense the picture is for (0: the whole entry) and the senses, the picture (pack, concept, English name), its score and how the matcher found it, and why it is doubtful. a and b: two teacher agents, c: the adjudicator where they disagree (scripts/images/review/reviewers.json); decision: what was applied. scripts/picture-review.mjs.',
				language: lang,
				batch: b.n,
				items: b.items
			};
			writeFileSync(file, JSON.stringify(doc, null, 1) + '\n');
		}
		console.log(`${lang}: ${sorted.length} doubtful mappings`);
	}
}

const batchFiles = (lang) => readdirSync(dir).filter((f) => f.startsWith(`${lang}-batch-`)).sort().map((f) => join(dir, f));

function itemLine(it) {
	const shown = it.sense === 0 ? 'the whole word' : `sense ${it.sense}`;
	return `${it.i} | ${it.word} | ${it.reading} | picture for ${shown} | senses: ${it.senses.join('  ') || '(none found)'} | picture: "${it.picture}" (${it.pack === 'openmoji' ? 'OpenMoji emoji' : 'Mulberry symbol'}) | matched by: ${it.basis}, score ${it.score} | flagged: ${it.why.join(', ')}`;
}

const TASK = `A language-learning app shows a small picture next to a word on flashcards and on the word's page, so that a beginner links the word to its meaning without English. The pictures were matched to words automatically; about one in ten is wrong or doubtful. Each line below is one such match.

Decide for every line:
- "accept": the picture shows the word's meaning (the sense named, or for "the whole word" its common meaning a beginner learns), and a learner would understand it.
- "remove": the picture is wrong, shows another sense or a different word, is too vague or abstract to teach the word, or is culturally misleading or offensive. No picture is better than a wrong one.
- "change": the picture is wrong, but one OpenMoji emoji clearly shows the meaning: give its English CLDR emoji name exactly (for example "red apple", "dog face", "fork and knife") in "to".

Be critical and decide as a teacher would for a beginner. Line format: number | word | reading | which sense the picture is for | dictionary senses | the picture's English name and set | how it was matched | why it was flagged.

Answer with one JSON object per line and nothing else, one line per item, in the same order: {"i": <number>, "v": "accept"} or {"i": <number>, "v": "remove", "r": "<short reason>"} or {"i": <number>, "v": "change", "to": "<emoji name>", "r": "<short reason>"}.`;

function prompt(lang, stage, role, todo) {
	const head = `You are ${role[0].toLowerCase()}${role.slice(1)}\n\nThe words are ${LANGUAGE[lang]}.\n\n${TASK}`;
	if (stage !== 'c') return `${head}\n\n${todo.map(itemLine).join('\n')}`;
	const lines = todo.map((it) => `${itemLine(it)}\n   teacher A: ${JSON.stringify(it._a)}\n   teacher B: ${JSON.stringify(it._b)}`);
	return `${head}\n\nTwo teachers disagreed on these lines; their answers follow each line. Weigh both and decide.\n\n${lines.join('\n')}`;
}

function ask(text) {
	return new Promise((ok, fail) => {
		const p = spawn('claude', ['-p', '--effort', 'high', '--tools', '', '--no-session-persistence', '--output-format', 'text'], { stdio: ['pipe', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		p.stdout.on('data', (d) => (out += d));
		p.stderr.on('data', (d) => (err += d));
		p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(`claude exited ${code}: ${err.slice(0, 500)}`))));
		p.stdin.end(text);
	});
}

function pending(stage, batch) {
	const have = new Set((batch[stage] ?? []).map((x) => x.i));
	if (stage !== 'c') return batch.items.filter((it) => !have.has(it.i));
	const a = readVerdicts(batch.a ?? []);
	const b = readVerdicts(batch.b ?? []);
	return batch.items.filter((it) => !have.has(it.i) && decideItem(a.get(it.i), b.get(it.i)).v === 'disputed').map((it) => ({ ...it, _a: a.get(it.i), _b: b.get(it.i) }));
}

async function run(lang, stage, o) {
	const reviewers = readJson(join(dir, 'reviewers.json'))[lang].reviewers;
	const role = reviewers.find((r) => r.stage === stage).role;
	const files = batchFiles(lang).filter((_, k) => !o.batches || o.batches.includes(k + 1));
	let next = 0;
	const worker = async () => {
		while (next < files.length) {
			const file = files[next++];
			for (let attempt = 0; attempt < 3; attempt++) {
				const batch = readJson(file);
				const todo = pending(stage, batch);
				if (!todo.length) break;
				const answer = await ask(prompt(lang, stage, role, todo));
				const ids = new Set(todo.map((t) => t.i));
				const got = parseJsonLines(answer).filter((x) => ids.has(x.i) && readVerdicts([x]).size === 1);
				const fresh = readJson(file);
				fresh[stage] = [...(fresh[stage] ?? []), ...got];
				writeFileSync(file, JSON.stringify(fresh, null, 1) + '\n');
				console.log(`${lang} ${stage} ${file.split('/').pop()}: ${got.length}/${todo.length} answered`);
			}
		}
	};
	await Promise.all(Array.from({ length: o.jobs }, worker));
}

async function apply(o) {
	const pins = readJson(join(root, 'scripts/images/pins.json'));
	const om = JSON.parse((await fetchPinned(pins.openmoji.data, o.cache)).buf.toString('utf8'));
	const mbCsv = (await fetchPinned(pins.mulberry.data, o.cache)).buf.toString('utf8');
	const names = new Map();
	for (const c of mulberryConcepts(mbCsv)) names.set(c.label.replace(/_/g, ' ').toLowerCase(), { pack: 'mulberry', concept: c.id });
	for (const c of openmojiConcepts(om, {})) if (c.label) names.set(c.label.toLowerCase(), { pack: 'openmoji', concept: c.id });
	const all = [];
	const counts = {};
	for (const lang of ['zh', 'ja']) {
		const n = (counts[lang] = { items: 0, accept: 0, remove: 0, change: 0, changeUnknown: 0, adjudicated: 0, undecided: 0 });
		for (const file of batchFiles(lang)) {
			const batch = readJson(file);
			const a = readVerdicts(batch.a ?? []);
			const b = readVerdicts(batch.b ?? []);
			const c = readVerdicts(batch.c ?? []);
			for (const it of batch.items) {
				const d = decideItem(a.get(it.i), b.get(it.i), c.get(it.i));
				it.decision = d;
				n.items++;
				if (d.by === 'adjudicator') n.adjudicated++;
				if (d.v === 'change' && !names.has(d.to)) n.changeUnknown++;
				n[d.v in n ? d.v : 'undecided']++;
				all.push(it);
			}
			writeFileSync(file, JSON.stringify(batch, null, 1) + '\n');
		}
	}
	const { removed, manual } = decisionRows(all, names);
	for (const pack of PACKS) {
		const write = (name, header, add) => {
			const file = join(root, 'scripts/images', pack, name);
			const have = existsSync(file) ? parseTsv(readFileSync(file, 'utf8'), header) : [];
			const keyOf = (r) => `${r.language}\t${r.target}\t${r.sense}\t${r.concept}`;
			const known = new Set(have.map(keyOf));
			const rows = [...have, ...add.filter((r) => r.pack === pack && !known.has(keyOf(r))).map(({ pack: _, ...r }) => r)];
			// The rows already there keep their order (manual.tsv is also written by hand); new ones follow.
			writeFileSync(file, formatTsv(header, rows));
		};
		write('removed.tsv', REMOVED_HEADER, removed);
		write('manual.tsv', MANUAL_HEADER, manual);
	}
	console.log(JSON.stringify(counts));
	console.log(`removed rows ${removed.length}, manual rows ${manual.length}`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'plan') plan(opts(rest));
else if (cmd === 'run') await run(rest[0], rest[1], opts(rest.slice(2)));
else if (cmd === 'apply') await apply(opts(rest));
else {
	console.error('usage: node scripts/picture-review.mjs plan --pictures <om.tsv>,<mb.tsv> | run <zh|ja> <a|b|c> [--jobs N] [--batches 1,3] | apply --cache <dir>');
	process.exit(2);
}
