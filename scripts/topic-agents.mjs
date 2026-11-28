#!/usr/bin/env node
// The agent step of the topic labels (#220), a maintainer step like the
// picture matcher: it needs the `claude` command line and is never part of a
// build or a test.
//
//   node scripts/topic-agents.mjs plan <zh|ja> [--list <levels.json>]
//       puts the words no batch has yet into new batches
//       scripts/topics/<lang>/batch-NN.json (items only); existing batches
//       are kept, so a changed list only adds work. Chinese: HSK 1-4 of plugins/data/hsk-words. Japanese:
//       ≈ N5-N3 of --list (default plugins/data/jlpt-words/levels.json).
//   node scripts/topic-agents.mjs run <zh|ja> <suggest|a|b|c|d> [--list <levels.json>] [--jobs N] [--batches 1,3]
//       asks the stage's agent (scripts/topics/reviewers.json) about every
//       batch and writes its answers into the batch file: `suggest` labels
//       the words, `a` and `b` are two teachers reviewing the suggestion
//       independently, `c` decides the words where a and b disagree, `d`
//       (the same teacher as c) checks every sense entry the decision kept.
//       Items an agent skipped are asked again (twice at most).
//
// The prompts carry the dictionary senses (CC-CEDICT, JMdict) of each word;
// the batch files keep only the words and the answers. The decision rule is
// topics-lib.mjs `decide`; scripts/build-topic-labels.mjs makes the files.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseJMdict } from './images-lib.mjs';
import { batchFiles, inputs, root } from './build-topic-labels.mjs';
import { cedictSenses, decide, jaTargets, parseJsonLines, readAnswers, zhTargets } from './topics-lib.mjs';

const BATCH = 150;
const JA_LEVELS = ['≈ N5', '≈ N4', '≈ N3'];

function opts(a) {
	const o = { list: '', jobs: 4, batches: null };
	for (let i = 0; i < a.length; i += 2) {
		if (a[i] === '--list') o.list = a[i + 1];
		else if (a[i] === '--jobs') o.jobs = Number(a[i + 1]);
		else if (a[i] === '--batches') o.batches = a[i + 1].split(',').map(Number);
		else throw new Error(`unknown option ${a[i]}`);
	}
	return o;
}

function targets(lang, list, picture) {
	if (lang === 'zh') {
		const levels = JSON.parse(readFileSync(join(root, 'plugins/data/hsk-words/levels.json'), 'utf8'));
		const senses = cedictSenses(gunzipSync(readFileSync(join(root, 'plugins/data/cedict/dictionary.txt.gz'))).toString('utf8'));
		return zhTargets(levels, senses, picture, 4);
	}
	const file = list || join(root, 'plugins/data/jlpt-words/levels.json');
	if (!existsSync(file)) throw new Error(`no Japanese word list: pass --list <levels.json> (a jlpt-words levels file)`);
	const jmdict = parseJMdict(gunzipSync(readFileSync(join(root, 'plugins/data/jmdict/jmdict.xml.gz'))).toString('utf8'));
	return jaTargets(JSON.parse(readFileSync(file, 'utf8')), jmdict, picture, JA_LEVELS);
}

const LANGUAGE = { zh: 'Mandarin Chinese', ja: 'Japanese' };

function topicBlock() {
	const list = JSON.parse(readFileSync(join(root, 'docs/contracts/topics/topics.json'), 'utf8')).topics;
	return list.map((t) => `- ${t.id}: ${t.scope}`).join('\n');
}

const sensesText = (w) => w.senses.map((s) => `${s.n})${s.reading ? ` [${s.reading}]` : ''} ${s.glosses.join('; ')}`).join('  ') || '(no dictionary entry found)';
const labelText = (v) => (v ? `${v.t.join(', ')}${v.s ? Object.entries(v.s).map(([n, t]) => `; sense ${n}: ${t.join(', ')}`).join('') : ''}` : '-');
const wordLine = (w) => `${w.i} | ${w.form} | ${w.reading ?? ''} | ${sensesText(w)} | picture: ${w.picture.join(', ') || '-'}`;

const RULES = `Rules for labels:
- 1 to 3 topic ids per word, the best fit first: the theme a teacher would teach the word in.
- Every word gets at least one topic. Grammar words (particles, pronouns, question words, conjunctions, auxiliaries, degree and negation adverbs) are "function"; general adjectives "qualities"; general verbs "actions", "movement", "thinking" or "communication"; time words "time" or "calendar"; counters and units "measures".
- The word is labelled as a whole by "t", as the course means it: the listed reading and the meanings a learner at HSK 1-4 or JLPT N5-N3 meets. Only when one of those common senses belongs to a clearly different topic (for example "bank" of money and of a river), add "s": {"<sense number>": [topics]} for that sense. Senses that fit "t", rare senses and senses of another reading need no entry.
- Fewer, better topics: add a second or third topic only when a teacher would really teach the word in that unit too.
- "picture" is the topic of an emoji picture matched to the word; it can be wrong.
- Use only the topic ids listed.`;

