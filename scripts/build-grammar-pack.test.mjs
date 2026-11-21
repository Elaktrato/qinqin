// Tests of the grammar pack builder (zh-grammar and ja-grammar), on a two-row fixture level (not the
// real seven levels): node --test scripts/build-grammar-pack.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JA_LEVELS, LEVELS, PACKS, PackError, buildGrammarPack } from './build-grammar-pack.mjs';

const FIXTURE_LEVELS = [{ id: 'x', name: 'X', schemeLevel: 'HSK 1', rows: 2 }];

// example is one valid example; the contrast example tests a similar point.
const example = (id, contrast = false) => ({
	id,
	text: contrast ? '我去过了。' : '我是学生。',
	reading: contrast ? 'wǒ qùguo le.' : 'wǒ shì xuéshēng.',
	translation: 'translation',
	focus: contrast ? '过' : '是',
	distractors: contrast ? ['了', '在'] : ['很', '在'],
	contrast,
	kinds: contrast ? ['similar', 'clearly-wrong'] : ['clearly-wrong']
});

// lesson is a valid four-example lesson with one contrast example.
const lesson = (id) => ({
	id,
	level: 'x',
	title: 'title',
	summary: 'summary',
	pattern: ['A + B'],
	body: ['explanation'],
	examples: [example(`${id}-1`), example(`${id}-2`), example(`${id}-3`), example(`${id}-4`, true)]
});

// fragment is a valid two-row fragment.
const fragment = () => ({
	level: { id: 'x', name: 'X', schemeLevels: [{ scheme: 'hsk-words', level: 'HSK 1' }] },
	rows: [
		{ row: 1, label: 'label one', lesson: lesson('l1') },
		{ row: 2, label: 'label two', lesson: lesson('l2') }
	]
});

