#!/usr/bin/env node
// Extract the grammar outline (语法大纲) of the official HSK syllabus from
// `pdftotext -tsv` word boxes, into one JSON outline per level for the
// zh-grammar pack's authors.
//
// Source: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test,
// published 2025-11, effective 2026-07 (CLEC/CTI). The grammar outline is
// used as a topic index only; no syllabus text is reproduced, and neither
// the PDF nor any extracted text is committed (they are gitignored).
//
// Usage (a maintainer step; nothing here touches the network):
//
//   pdftotext -tsv -f 386 -l 405 syllabus.pdf grammar.tsv
//   node scripts/prepare-hsk-grammar.mjs grammar.tsv <outline-dir>
//
// The grammar outline is a table with four columns — 类别 (category),
// 类别名称 (subcategory), 细目 (item) and 语法内容 (content) — where the
// category and subcategory cells are merged vertically, so their text sits
// centred over the rows they span. The converter groups the word boxes of
// `pdftotext -tsv` by line, drops the watermark and the page furniture,
// maps the level headings, and carries the current category/subcategory/item
// forward. A row is one 细目 item, or a subcategory/category that has
// content of its own (no item). Merged cells make the exact row list
// ambiguous: the converter produces the best row list and the maintainer
// checks each level against the PDF before authoring.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class PackError extends Error {}

function fail(message) {
	throw new PackError(message);
}

// The level headings and the pack level they name.
const CN_LEVEL = { 一级: '1', 二级: '2', 三级: '3', 四级: '4', 五级: '5', 六级: '6', '七—九级': '7-9' };
const HEADING = /^HSK（(.+?)）语法$/;
// Column bounds of the grammar table (a word's left edge selects a column).
const CATEGORY = 105;
const SUBCATEGORY = 195;
const ITEM = 285;
// The 汉考国际 watermark glyphs are 48 pt tall, the table text 11–16 pt.
const WATERMARK_MIN_HEIGHT = 30;
// Words on one visual line share a top within about 1.6 pt (the item and
// content baselines differ); distinct lines are at least ~2.2 pt apart.
const LINE_TOLERANCE = 2.0;
// A page's header, level heading and carry-over labels all sit above the
// column header row; anything below this top is table content.
const CONTENT_MIN_TOP = 50;
const BARE_NUMBER = /^\d+$/;

// tsvWords returns the word boxes (level 5 rows) of `pdftotext -tsv` output.
export function tsvWords(text) {
	const lines = text.split(/\r?\n/);
	const head = lines[0]?.split('\t') ?? [];
	const want = ['level', 'page_num', 'par_num', 'block_num', 'line_num', 'word_num', 'left', 'top', 'width', 'height', 'conf', 'text'];
	if (head.join('\t') !== want.join('\t')) {
		fail('input: not `pdftotext -tsv` output (unexpected header line)');
	}
	const words = [];
	for (const line of lines.slice(1)) {
		if (line === '') continue;
		const f = line.split('\t');
		if (f[0] !== '5') continue;
		words.push({
			page: Number(f[1]),
			left: Number(f[6]),
			top: Number(f[7]),
			height: Number(f[9]),
			text: f.slice(11).join('\t')
		});
	}
	return words;
}

// lines groups the word boxes into visual lines in page/top order, dropping
// the watermark. Each line is { page, top, words } with words left-to-right.
function lines(words) {
	const kept = words.filter((w) => w.height <= WATERMARK_MIN_HEIGHT);
	kept.sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left);
	const out = [];
	for (const w of kept) {
		const last = out.at(-1);
		if (last && last.page === w.page && w.top - last.top <= LINE_TOLERANCE) {
			last.words.push(w);
			last.top = w.top;
		} else {
			out.push({ page: w.page, top: w.top, words: [w] });
		}
	}
	return out;
}