function prompt(lang, stage, role, words, batch) {
	const head = `You are ${role[0].toLowerCase()}${role.slice(1)}\n\nA language-learning app for ${LANGUAGE[lang]} fills its course units by theme. Each word gets topics from this fixed list (id: what belongs to it):\n\n${topicBlock()}\n\n${RULES}\n\n`;
	const fmt = 'Each word line is: number | word | reading | dictionary senses (numbered) | picture topic.';
	if (stage === 'suggest') {
		return `${head}Label these words. ${fmt}\n\n${words.map(wordLine).join('\n')}\n\nAnswer with one JSON object per line and nothing else, one line per word, in the same order: {"i": <number>, "t": ["topic", ...]} or {"i": <number>, "t": [...], "s": {"2": ["topic"]}}.`;
	}
	const sug = readAnswers(batch.suggest, ids());
	if (stage === 'a' || stage === 'b') {
		return `${head}As an experienced teacher, review the proposed labels critically; do not approve a label only because it is not wrong. For each word, think of the themed unit of a beginner or intermediate course you would teach it in, then check: is the first topic that unit? Is a topic missing that a teacher would expect? Is a topic there that would put the word into a unit where it does not belong (a loose association, a rare sense, a sense of another reading)? Is a sense entry needed, or one there that should go? Correct anything you would correct in a colleague's syllabus. ${fmt} The proposal follows "=>".\n\n${words.map((w) => `${wordLine(w)} => ${labelText(sug.get(w.i))}`).join('\n')}\n\nAnswer with one JSON object per line and nothing else, one line per word, in the same order: {"i": <number>, "v": "ok"} when the proposal is right, else {"i": <number>, "v": "change", "t": [...], "s": {...} (only if needed), "n": "<short reason in English>"} with the complete corrected labels.`;
	}
	if (stage === 'd') {
		return `${head}Check the sense entries of these words. Each word has its labels "t" and one or more sense entries that send one sense of the word into another unit too. Keep a sense entry only when that sense is common for a learner at this level AND a teacher would really teach the word in that unit for that sense. Drop it when the sense is rare, figurative, archaic, belongs to another reading, or already fits "t". ${fmt} The labels follow "=>".\n\n${words.map((w) => `${wordLine(w)} => ${labelText(w.decided)}`).join('\n')}\n\nAnswer with one JSON object per line and nothing else, one line per word: {"i": <number>, "keep": [<sense numbers to keep>], "n": "<short reason in English>"} (an empty list drops them all).`;
	}
	const a = readAnswers(batch.a, ids());
	const b = readAnswers(batch.b, ids());
	const show = (x) => (x?.ok ? 'agrees with the proposal' : `${labelText(x)}${x?.n ? ` (reason: ${x.n})` : ''}`);
	return `${head}Two teachers reviewed the proposed labels of these words and disagree. As the head of the curriculum, decide each word's labels. ${fmt}\n\n${words.map((w) => `${wordLine(w)}\n   proposal: ${labelText(sug.get(w.i))}\n   teacher A: ${show(a.get(w.i))}\n   teacher B: ${show(b.get(w.i))}`).join('\n')}\n\nAnswer with one JSON object per line and nothing else, one line per word: {"i": <number>, "t": [...], "s": {...} (only if needed), "n": "<short reason in English>"}.`;
}

/** Which listed word a batch item is: the form (Chinese, one item per form), or the form and reading (Japanese). */
const identity = (lang, w) => (lang === 'zh' ? w.form : `${w.form}\t${w.reading ?? ''}`);

let idList;
const ids = () => (idList ??= inputs().ids);

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

/** The items of a batch this stage still has to answer. */
function pending(stage, batch) {
	const have = new Set((batch[stage] ?? []).map((x) => x.i));
	if (stage === 'suggest' || stage === 'a' || stage === 'b') return batch.items.filter((it) => !have.has(it.i));
	const sug = readAnswers(batch.suggest, ids());
	const a = readAnswers(batch.a, ids());
	const b = readAnswers(batch.b, ids());
	const c = readAnswers(batch.c ?? [], ids());
	const decided = (it) => decide(sug.get(it.i), { a: a.get(it.i), b: b.get(it.i), c: stage === 'd' ? c.get(it.i) : undefined });
	if (stage === 'c') return batch.items.filter((it) => !have.has(it.i) && sug.has(it.i) && decided(it).review === 'disputed');
	return batch.items.filter((it) => !have.has(it.i) && sug.has(it.i) && decided(it).s).map((it) => ({ ...it, decided: decided(it) }));
}

