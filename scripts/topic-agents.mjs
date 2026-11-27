#!/usr/bin/env node
// The agent step of the topic labels (#220), a maintainer step like the
// picture matcher: it needs the `claude` command line and is never part of a
// build or a test.
//
//   node scripts/topic-agents.mjs plan <zh|ja> [--list <levels.json>]
//       splits the words to label into scripts/topics/<lang>/batch-NN.json
//       (items only). Chinese: HSK 1-4 of plugins/data/hsk-words. Japanese:
//       ≈ N5-N3 of --list (default plugins/data/jlpt-words/levels.json).
//   node scripts/topic-agents.mjs run <zh|ja> <suggest|a|b|c> [--list <levels.json>] [--jobs N] [--batches 1,3]
//       asks the stage's agent (scripts/topics/reviewers.json) about every
//       batch and writes its answers into the batch file: `suggest` labels
//       the words, `a` and `b` are two teachers reviewing the suggestion
//       independently, `c` decides the words where a and b disagree.
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
	const a = readAnswers(batch.a, ids());
	const b = readAnswers(batch.b, ids());
	const show = (x) => (x?.ok ? 'agrees with the proposal' : `${labelText(x)}${x?.n ? ` (reason: ${x.n})` : ''}`);
	return `${head}Two teachers reviewed the proposed labels of these words and disagree. As the head of the curriculum, decide each word's labels. ${fmt}\n\n${words.map((w) => `${wordLine(w)}\n   proposal: ${labelText(sug.get(w.i))}\n   teacher A: ${show(a.get(w.i))}\n   teacher B: ${show(b.get(w.i))}`).join('\n')}\n\nAnswer with one JSON object per line and nothing else, one line per word: {"i": <number>, "t": [...], "s": {...} (only if needed), "n": "<short reason in English>"}.`;
}

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
	if (stage !== 'c') return batch.items.filter((it) => !have.has(it.i));
	const sug = readAnswers(batch.suggest, ids());
	const a = readAnswers(batch.a, ids());
	const b = readAnswers(batch.b, ids());
	return batch.items.filter((it) => !have.has(it.i) && sug.has(it.i) && decide(sug.get(it.i), { a: a.get(it.i), b: b.get(it.i) }).review === 'disputed');
}

async function runBatch(lang, stage, file, byI, role) {
	for (let attempt = 0; attempt < 3; attempt++) {
		const batch = JSON.parse(readFileSync(file, 'utf8'));
		const todo = pending(stage, batch);
		if (!todo.length) return;
		const words = todo.map((it) => byI.get(it.i));
		const answer = await ask(prompt(lang, stage, role, words, batch));
		const want = new Set(todo.map((it) => it.i));
		const got = parseJsonLines(answer).filter((x) => want.has(x.i));
		const fresh = JSON.parse(readFileSync(file, 'utf8'));
		const known = new Set((fresh[stage] ?? []).map((x) => x.i));
		fresh[stage] = [...(fresh[stage] ?? []), ...got.filter((x) => !known.has(x.i) && (known.add(x.i), true))].sort((x, y) => x.i - y.i);
		writeFileSync(file, formatBatch(fresh));
		console.log(`${lang} ${stage} ${file.split('/').pop()}: ${got.length}/${todo.length} answered`);
	}
}

/** A batch file: the header as JSON, one item or answer per line. */
export function formatBatch(b) {
	const list = (xs) => `[\n${xs.map((x) => '  ' + JSON.stringify(x)).join(',\n')}\n ]`;
	const keys = ['items', 'suggest', 'a', 'b', 'c'].filter((k) => b[k]);
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
		for (let n = 0; n * BATCH < t.length; n++) {
			const items = t.slice(n * BATCH, (n + 1) * BATCH).map((w, k) => {
				const it = { i: n * BATCH + k + 1, key: w.key, form: w.form };
				if (w.reading) it.reading = w.reading;
				return it;
			});
			const file = join(dir, `batch-${String(n + 1).padStart(2, '0')}.json`);
			writeFileSync(file, formatBatch({ language: lang, batch: n + 1, reviewers: { suggest, a, b, c }, items }));
		}
		console.log(`${lang}: ${t.length} words in ${Math.ceil(t.length / BATCH)} batches`);
		return;
	}
	if (cmd !== 'run') throw new Error(`unknown command ${cmd}`);
	const [stage, ...more] = rest;
	if (!['suggest', 'a', 'b', 'c'].includes(stage)) throw new Error('stage: suggest, a, b or c');
	const o = opts(more);
	const t = targets(lang, o.list, inputs().picture(lang));
	const byI = new Map(t.map((w, k) => [k + 1, { ...w, i: k + 1 }]));
	const meta = JSON.parse(readFileSync(join(root, 'scripts/topics/reviewers.json'), 'utf8'))[lang].reviewers;
	const files = batchFiles(lang).filter((f) => !o.batches || o.batches.includes(Number(/batch-(\d+)/.exec(f)[1])));
	for (const f of files) {
		const b = JSON.parse(readFileSync(f, 'utf8'));
		for (const it of b.items) if (byI.get(it.i)?.form !== it.form) throw new Error(`${f}: item ${it.i} is ${it.form}, the list says ${byI.get(it.i)?.form}: plan again`);
	}
	const roleOf = (f) => {
		const b = JSON.parse(readFileSync(f, 'utf8'));
		return meta.find((r) => r.id === b.reviewers[stage]).role;
	};
	let next = 0;
	const worker = async () => {
		while (next < files.length) {
			const f = files[next++];
			try {
				await runBatch(lang, stage, f, byI, roleOf(f));
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