// parseGrammarTsv extracts the per-level grammar outline rows from
// `pdftotext -tsv` output. Each level is { name, rows }, a row
// { row, category, subcategory, item, content } where row numbers 1..N in
// page/top order and content is one string per content line.
export function parseGrammarTsv(text) {
	const levels = [];
	// The label being filled: a level owns one category/subcategory/item
	// chain; a label with no child and content of its own is a row.
	let level = null;

	const finalizeSubcategory = () => {
		const s = level.subcategory;
		if (s.name && !s.hasChild) {
			level.rows.push({ category: level.category.name, subcategory: s.name, item: '', content: s.content });
		}
	};
	const finalizeCategory = () => {
		const c = level.category;
		if (c.name && !c.hasChild) {
			level.rows.push({ category: c.name, subcategory: '', item: '', content: c.content });
		}
	};
	const startLevel = (name) => {
		if (level) {
			finalizeSubcategory();
			finalizeCategory();
		}
		level = {
			name,
			category: { name: '', hasChild: false, content: [] },
			subcategory: { name: '', hasChild: false, content: [] },
			item: null,
			rows: []
		};
		levels.push(level);
	};

	for (const line of lines(tsvWords(text))) {
		const words = line.words;
		const heading = words.find((w) => HEADING.test(w.text));
		if (heading) {
			const num = CN_LEVEL[HEADING.exec(heading.text)[1]];
			startLevel(num === '7-9' ? 'HSK 7–9' : `HSK ${num}`);
			continue;
		}
		if (!level) continue;
		if (words.some((w) => w.text === '语法内容')) continue; // the column header row
		if (line.top < CONTENT_MIN_TOP) continue; // carry-over labels repeated at a page top
		if (words.every((w) => BARE_NUMBER.test(w.text))) continue; // page numbers and footnote markers

		const category = words.filter((w) => w.left < CATEGORY).map((w) => w.text).join('');
		const subcategory = words.filter((w) => w.left >= CATEGORY && w.left < SUBCATEGORY).map((w) => w.text).join('');
		const item = words.filter((w) => w.left >= SUBCATEGORY && w.left < ITEM).map((w) => w.text).join('');
		const content = words.filter((w) => w.left >= ITEM).map((w) => w.text).join('');

		if (category) {
			finalizeSubcategory();
			finalizeCategory();
			level.category = { name: category, hasChild: false, content: [] };
			level.subcategory = { name: '', hasChild: false, content: [] };
			level.item = null;
		}
		if (subcategory) {
			finalizeSubcategory();
			level.subcategory = { name: subcategory, hasChild: false, content: [] };
			level.category.hasChild = true;
			level.item = null;
		}
		if (item) {
			level.item = { category: level.category.name, subcategory: level.subcategory.name, item, content: [] };
			level.subcategory.hasChild = true;
			level.rows.push(level.item);
		}
		if (content) {
			if (level.item) level.item.content.push(content);
			else if (level.subcategory.name) level.subcategory.content.push(content);
			else if (level.category.name) level.category.content.push(content);
		}
	}
	if (level) {
		finalizeSubcategory();
		finalizeCategory();
	}
	for (const lv of levels) lv.rows.forEach((row, i) => (row.row = i + 1));
	return { levels: levels.map(({ name, rows }) => ({ name, rows })) };
}

// outlinePath maps a level name to its outline file name.
export function outlinePath(name) {
	return `${name.toLowerCase().replace('7–9', '7-9').replace(' ', '-')}.json`;
}

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

async function readInput(path, encoding) {
	try {
		return await readFile(path, encoding);
	} catch (err) {
		fail(`cannot read ${path}: ${err.code ?? err.message}`);
	}
}

export async function convert(tsvPath, outlineDir) {
	const text = await readInput(tsvPath, 'utf8');
	const { levels } = parseGrammarTsv(text);
	if (levels.length === 0) fail('input: no grammar outline (HSK（…）语法) found');
	const dir = resolve(outlineDir);
	await mkdir(dir, { recursive: true });
	for (const lv of levels) await writeFile(join(dir, outlinePath(lv.name)), json(lv));
	return { levels, dir };
}

async function main(argv) {
	const args = [...argv];
	if (args.length !== 2 || args[0].startsWith('-')) {
		fail('usage: node scripts/prepare-hsk-grammar.mjs <grammar.tsv> <outline-dir>');
	}
	const { levels, dir } = await convert(resolve(args[0]), resolve(args[1]));
	for (const lv of levels) {
		console.log(`wrote ${join(dir, outlinePath(lv.name))}: ${lv.rows.length} rows`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err instanceof PackError ? `prepare-hsk-grammar: ${err.message}` : err);
		process.exit(1);
	});
}
