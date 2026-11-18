#!/usr/bin/env node
// Build and validate the zh-grammar pack: merge the per-level authored
// fragments under plugins/data/zh-grammar/authored into the shipped
// lessons.json and a reviewable COVERAGE.md.
//
// Usage:
//
//   node scripts/build-grammar-pack.mjs [--check] [--complete]
//       [--authored <dir>] [--out <dir>]
//
// Defaults: --authored plugins/data/zh-grammar/authored and
// --out plugins/data/zh-grammar. --check validates and writes nothing;
// --complete additionally requires all seven fragments, every syllabus row
// 1..level.rows to appear at least once, and 300–500 lessons in total.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class PackError extends Error {}

function fail(message) {
	throw new PackError(message);
}

// The pack's seven levels in difficulty order. The row counts are the
// corrected, binding syllabus row counts (the original plan under-counted
// HSK 1 by 数词, 连接词语或短语 and 叹词, and HSK 2 by one row).
export const LEVELS = [
	{ id: 'hsk-1', name: 'Level 1 · First sentences', schemeLevel: 'HSK 1', rows: 48 },
	{ id: 'hsk-2', name: 'Level 2 · Everyday basics', schemeLevel: 'HSK 2', rows: 61 },
	{ id: 'hsk-3', name: 'Level 3 · Getting around', schemeLevel: 'HSK 3', rows: 56 },
	{ id: 'hsk-4', name: 'Level 4 · Connected speech', schemeLevel: 'HSK 4', rows: 46 },
	{ id: 'hsk-5', name: 'Level 5 · Nuance and attitude', schemeLevel: 'HSK 5', rows: 39 },
	{ id: 'hsk-6', name: 'Level 6 · Formal ground', schemeLevel: 'HSK 6', rows: 30 },
	{ id: 'hsk-7-9', name: 'Level 7 · Mastery', schemeLevel: 'HSK 7–9', rows: 27 }
];