// errorOf writes a fragment to a temp authored dir and returns the build's
// error message ('' when it passes).
async function errorOf(frag) {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		writeFileSync(join(dir, 'x.json'), JSON.stringify(frag, null, 2));
		try {
			await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS });
			return '';
		} catch (err) {
			return err.message;
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('a valid fragment builds lessons.json and COVERAGE.md', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		writeFileSync(join(dir, 'x.json'), JSON.stringify(fragment(), null, 2));
		const result = await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS });
		assert.deepEqual(result, { rows: 2, lessons: 2 });

		const lessons = JSON.parse(readFileSync(join(dir, 'lessons.json'), 'utf8'));
		assert.equal(lessons.levels.length, 1);
		assert.deepEqual(lessons.levels[0], {
			id: 'x',
			name: 'X',
			schemeLevels: [{ scheme: 'hsk-words', level: 'HSK 1' }]
		});
		assert.deepEqual(lessons.lessons.map((l) => l.id), ['l1', 'l2']);
		for (const l of lessons.lessons) {
			assert.equal(l.examples.length, 4);
			for (const ex of l.examples) {
				assert.equal('contrast' in ex, false);
				assert.equal('kinds' in ex, false);
			}
		}

		const coverage = readFileSync(join(dir, 'COVERAGE.md'), 'utf8');
		assert.match(coverage, /\| 1 \| label one \| l1 \|/);
		assert.match(coverage, /\| 2 \| label two \| l2 \|/);
		assert.doesNotMatch(coverage, /not authored yet/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('passes noOrder through and still strips contrast and kinds', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		const frag = fragment();
		frag.rows[0].lesson.examples[0].noOrder = true;
		writeFileSync(join(dir, 'x.json'), JSON.stringify(frag, null, 2));
		await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS });
		const lessons = JSON.parse(readFileSync(join(dir, 'lessons.json'), 'utf8'));
		const flagged = lessons.lessons[0].examples[0];
		assert.equal(flagged.noOrder, true);
		assert.equal('contrast' in flagged, false);
		assert.equal('kinds' in flagged, false);
		// An example without the flag omits it entirely.
		assert.equal('noOrder' in lessons.lessons[0].examples[1], false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a subset of rows is accepted and marked not authored yet', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		const frag = fragment();
		frag.rows.pop();
		writeFileSync(join(dir, 'x.json'), JSON.stringify(frag, null, 2));
		const result = await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS });
		assert.deepEqual(result, { rows: 2, lessons: 1 });
		const coverage = readFileSync(join(dir, 'COVERAGE.md'), 'utf8');
		assert.match(coverage, /\| 1 \| label one \| l1 \|/);
		assert.match(coverage, /\| 2 \|  \| not authored yet \|/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a split row lists both lessons under one syllabus row', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		const frag = fragment();
		frag.rows[1] = { row: 1, label: 'label one b', lesson: lesson('l2') };
		writeFileSync(join(dir, 'x.json'), JSON.stringify(frag, null, 2));
		const result = await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS });
		assert.deepEqual(result, { rows: 2, lessons: 2 });
		const coverage = readFileSync(join(dir, 'COVERAGE.md'), 'utf8');
		assert.match(coverage, /\| 1 \| label one \/ label one b \| l1, l2 \|/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a row above the level floor is valid and appears in COVERAGE.md', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		const frag = fragment();
		frag.rows.push({ row: 3, label: 'label three', lesson: lesson('l3') });
		writeFileSync(join(dir, 'x.json'), JSON.stringify(frag, null, 2));
		const result = await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS });
		assert.deepEqual(result, { rows: 2, lessons: 3 });
		const lessons = JSON.parse(readFileSync(join(dir, 'lessons.json'), 'utf8'));
		assert.deepEqual(lessons.lessons.map((l) => l.id), ['l1', 'l2', 'l3']);
		const coverage = readFileSync(join(dir, 'COVERAGE.md'), 'utf8');
		assert.match(coverage, /\| 3 \| label three \| l3 \|/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('--complete requires every row up to the floor but allows rows above it', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		// Rows 1 and 3, with row 2 missing: the floor (rows 1..2) is not met.
		const frag = fragment();
		frag.rows = [frag.rows[0], { row: 3, label: 'label three', lesson: lesson('l3') }];
		writeFileSync(join(dir, 'x.json'), JSON.stringify(frag, null, 2));
		await assert.rejects(
			buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS, complete: true }),
			(err) => err instanceof PackError && err.message.includes('x: row 2 is not authored')
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

const rejections = [
	['three examples', (f) => (f.rows[0].lesson.examples = f.rows[0].lesson.examples.slice(0, 3)), 'rows[0].lesson.examples: 3 examples'],
	['a focus that occurs twice', (f) => (f.rows[0].lesson.examples[0].text = '我是学生，是。'), 'rows[0].lesson.examples[0].focus'],
	['a distractor equal to the focus', (f) => (f.rows[0].lesson.examples[0].distractors[0] = '是'), 'rows[0].lesson.examples[0].distractors[0]'],
	['two identical distractors', (f) => (f.rows[0].lesson.examples[0].distractors[1] = '很'), 'rows[0].lesson.examples[0].distractors[1]'],
	['no contrast example', (f) => f.rows[0].lesson.examples.forEach((e) => (e.contrast = false)), 'rows[0].lesson: 0 contrast examples'],
	['three contrast examples', (f) => f.rows[0].lesson.examples.forEach((e, i) => (e.contrast = i < 3)), 'rows[0].lesson: 3 contrast examples'],
	['a missing row number', (f) => delete f.rows[0].row, 'rows[0]: row must be a positive integer'],
	['a duplicate row number with the same label', (f) => ((f.rows[1].row = 1), (f.rows[1].label = 'label one')), 'rows[1]: row 1 appears twice'],
	['a duplicate lesson id', (f) => (f.rows[1].lesson.id = 'l1'), 'rows[1].lesson.id'],
	['a non-boolean noOrder', (f) => (f.rows[0].lesson.examples[0].noOrder = 'yes'), 'rows[0].lesson.examples[0].noOrder'],
	['a body containing <b>', (f) => (f.rows[0].lesson.body[0] = 'text <b>bold</b>'), 'rows[0].lesson.body[0]']
];

for (const [name, mutate, path] of rejections) {
	test(`rejects ${name}`, async () => {
		const frag = fragment();
		mutate(frag);
		const message = await errorOf(frag);
		assert.ok(message.includes(path), `message ${JSON.stringify(message)} does not name ${JSON.stringify(path)}`);
	});
}

test('LEVELS is the seven binding levels', () => {
	assert.deepEqual(
		LEVELS.map((l) => [l.id, l.rows]),
		[
			['hsk-1', 48],
			['hsk-2', 61],
			['hsk-3', 57],
			['hsk-4', 46],
			['hsk-5', 39],
			['hsk-6', 31],
			['hsk-7-9', 40]
		]
	);
	assert.equal(LEVELS[6].schemeLevel, 'HSK 7–9');
	assert.equal(LEVELS.reduce((n, l) => n + l.rows, 0), 322);
});

test('--check validates without writing, and PackError is the failure type', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		writeFileSync(join(dir, 'x.json'), JSON.stringify(fragment(), null, 2));
		const result = await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS, check: true });
		assert.deepEqual(result, { rows: 2, lessons: 2 });
		assert.throws(() => readFileSync(join(dir, 'lessons.json')), /ENOENT/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
	const frag = fragment();
	frag.rows[0].lesson.examples = frag.rows[0].lesson.examples.slice(0, 3);
	const message = await errorOf(frag);
	assert.ok(message.includes('rows[0].lesson.examples'), message);
});

test('JA_LEVELS is the five Japanese levels with the jlpt-kanji badges', () => {
	assert.deepEqual(
		JA_LEVELS.map((l) => [l.id, l.schemeLevel, l.rows]),
		[
			['n5', 'N5', 40],
			['n4', 'N4', 46],
			['n3', 'N3', 57],
			['n2', 'N2', 55],
			['n1', 'N1', 60]
		]
	);
	assert.equal(PACKS.ja.levels, JA_LEVELS);
	assert.equal(PACKS.zh.levels, LEVELS);
});

test('the ja pack renders its own scheme, heading and coverage column', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'grammar-'));
	try {
		writeFileSync(join(dir, 'x.json'), JSON.stringify(fragment(), null, 2));
		await buildGrammarPack({ authoredDir: dir, outDir: dir, levels: FIXTURE_LEVELS, pack: PACKS.ja });
		const lessons = JSON.parse(readFileSync(join(dir, 'lessons.json'), 'utf8'));
		assert.deepEqual(lessons.levels[0].schemeLevels, [{ scheme: 'jlpt-kanji', level: 'HSK 1' }]);
		const coverage = readFileSync(join(dir, 'COVERAGE.md'), 'utf8');
		assert.ok(coverage.startsWith('# Japanese grammar — coverage\n'));
		assert.ok(coverage.includes('Grammar point (qinqin\u2019s selection)'));
		assert.ok(coverage.includes('The JLPT publishes no grammar list.'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