async function runBatch(lang, stage, file, byWord, role) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const batch = JSON.parse(readFileSync(file, 'utf8'));
		// a word the current list no longer has is left as it is
		const todo = pending(stage, batch).filter((it) => byWord.has(identity(lang, it)));
		if (!todo.length) return;
		const words = todo.map((it) => ({ ...byWord.get(identity(lang, it)), i: it.i, decided: it.decided }));
		const answer = await ask(prompt(lang, stage, role, words, batch));
		const want = new Set(todo.map((it) => it.i));
		const got = parseJsonLines(answer).filter((x) => want.has(x.i));
		const fresh = JSON.parse(readFileSync(file, 'utf8'));
		if (stage === 'd' && !fresh.reviewers.d) fresh.reviewers.d = fresh.reviewers.c;
		const known = new Set((fresh[stage] ?? []).map((x) => x.i));
		fresh[stage] = [...(fresh[stage] ?? []), ...got.filter((x) => !known.has(x.i) && (known.add(x.i), true))].sort((x, y) => x.i - y.i);
		writeFileSync(file, formatBatch(fresh));
		console.log(`${lang} ${stage} ${file.split('/').pop()}: ${got.length}/${todo.length} answered`);
	}
}

/** A batch file: the header as JSON, one item or answer per line. */
export function formatBatch(b) {
	const list = (xs) => `[\n${xs.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]`;
	const keys = ['items', 'suggest', 'a', 'b', 'c', 'd'].filter((k) => b[k]);
	const head = { ...b };
	for (const k of keys) delete head[k];
	const top = JSON.stringify(head, null, 1).replace(/\n}$/, '');
	return `${top},\n${keys.map((k) => ` "${k}": ${list(b[k])}`).join(',\n')}\n}\n`;
}

async function main() {
	const [cmd, lang, ...rest] = process.argv.slice(2);
	if (!['zh', 'ja'].includes(lang)) throw new Error('usage: topic-agents.mjs plan|run <zh|ja> ...');
	if (cmd === 'plan') {
		const o = opts(rest);
		const t = targets(lang, o.list, inputs().picture(lang));
		const dir = join(root, 'scripts/topics', lang);
		mkdirSync(dir, { recursive: true });
		const reviewers = JSON.parse(readFileSync(join(root, 'scripts/topics/reviewers.json'), 'utf8'))[lang].reviewers;
		const id = (stage) => reviewers.filter((r) => r.stage === stage).map((r) => r.id);
		const [suggest] = id('suggest');
		const [a, b] = id('review');
		const [c] = id('adjudicate');
		// existing batches stay as they are: only words no batch has get new batches, numbered after the last
		const old = batchFiles(lang).map((f) => JSON.parse(readFileSync(f, 'utf8')));
		const have = new Set(old.flatMap((b) => b.items.map((it) => identity(lang, it))));
		const fresh = t.filter((w) => !have.has(identity(lang, w)));
		let i = Math.max(0, ...old.flatMap((b) => b.items.map((it) => it.i)));
		const first = Math.max(0, ...old.map((b) => b.batch));
		for (let n = 0; n * BATCH < fresh.length; n++) {
			const items = fresh.slice(n * BATCH, (n + 1) * BATCH).map((w) => {
				const it = { i: ++i, key: w.key, form: w.form };
				if (w.reading) it.reading = w.reading;
				return it;
			});
			const number = first + n + 1;
			const file = join(dir, `batch-${String(number).padStart(2, '0')}.json`);
			writeFileSync(file, formatBatch({ language: lang, batch: number, reviewers: { suggest, a, b, c }, items }));
		}
		console.log(`${lang}: ${t.length} words, ${fresh.length} new in ${Math.ceil(fresh.length / BATCH)} new batches`);
		return;
	}
	if (cmd !== 'run') throw new Error(`unknown command ${cmd}`);
	const [stage, ...more] = rest;
	if (!['suggest', 'a', 'b', 'c', 'd'].includes(stage)) throw new Error('stage: suggest, a, b, c or d');
	const o = opts(more);
	const t = targets(lang, o.list, inputs().picture(lang));
	const byWord = new Map(t.map((w) => [identity(lang, w), w]));
	const meta = JSON.parse(readFileSync(join(root, 'scripts/topics/reviewers.json'), 'utf8'))[lang].reviewers;
	const files = batchFiles(lang).filter((f) => !o.batches || o.batches.includes(Number(/batch-(\d+)/.exec(f)[1])));
	const roleOf = (f) => {
		const b = JSON.parse(readFileSync(f, 'utf8'));
		return meta.find((r) => r.id === (b.reviewers[stage] ?? b.reviewers.c)).role;
	};
	let next = 0;
	const worker = async () => {
		while (next < files.length) {
			const f = files[next++];
			try {
				await runBatch(lang, stage, f, byWord, roleOf(f));
			} catch (e) {
				console.error(`${f}: ${e.message}`);
			}
		}
	};
	await Promise.all(Array.from({ length: o.jobs }, worker));
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