// Every grammar level badges against the hsk-words scheme.
const SCHEME = 'hsk-words';
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KINDS = new Set(['similar', 'clearly-wrong']);
const HTML_OR_MARKDOWN = /[<>[\]*`]/;

const runes = (s) => Array.from(s).length;

function checkText(path, s, required, max) {
	if (required && (typeof s !== 'string' || s.trim() === '')) fail(`${path}: is required`);
	if (typeof s === 'string' && runes(s) > max) fail(`${path}: ${runes(s)} characters, at most ${max}`);
}

function checkID(path, id) {
	if (typeof id !== 'string' || !ID.test(id)) {
		fail(`${path}: ${JSON.stringify(id)} is not a valid id (lowercase letters, digits and single hyphens)`);
	}
}

// readFragment returns the merged rows of a level's authored fragment(s):
// <id>.json and any <id>-part-*.json, in filename order. It returns null
// when the level has no fragment yet.
async function readFragment(authoredDir, id) {
	let entries;
	try {
		entries = await readdir(authoredDir);
	} catch (err) {
		if (err.code === 'ENOENT') return null; // nothing authored yet
		throw err;
	}
	const files = entries
		.filter((f) => f === `${id}.json` || (f.startsWith(`${id}-part-`) && f.endsWith('.json')))
		.sort();
	if (files.length === 0) return null;
	const rows = [];
	let level;
	for (const f of files) {
		let frag;
		try {
			frag = JSON.parse(await readFile(join(authoredDir, f), 'utf8'));
		} catch (err) {
			fail(`${f}: not valid JSON: ${err.message}`);
		}
		if (level === undefined) level = frag.level;
		for (const row of frag.rows ?? []) rows.push(row);
	}
	return { level, rows };
}

// validateLesson checks one lesson against the schema and the pack's content
// rules, pushing its example ids and its contrast count. The path is the
// row's prefix, for example "hsk-1 rows[3]".
function validateLesson(path, lesson, levelId, lessonIds, exampleIds) {
	checkID(`${path}.lesson.id`, lesson.id);
	if (lessonIds.has(lesson.id)) fail(`${path}.lesson.id: ${JSON.stringify(lesson.id)} is used twice`);
	lessonIds.add(lesson.id);
	if (lesson.level !== levelId) fail(`${path}.lesson.level: ${JSON.stringify(lesson.level)} != ${JSON.stringify(levelId)}`);

	checkText(`${path}.lesson.title`, lesson.title, true, 120);
	checkText(`${path}.lesson.summary`, lesson.summary, true, 300);

	if (!Array.isArray(lesson.pattern) || lesson.pattern.length < 1 || lesson.pattern.length > 3) {
		fail(`${path}.lesson.pattern: ${Array.isArray(lesson.pattern) ? lesson.pattern.length : 0} lines, want 1 to 3`);
	}
	lesson.pattern.forEach((line, j) => checkText(`${path}.lesson.pattern[${j}]`, line, true, 120));

	if (!Array.isArray(lesson.body) || lesson.body.length < 1 || lesson.body.length > 4) {
		fail(`${path}.lesson.body: ${Array.isArray(lesson.body) ? lesson.body.length : 0} paragraphs, want 1 to 4`);
	}
	lesson.body.forEach((para, j) => {
		checkText(`${path}.lesson.body[${j}]`, para, true, 2000);
		if (typeof para === 'string' && HTML_OR_MARKDOWN.test(para)) fail(`${path}.lesson.body[${j}]: no HTML or Markdown`);
	});

	const examples = lesson.examples;
	if (!Array.isArray(examples) || examples.length < 4 || examples.length > 8) {
		fail(`${path}.lesson.examples: ${Array.isArray(examples) ? examples.length : 0} examples, want 4 to 8`);
	}
	let contrasts = 0;
	examples.forEach((ex, j) => {
		const ep = `${path}.lesson.examples[${j}]`;
		checkID(`${ep}.id`, ex.id);
		if (exampleIds.has(ex.id)) fail(`${ep}.id: ${JSON.stringify(ex.id)} is used twice`);
		exampleIds.add(ex.id);
		checkText(`${ep}.text`, ex.text, true, 500);
		checkText(`${ep}.reading`, ex.reading, true, 500);
		checkText(`${ep}.translation`, ex.translation, true, 500);
		checkText(`${ep}.focus`, ex.focus, true, 500);
		if (typeof ex.focus === 'string' && typeof ex.text === 'string' && count(ex.text, ex.focus) !== 1) {
			fail(`${ep}.focus: ${JSON.stringify(ex.focus)} occurs ${count(ex.text, ex.focus)} times in text, want 1`);
		}
		const distractors = ex.distractors;
		if (!Array.isArray(distractors) || distractors.length < 2 || distractors.length > 4) {
			fail(`${ep}.distractors: ${Array.isArray(distractors) ? distractors.length : 0} distractors, want 2 to 4`);
		}
		const seen = new Set();
		distractors.forEach((d, k) => {
			const dp = `${ep}.distractors[${k}]`;
			if (typeof d !== 'string' || d.trim() === '') fail(`${dp}: must not be empty`);
			if (d === ex.focus) fail(`${dp}: ${JSON.stringify(d)} equals focus`);
			if (seen.has(d)) fail(`${dp}: ${JSON.stringify(d)} is listed twice`);
			seen.add(d);
		});
		if (typeof ex.contrast !== 'boolean') fail(`${ep}.contrast: must be a boolean`);
		if (ex.contrast) contrasts++;
		if (!Array.isArray(ex.kinds) || !ex.kinds.includes('clearly-wrong')) {
			fail(`${ep}.kinds: must include "clearly-wrong"`);
		}
		for (const kind of ex.kinds) if (!KINDS.has(kind)) fail(`${ep}.kinds: ${JSON.stringify(kind)} is not a valid kind`);
	});
	if (contrasts < 1 || contrasts > 2) fail(`${path}.lesson: ${contrasts} contrast examples, want 1 to 2`);
}

function count(haystack, needle) {
	if (needle === '') return 0;
	return haystack.split(needle).length - 1;
}

// renderLessons is the lessons.json object: the seven levels in LEVELS
// order and the lessons in level/row/split order, with the authoring
// metadata (contrast, kinds) stripped.
export function renderLessons(levels, lessons) {
	const index = new Map(levels.map((lv, i) => [lv.id, i]));
	const ordered = lessons
		.map((l, i) => ({ ...l, i }))
		.sort((a, b) => index.get(a.levelId) - index.get(b.levelId) || a.row - b.row || a.i - b.i);
	return {
		levels: levels.map((lv) => ({ id: lv.id, name: lv.name, schemeLevels: [{ scheme: SCHEME, level: lv.schemeLevel }] })),
		lessons: ordered.map(({ lesson }) => ({
			id: lesson.id,
			level: lesson.level,
			title: lesson.title,
			summary: lesson.summary,
			pattern: lesson.pattern,
			body: lesson.body,
			examples: lesson.examples.map(({ contrast, kinds, ...example }) => example)
		}))
	};
}

const SOURCE_PARAGRAPH =
	'Topic coverage follows the grammar outline (语法大纲) of the 《HSK 考试大纲》 / Syllabus for the\n' +
	'Chinese Proficiency Test, CLEC/CTI, 2025-11 (effective 2026-07). The outline is used as a topic\n' +
	'index only: the lesson grouping and order, explanations, examples and exercises are qinqin\u2019s own,\n' +
	'and no syllabus text is reproduced. The syllabus grants no reuse licence.';

// renderCoverage is COVERAGE.md: a heading, the source paragraph, then one
// table per level mapping every syllabus row to its lesson id (or ids).
export function renderCoverage(levels, lessons) {
	const byLevel = new Map();
	for (const l of lessons) {
		if (!byLevel.has(l.levelId)) byLevel.set(l.levelId, new Map());
		const byRow = byLevel.get(l.levelId);
		if (!byRow.has(l.row)) byRow.set(l.row, []);
		byRow.get(l.row).push(l);
	}
	const lines = ['# Chinese grammar — HSK coverage', '', SOURCE_PARAGRAPH, ''];
	for (const lv of levels) {
		const byRow = byLevel.get(lv.id) ?? new Map();
		lines.push(`## ${lv.name}`, '', '| # | Syllabus row (qinqin\u2019s words) | Lesson(s) |', '|---|-------------------------------|-----------|');
		for (let row = 1; row <= lv.rows; row++) {
			const entries = byRow.get(row) ?? [];
			const label = entries.map((l) => l.label).join(' / ');
			const ids = entries.map((l) => l.lesson.id).join(', ');
			lines.push(`| ${row} | ${label} | ${entries.length ? ids : 'not authored yet'} |`);
		}
		lines.push('');
	}
	return lines.join('\n') + '\n';
}

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

// buildGrammarPack reads the authored fragments in LEVELS order, validates
// them against the schema and the pack's content rules, and — unless
// check — writes lessons.json and COVERAGE.md. It returns the covered row
// count and the lesson count.
export async function buildGrammarPack({ authoredDir, outDir, levels = LEVELS, check = false, complete = false }) {
	const lessons = [];
	const lessonIds = new Set();
	const exampleIds = new Set();
	const covered = new Map();
	let rows = 0;

	for (const lv of levels) {
		const fragment = await readFragment(authoredDir, lv.id);
		if (!fragment) {
			if (complete) fail(`${lv.id}: no authored fragment (--complete requires all seven)`);
			continue;
		}
		rows += lv.rows;
		covered.set(lv.id, new Set());
		if (fragment.level?.id !== lv.id) {
			fail(`${lv.id}: fragment level ${JSON.stringify(fragment.level?.id)} != ${JSON.stringify(lv.id)}`);
		}
		const labelsByRow = new Map();
		fragment.rows.forEach((entry, i) => {
			const path = `${lv.id} rows[${i}]`;
			const row = entry?.row;
			if (!Number.isInteger(row) || row < 1 || row > lv.rows) fail(`${path}: missing row number`);
			const label = entry?.label;
			if (typeof label !== 'string' || label.trim() === '') fail(`${path}.label: is required`);
			if (labelsByRow.has(row)) {
				if (labelsByRow.get(row).has(label)) fail(`${path}: row ${row} appears twice with the same label`);
				labelsByRow.get(row).add(label);
			} else {
				labelsByRow.set(row, new Set([label]));
			}
			const lesson = entry?.lesson;
			if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) fail(`${path}.lesson: is required`);
			validateLesson(path, lesson, lv.id, lessonIds, exampleIds);
			covered.get(lv.id).add(row);
			lessons.push({ lesson, levelId: lv.id, row, label });
		});
	}

	if (lessons.length === 0) fail('no lessons authored (write at least one authored fragment)');

	if (complete) {
		for (const lv of levels) {
			const seen = covered.get(lv.id);
			if (!seen) fail(`${lv.id}: no authored fragment (--complete requires all seven)`);
			for (let row = 1; row <= lv.rows; row++) {
				if (!seen.has(row)) fail(`${lv.id}: row ${row} is not authored`);
			}
		}
		if (lessons.length < 300 || lessons.length > 500) {
			fail(`lessons: ${lessons.length} lessons, want 300 to 500`);
		}
	}

	if (!check) {
		await mkdir(outDir, { recursive: true });
		await writeFile(join(outDir, 'lessons.json'), json(renderLessons(levels, lessons)));
		await writeFile(join(outDir, 'COVERAGE.md'), renderCoverage(levels, lessons));
	}
	return { rows, lessons: lessons.length };
}

async function main(argv) {
	const args = [...argv];
	const flag = (name) => {
		const i = args.indexOf(name);
		if (i < 0) return '';
		const value = args[i + 1] ?? '';
		if (!value) fail(`${name} needs a value`);
		args.splice(i, 2);
		return value;
	};
	const authored = flag('--authored');
	const out = flag('--out');
	const check = args.includes('--check');
	const complete = args.includes('--complete');
	if (args.some((a) => a !== '--check' && a !== '--complete')) {
		fail('usage: node scripts/build-grammar-pack.mjs [--check] [--complete] [--authored <dir>] [--out <dir>]');
	}
	const root = fileURLToPath(new URL('..', import.meta.url));
	const authoredDir = authored ? resolve(authored) : join(root, 'plugins', 'data', 'zh-grammar', 'authored');
	const outDir = out ? resolve(out) : join(root, 'plugins', 'data', 'zh-grammar');
	const result = await buildGrammarPack({ authoredDir, outDir, check, complete });
	console.log(`${result.rows} rows, ${result.lessons} lessons`);
	if (!check) console.log(`wrote ${join(outDir, 'lessons.json')} and ${join(outDir, 'COVERAGE.md')}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err instanceof PackError ? `build-grammar-pack: ${err.message}` : err);
		process.exit(1);
	});
}
