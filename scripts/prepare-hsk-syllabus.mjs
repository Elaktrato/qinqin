#!/usr/bin/env node
// Convert the word list and the character list of the official HSK syllabus
// into the qinqin level packs hsk-words ("HSK 3.0 (words)") and hsk-chars
// ("HSK 3.0 (characters)").
//
// Source: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test,
// published 2025-11, effective 2026-07, issued by 中外语言交流合作中心
// (Center for Language Education and Cooperation, CLEC), distributed by
// Chinese Testing International (CTI) via https://www.chinesetest.cn. The
// PDF (406 pages) is
//
//   https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf
//
// Its part "HSK 词汇大纲" is a table printed from a spreadsheet: serial
// number, level (1–6 or 7-9), word, pinyin, part of speech. Its part
// "HSK 汉字大纲" lists characters in numbered columns ("1. 爱"): one
// 认读字 (characters to recognise) list per level, HSK（一级）认读字 …
// HSK（七—九级）认读字, then 书写字 (characters to write) lists,
// HSK（一级）~（二级）书写字, HSK（三级）书写字 … HSK（七—九级）书写字.
//
// No reuse licence is granted for the syllabus. The CTI site's Legal Notice
// (https://www.chinesetest.cn/legal-notice) says its content is copyrighted
// by CTI or the content providers, requires the source to be indicated, and
// permits reproduction only as reasonable, good-faith quoting for
// informative public use; the PDF carries a copy-protection flag. The
// project includes only the word list and the recognition character list,
// as plain lists with levels (and pinyin readings), nothing else of the
// syllabus, with attribution at the project owner's decision; the legal
// status of including these lists has not been verified (see
// LICENCE_SECTION). Never commit the PDF or any text
// extracted from it (they are gitignored): only the generated packs are
// committed.
//
// Usage (a maintainer step; nothing here touches the network):
//
//   curl -fsSLo syllabus.pdf '<the PDF URL above>'
//   pdftotext -tsv syllabus.pdf syllabus.tsv          # poppler-utils
//   node scripts/prepare-hsk-syllabus.mjs syllabus.tsv [<packs-dir>] [--pdf syllabus.pdf]
//
// Keep both files outside the repository. The converter reads the TSV word
// boxes of `pdftotext -tsv`, not `pdftotext -layout` text: the layout mode
// misplaces cells of this table (a row's pinyin lands in the column header
// line, runs of rows print column by column, and the diagonal 汉考国际
// watermark interleaves with the rows), while the word boxes keep every
// cell's coordinates. It (re)writes the pack directories hsk-words and
// hsk-chars under <packs-dir> (default plugins/data): manifest.json,
// levels.json and ATTRIBUTION.md each. With --pdf, ATTRIBUTION.md records the PDF's SHA-256; the
// committed pack was generated with it, so pass --pdf to reproduce it byte
// for byte. The output depends only on the inputs.
//
// Parsing rules (see parseSyllabusTSV):
// - a table page is a page whose header row holds 序号 等级 词语 拼音 词性;
//   the column bounds are the midpoints between those header words;
// - the 汉考国际 watermark (glyphs taller than any table text) is dropped;
// - a row is anchored on its serial number; every other cell joins the row
//   whose vertical centre is nearest (pinyin glyphs sit a little higher);
// - the page number below the table is dropped; any other text off the rows
//   is an error;
// - the level cell is the word's level, optionally followed by levels in
//   parentheses ("1（4）", apparently those of the parenthesised parts of
//   speech, "数、（副）"): the first one is the word's level;
// - a trailing 1 or 2 numbers homographs (本1, 本2): it is removed, and each
//   keeps its own pinyin; the same form with the same reading listed again
//   is kept once, at its lowest level;
// - the pinyin is passed as the entry's reading, the first one where the
//   syllabus gives alternatives ("shéi/shuí"); the importer compares it
//   toneless with the dictionary's pinyin;
// - the serial numbers must run 1..N with no gap or duplicate, and every
//   row needs a level, a written form of Han characters and a pinyin;
//   otherwise the conversion fails and names the rows.
//
// Character lists (see parseCharacterLists):
// - the section starts at the first "HSK（…）认读字" heading and ends at the
//   first page after it with no numbered item; each heading starts a list;
// - the watermark is dropped by glyph height as above, never by character
//   value: 汉, 考, 国 and 际 are listed characters too;
// - an item is a number "N." with the one Han character to its right on the
//   same line (or both in one box, "169.四"); the page number is dropped,
//   and any other text on the list pages is an error;
// - each list must number 1..N with no gap or duplicate;
// - a character's level is the level of the 认读字 list that lists it (the
//   lowest one, should one repeat); the 书写字 lists assign no level, their
//   sizes are reported and they must list only characters recognised at or
//   below their level.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PDF_URL =
	'https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf';

// The syllabus's levels in easy-to-hard order and the pack's level names.
export const LEVELS = [
	['1', 'HSK 1'],
	['2', 'HSK 2'],
	['3', 'HSK 3'],
	['4', 'HSK 4'],
	['5', 'HSK 5'],
	['6', 'HSK 6'],
	['7-9', 'HSK 7–9']
];

const HEADERS = ['序号', '等级', '词语', '拼音', '词性'];
const LEVEL = '(?:[1-6]|7-9)';
const LEVEL_CELL = new RegExp(`^(${LEVEL})((?:（${LEVEL}）)*)$`);
const SERIAL = /^\d+$/;
const WORD_CELL = /^(\p{Script=Han}+)([12]?)$/u;
const WATERMARK_MIN_HEIGHT = 30; // table text is 11–16 pt tall, the watermark 48

export class PackError extends Error {}

function fail(message) {
	throw new PackError(message);
}

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
			width: Number(f[8]),
			height: Number(f[9]),
			text: f.slice(11).join('\t')
		});
	}
	return words;
}

// edition reads the publication and effective dates from the title page
// ("2025-11 发布", "2026-07 实施") and checks it is the HSK syllabus.
export function edition(words) {
	const firstPage = words.reduce((min, w) => Math.min(min, w.page), Infinity);
	const first = words.filter((w) => w.page === firstPage);
	const texts = first.map((w) => w.text);
	if (!texts.includes('考试大纲') || !texts.includes('中外语言交流合作中心')) {
		fail('input: the first page is not the title page of the HSK 考试大纲 (CLEC)');
	}
	const dated = (label) => {
		const i = texts.indexOf(label);
		const date = texts.slice(0, i).reverse().find((t) => /^\d{4}-\d{2}$/.test(t));
		if (i < 0 || !date) fail(`input: no "<yyyy-mm> ${label}" date on the title page`);
		return date;
	};
	return { published: dated('发布'), effective: dated('实施') };
}

// parseSyllabusTSV extracts the vocabulary rows of the syllabus from its
// word boxes. It returns { rows, report }: rows in serial order, each
// { serial, level, extra, word, homograph, pinyin, pos, page }.
export function parseSyllabusTSV(text) {
	const words = tsvWords(text);
	const report = { watermark: 0, pageNumbers: 0, tablePages: [] };
	const byPage = new Map();
	for (const w of words) {
		if (w.height >= WATERMARK_MIN_HEIGHT) {
			report.watermark++;
			continue;
		}
		if (!byPage.has(w.page)) byPage.set(w.page, []);
		byPage.get(w.page).push(w);
	}

	const rows = [];
	const errors = [];
	for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
		const ws = byPage.get(page);
		const header = tableHeader(ws);
		if (!header) continue;
		report.tablePages.push(page);
		const bounds = header.lefts.slice(1).map((x, i) => (header.lefts[i] + x) / 2);
		const column = (w) => {
			const x = w.left;
			let c = bounds.findIndex((b) => x < b);
			if (c < 0) c = bounds.length;
			return c;
		};
		const below = ws.filter((w) => w.top > header.bottom);
		const anchors = below
			.filter((w) => column(w) === 0 && SERIAL.test(w.text))
			.map((w) => ({ w, cy: w.top + w.height / 2, cells: [[], [], [], [], []] }))
			.sort((a, b) => a.cy - b.cy);
		if (anchors.length === 0) continue;
		const pitch =
			anchors.length > 1 ? (anchors.at(-1).cy - anchors[0].cy) / (anchors.length - 1) : 17;
		const reach = Math.min(pitch / 2, 8);
		const lastCy = anchors.at(-1).cy;
		const sorted = [...below].sort((a, b) => a.left - b.left || a.top - b.top);
		for (const w of sorted) {
			const cy = w.top + w.height / 2;
			let best = null;
			let d = Infinity;
			for (const a of anchors) {
				const dd = Math.abs(a.cy - cy);
				if (dd < d) {
					d = dd;
					best = a;
				}
			}
			if (d > reach) {
				if (cy > lastCy && SERIAL.test(w.text)) {
					report.pageNumbers++;
					continue;
				}
				errors.push(`page ${page}: text off the rows: ${JSON.stringify(w.text)}`);
				continue;
			}
			best.cells[column(w)].push(w.text);
		}
		for (const a of anchors) {
			const [serialCell, levelCell, wordCell, pinyinCell, posCell] = a.cells;
			const serial = Number(serialCell.join(''));
			const where = `page ${page}, serial ${serial}`;
			const lv = LEVEL_CELL.exec(levelCell.join(''));
			if (!lv) {
				errors.push(`${where}: unexpected level ${JSON.stringify(levelCell.join(' '))}`);
				continue;
			}
			const wd = WORD_CELL.exec(wordCell.join(''));
			if (!wd) {
				errors.push(`${where}: unexpected word ${JSON.stringify(wordCell.join(' '))}`);
				continue;
			}
			const pinyin = pinyinCell.join(' ');
			if (pinyin === '') {
				errors.push(`${where}: no pinyin`);
				continue;
			}
			rows.push({
				serial,
				level: lv[1],
				extra: [...lv[2].matchAll(new RegExp(`（(${LEVEL})）`, 'g'))].map((m) => m[1]),
				word: wd[1],
				homograph: wd[2],
				pinyin,
				pos: posCell.join(' '),
				page
			});
		}
	}
	if (report.tablePages.length === 0) fail('input: no vocabulary table (序号 等级 词语 拼音 词性) found');

	rows.sort((a, b) => a.serial - b.serial);
	const seen = new Map();
	for (const r of rows) seen.set(r.serial, (seen.get(r.serial) ?? 0) + 1);
	const max = rows.length ? rows.at(-1).serial : 0;
	const gaps = [];
	for (let s = 1; s <= max; s++) if (!seen.has(s)) gaps.push(s);
	const dups = [...seen].filter(([, n]) => n > 1).map(([s]) => s);
	if (gaps.length) errors.push(`missing serial numbers: ${ranges(gaps)}`);
	if (dups.length) errors.push(`duplicate serial numbers: ${ranges(dups)}`);
	if (errors.length) {
		fail(`input: ${errors.length} problem(s):\n  ${errors.slice(0, 40).join('\n  ')}`);
	}
	return { rows, report };
}

function tableHeader(ws) {
	for (const h of ws.filter((w) => w.text === HEADERS[0])) {
		const line = ws.filter((w) => Math.abs(w.top - h.top) < 1);
		const cells = HEADERS.map((name) => line.find((w) => w.text === name));
		if (cells.every(Boolean)) {
			const lefts = cells.map((w) => w.left);
			if (lefts.some((x, i) => i > 0 && x <= lefts[i - 1])) continue;
			return { lefts, bottom: Math.max(...cells.map((w) => w.top + w.height)) };
		}
	}
	return null;
}

function ranges(nums) {
	const out = [];
	for (let i = 0; i < nums.length; i++) {
		let j = i;
		while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
		out.push(i === j ? `${nums[i]}` : `${nums[i]}–${nums[j]}`);
		i = j;
	}
	return out.join(', ');
}

// readingOf returns the reading a row passes to the importer: its pinyin,
// the first alternative where the syllabus gives several.
export function readingOf(pinyin) {
	return pinyin.split('/')[0].trim();
}

// levelsFromRows groups the rows into the pack's levels, easiest first,
// in serial order, each form with its reading kept once at its lowest
// level. It returns { levels, stats }.
export function levelsFromRows(rows) {
	const order = new Map(LEVELS.map(([code], i) => [code, i]));
	const levels = LEVELS.map(([, name]) => ({ name, entries: [] }));
	const kept = new Set();
	const stats = { rows: rows.length, repeated: [], homographs: 0, alternates: 0, extraLevels: 0 };
	const byLevel = [...rows].sort((a, b) => order.get(a.level) - order.get(b.level) || a.serial - b.serial);
	for (const r of byLevel) {
		if (r.homograph) stats.homographs++;
		if (r.pinyin.includes('/')) stats.alternates++;
		if (r.extra.length) stats.extraLevels++;
		const reading = readingOf(r.pinyin);
		const key = `${r.word}\t${reading}`;
		if (kept.has(key)) {
			stats.repeated.push(`${r.serial} ${r.word} ${reading}`);
			continue;
		}
		kept.add(key);
		levels[order.get(r.level)].entries.push({ form: r.word, reading });
	}
	return { levels, stats };
}

function json(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

// levelsJSON writes levels.json with one entry per line: about half the
// size of fully indented JSON, and a re-run on a new edition diffs by word.
export function levelsJSON(levels, unit = 'word') {
	const lvls = levels.map((lv) => {
		const entries = lv.entries.map((e) => `\t\t\t\t${JSON.stringify(e)}`).join(',\n');
		return `\t\t{\n\t\t\t"name": ${JSON.stringify(lv.name)},\n\t\t\t"entries": [\n${entries}\n\t\t\t]\n\t\t}`;
	});
	return `{\n\t"unit": ${JSON.stringify(unit)},\n\t"levels": [\n${lvls.join(',\n')}\n\t]\n}\n`;
}

function sha256(buffer) {
	return createHash('sha256').update(buffer).digest('hex');
}

const fmt = (n) => n.toLocaleString('en-US');

export const LEGAL_NOTICE_URL = 'https://www.chinesetest.cn/legal-notice';
export const LICENSE_TEXT = 'See CTI Legal Notice; no reuse licence granted';
// The source wording the Legal Notice requires (§3, §6), first in every
// pack's attribution.
export const SOURCE_TEXT =
	'Source: www.chinesetest.cn — reproduced from the Chinese Test Service Website (CTI); syllabus published by CLEC';

// LICENCE_SECTION is the "Licence and terms" part of both packs'
// ATTRIBUTION.md. It states the facts and claims nothing beyond them.
export const LICENCE_SECTION = [
	'## Licence and terms',
	'',
	`${SOURCE_TEXT} (中外语言交流合作中心).`,
	'',
	'No reuse licence is granted for the syllabus. It is published by',
	'中外语言交流合作中心 (CLEC) and distributed by Chinese Testing International',
	'(CTI) at https://www.chinesetest.cn. The site\'s Legal Notice,',
	`${LEGAL_NOTICE_URL}, says that the site's content is copyrighted by CTI`,
	'or the content providers; that whoever reproduces it must indicate the',
	'source ("Source: www.chinesetest.cn", "reproduced from (or quoted from) the',
	'Chinese Test Service Website"); and that reproducing or quoting it is',
	'permitted only as reasonable, good-faith quoting for news or informative,',
	'free public information. The syllabus PDF carries a copy-protection flag',
	'(copy: no, change: no).',
	'',
	'The project includes only two lists from the syllabus: the vocabulary',
	'(word) list and the list of characters to recognise (认读字), as plain lists',
	'of words and characters with their levels (and the words\' pinyin, used as',
	'lookup readings). It does not include the syllabus\'s other content: the',
	'grammar points, the task and topic descriptions, the lists of characters to',
	'write (书写字; only their sizes are reported) and the explanatory text.',
	'',
	'The project includes these lists with this attribution at the project',
	'owner\'s decision. The legal status of including these lists has not been',
	'verified; this is not a legal opinion, and no licence or public-domain',
	'status is claimed. There is no LICENSE file in this directory because',
	'there is no licence text to copy.'
];

export function manifest(ed) {
	return {
		id: 'hsk-words',
		name: 'HSK 3.0 (words)',
		version: `${ed.published} (effective ${ed.effective})`,
		type: 'levels',
		language: 'zh',
		license: LICENSE_TEXT,
		attribution:
			`${SOURCE_TEXT} (中外语言交流合作中心). 《HSK 考试大纲》 Syllabus for the Chinese Proficiency Test, ` +
			`word list (HSK 词汇大纲), published ${ed.published}, effective ${ed.effective}; ` +
			"included with attribution at the project owner's decision, legal status not verified",
		format: 'json'
	};
}

export function attribution({ ed, rows, levels, stats, pdfSum }) {
	const perLevel = LEVELS.map(([code, name]) => {
		const n = rows.filter((r) => r.level === code).length;
		const kept = levels.find((l) => l.name === name).entries.length;
		return `| ${name} | ${fmt(n)} | ${fmt(kept)} |`;
	});
	const lines = [
		'# HSK 3.0 word levels (HSK 1–6, HSK 7–9)',
		'',
		'The words of the official HSK syllabus, grouped by level, easiest first:',
		'',
		'- Title: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test,',
		'  part "HSK 词汇大纲" (vocabulary syllabus).',
		`- Edition: published ${ed.published} (发布), effective ${ed.effective} (实施).`,
		'- Issued by: 中外语言交流合作中心 (Center for Language Education and',
		'  Cooperation, CLEC).',
		'- Distributed by: Chinese Testing International (CTI), https://www.chinesetest.cn',
		`- File: ${PDF_URL}`,
		'',
		...LICENCE_SECTION,
		'',
		'## Conversion',
		'',
		'`scripts/prepare-hsk-syllabus.mjs` reads the word boxes of',
		'`pdftotext -tsv` (poppler) and takes, from each row of the vocabulary',
		'table, the level, the word and its pinyin (the part of speech is not',
		'kept). The level is the first level of the level cell. A cell such as',
		'"1（4）" adds levels in parentheses, which appear to go with the parts of',
		'speech in parentheses (半 "数、（副）": numeral at HSK 1, adverb at HSK 4;',
		'the syllabus does not explain the notation); they are not kept, so a word',
		'takes its first level. A trailing 1 or 2 that numbers',
		'homographs (本1, 本2) is removed. The pinyin is the entry\'s reading (the',
		'first one where the syllabus gives alternatives, such as "shéi/shuí");',
		'the importer uses it to prefer the dictionary word with that reading.',
		'Nothing else is added or changed.',
		'',
		`Rows: ${fmt(rows.length)}, serial numbers 1–${fmt(rows.at(-1).serial)}, none missing or repeated.`,
		`Homograph-numbered rows: ${fmt(stats.homographs)}; rows with alternative pinyin: ${fmt(stats.alternates)};`,
		`rows whose level cell names further levels: ${fmt(stats.extraLevels)}.`,
		`The same word with the same reading listed twice is kept once, at its lowest level: ${fmt(stats.repeated.length)} rows.`,
		'',
		'| Level | Rows | Entries |',
		'|-------|------|---------|',
		...perLevel,
		'',
		'Input file (SHA-256):',
		'',
		pdfSum ? `    ${pdfSum}  syllabus.pdf` : '    (not recorded: run with --pdf <syllabus.pdf>)',
		''
	];
	return lines.join('\n');
}


// The level names in the character list headings: "HSK（一级）认读字",
// "HSK（七—九级）认读字", "HSK（一级）~（二级）书写字".
const CN_LEVEL = { 一级: '1', 二级: '2', 三级: '3', 四级: '4', 五级: '5', 六级: '6', '七—九级': '7-9' };
const LIST_HEADING = /^HSK（(一级|二级|三级|四级|五级|六级|七—九级)）(?:~（(二级)）)?(认读字|书写字)$/;
const ITEM = /^(\d+)\.(\p{Script=Han}?)$/u;
const ONE_HAN = /^\p{Script=Han}$/u;

// parseCharacterLists extracts the numbered character lists of the
// syllabus's 汉字大纲 from its word boxes. It returns { lists, report }:
// lists in page order, each { kind: '认读字' | '书写字', levels: ['1'] or
// ['1', '2'], heading, chars, page }, chars in list order.
export function parseCharacterLists(text) {
	const words = tsvWords(text);
	const report = { watermark: 0, pageNumbers: 0, pages: [] };
	const byPage = new Map();
	for (const w of words) {
		if (w.height >= WATERMARK_MIN_HEIGHT) {
			report.watermark++;
			continue;
		}
		if (!byPage.has(w.page)) byPage.set(w.page, []);
		byPage.get(w.page).push(w);
	}
	const lists = [];
	const errors = [];
	let current = null;
	for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
		const ws = byPage.get(page);
		const headings = ws.filter((w) => LIST_HEADING.test(w.text));
		const items = ws.filter((w) => ITEM.test(w.text));
		if (!current && headings.length === 0) continue; // before the section
		if (current && headings.length === 0 && items.length === 0) break; // past it
		if (headings.length > 1) errors.push(`page ${page}: ${headings.length} list headings`);
		if (headings.length) {
			const [, from, to, kind] = LIST_HEADING.exec(headings[0].text);
			current = {
				kind,
				levels: to ? [CN_LEVEL[from], CN_LEVEL[to]] : [CN_LEVEL[from]],
				heading: headings[0].text,
				page,
				items: []
			};
			lists.push(current);
		}
		report.pages.push(page);
		const used = new Set([...headings, ...items]);
		const cy = (w) => w.top + w.height / 2;
		const byLeft = [...items].sort((a, b) => a.left - b.left);
		for (const n of byLeft) {
			const [, num, inline] = ITEM.exec(n.text);
			let ch = inline;
			if (!ch) {
				// The character box to the right on the same line, before the
				// next column's number.
				const next = byLeft.find((o) => o.left > n.left + 1 && Math.abs(cy(o) - cy(n)) < 4);
				const limit = next ? next.left : Infinity;
				const box = ws
					.filter((w) => !used.has(w) && ONE_HAN.test(w.text) && w.left > n.left && w.left < limit && Math.abs(cy(w) - cy(n)) < 4)
					.sort((a, b) => a.left - b.left)[0];
				if (box) {
					used.add(box);
					ch = box.text;
				}
			}
			if (!ch) {
				errors.push(`page ${page}: item ${num} has no character`);
				continue;
			}
			current.items.push({ n: Number(num), ch });
		}
		const lastItem = Math.max(...items.map(cy), 0);
		for (const w of ws) {
			if (used.has(w)) continue;
			if (/^\d+$/.test(w.text) && cy(w) > lastItem) {
				report.pageNumbers++;
				continue;
			}
			errors.push(`page ${page}: text off the lists: ${JSON.stringify(w.text)}`);
		}
	}
	if (lists.length === 0) fail('input: no character list (HSK（…）认读字) found');
	for (const l of lists) {
		const seen = new Map();
		for (const it of l.items) seen.set(it.n, (seen.get(it.n) ?? 0) + 1);
		const max = Math.max(...seen.keys());
		const gaps = [];
		for (let k = 1; k <= max; k++) if (!seen.has(k)) gaps.push(k);
		const dups = [...seen].filter(([, c]) => c > 1).map(([k]) => k);
		if (gaps.length) errors.push(`${l.heading}: missing numbers ${ranges(gaps)}`);
		if (dups.length) errors.push(`${l.heading}: duplicate numbers ${ranges(dups)}`);
		l.chars = [...l.items].sort((a, b) => a.n - b.n).map((it) => it.ch);
		delete l.items;
	}
	if (errors.length) {
		fail(`input: ${errors.length} problem(s) in the character lists:\n  ${errors.slice(0, 40).join('\n  ')}`);
	}
	return { lists, report };
}

// charLevelsFromLists turns the 认读字 lists into the pack's levels, a
// character at the lowest level that lists it, and checks the 书写字 lists
// against them. It returns { levels, stats }.
export function charLevelsFromLists(lists) {
	const order = new Map(LEVELS.map(([code], i) => [code, i]));
	const levels = LEVELS.map(([, name]) => ({ name, entries: [] }));
	const level = new Map(); // character -> level index
	const stats = { reading: [], writing: [], repeated: [] };
	const reading = lists.filter((l) => l.kind === '认读字');
	const codes = reading.map((l) => l.levels[0]);
	if (codes.join() !== LEVELS.map(([c]) => c).join()) {
		fail(`input: 认读字 lists for levels ${codes.join(', ')}; want ${LEVELS.map(([c]) => c).join(', ')}`);
	}
	for (const l of [...reading].sort((a, b) => order.get(a.levels[0]) - order.get(b.levels[0]))) {
		const i = order.get(l.levels[0]);
		stats.reading.push({ heading: l.heading, count: l.chars.length });
		for (const ch of l.chars) {
			if (level.has(ch)) {
				stats.repeated.push(`${ch} (${l.heading})`);
				continue;
			}
			level.set(ch, i);
			levels[i].entries.push(ch);
		}
	}
	const problems = [];
	for (const l of lists.filter((x) => x.kind === '书写字')) {
		const top = Math.max(...l.levels.map((c) => order.get(c)));
		const above = l.chars.filter((ch) => !(level.get(ch) <= top));
		stats.writing.push({ heading: l.heading, count: l.chars.length });
		if (above.length) problems.push(`${l.heading}: ${above.join('')} not recognised at or below its level`);
	}
	if (problems.length) fail(`input: ${problems.join('; ')}`);
	return { levels, stats };
}

export function charsManifest(ed) {
	return {
		id: 'hsk-chars',
		name: 'HSK 3.0 (characters)',
		version: `${ed.published} (effective ${ed.effective})`,
		type: 'levels',
		language: 'zh',
		license: LICENSE_TEXT,
		attribution:
			`${SOURCE_TEXT} (中外语言交流合作中心). 《HSK 考试大纲》 Syllabus for the Chinese Proficiency Test, ` +
			`character list (HSK 汉字大纲, 认读字), published ${ed.published}, effective ${ed.effective}; ` +
			"included with attribution at the project owner's decision, legal status not verified",
		format: 'json'
	};
}

export function charsAttribution({ ed, levels, stats, pdfSum }) {
	const total = levels.reduce((n, l) => n + l.entries.length, 0);
	const writingTotal = stats.writing.reduce((n, w) => n + w.count, 0);
	const lines = [
		'# HSK 3.0 character levels (HSK 1–6, HSK 7–9)',
		'',
		'The characters to recognise (认读字) of the official HSK syllabus, grouped',
		'by level, easiest first:',
		'',
		'- Title: 《HSK 考试大纲》 / Syllabus for the Chinese Proficiency Test,',
		'  part "HSK 汉字大纲" (character syllabus).',
		`- Edition: published ${ed.published} (发布), effective ${ed.effective} (实施).`,
		'- Issued by: 中外语言交流合作中心 (Center for Language Education and',
		'  Cooperation, CLEC).',
		'- Distributed by: Chinese Testing International (CTI), https://www.chinesetest.cn',
		`- File: ${PDF_URL}`,
		'',
		...LICENCE_SECTION,
		'',
		'## Conversion',
		'',
		'`scripts/prepare-hsk-syllabus.mjs` reads the word boxes of',
		'`pdftotext -tsv` (poppler) and takes the numbered lists of the character',
		'syllabus. Each level of this pack is one 认读字 list (HSK（一级）认读字 …',
		'HSK（七—九级）认读字), in list order; every list numbers 1..N with no gap',
		'or repeat. Nothing is added or changed.',
		'',
		`Characters: ${fmt(total)}, each in one list${stats.repeated.length ? ` (${stats.repeated.length} repeats kept at the lowest level)` : ', none repeated'}.`,
		'',
		'| Level | 认读字 |',
		'|-------|--------|',
		...levels.map((l) => `| ${l.name} | ${fmt(l.entries.length)} |`),
		'',
		`The syllabus also lists ${fmt(writingTotal)} characters to write (书写字), which assign`,
		'no level here; each is a character to recognise at or below its level:',
		'',
		'| List | 书写字 |',
		'|------|--------|',
		...stats.writing.map((w) => `| ${w.heading} | ${fmt(w.count)} |`),
		'',
		'Input file (SHA-256):',
		'',
		pdfSum ? `    ${pdfSum}  syllabus.pdf` : '    (not recorded: run with --pdf <syllabus.pdf>)',
		''
	];
	return lines.join('\n');
}

async function writePack(dir, files) {
	await rm(dir, { recursive: true, force: true });
	await mkdir(dir, { recursive: true });
	for (const [name, body] of Object.entries(files)) await writeFile(join(dir, name), body);
}

export async function convert(tsvPath, packsDir, pdfPath) {
	const text = await readFile(tsvPath, 'utf8');
	const words = tsvWords(text);
	const ed = edition(words);
	const { rows, report } = parseSyllabusTSV(text);
	const { levels, stats } = levelsFromRows(rows);
	const chars = parseCharacterLists(text);
	const charLevels = charLevelsFromLists(chars.lists);
	const pdfSum = pdfPath ? sha256(await readFile(pdfPath)) : '';
	const dir = join(packsDir, 'hsk-words');
	await writePack(dir, {
		'manifest.json': json(manifest(ed)),
		'levels.json': levelsJSON(levels),
		'ATTRIBUTION.md': attribution({ ed, rows, levels, stats, pdfSum })
	});
	const charsDir = join(packsDir, 'hsk-chars');
	await writePack(charsDir, {
		'manifest.json': json(charsManifest(ed)),
		'levels.json': levelsJSON(charLevels.levels, 'character'),
		'ATTRIBUTION.md': charsAttribution({ ed, ...charLevels, pdfSum })
	});
	return { dir, charsDir, ed, rows, levels, stats, report, chars, charLevels };
}

async function main(argv) {
	const args = [...argv];
	let pdf = '';
	const i = args.indexOf('--pdf');
	if (i >= 0) {
		pdf = args[i + 1] ?? '';
		if (!pdf) fail('--pdf needs a file');
		args.splice(i, 2);
	}
	if (args.length < 1 || args.length > 2 || args[0].startsWith('-')) {
		fail('usage: node scripts/prepare-hsk-syllabus.mjs <syllabus.tsv> [<packs-dir>] [--pdf <syllabus.pdf>]');
	}
	const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
	const packs = args[1] ? resolve(args[1]) : join(root, 'plugins', 'data');
	const out = await convert(resolve(args[0]), packs, pdf ? resolve(pdf) : '');
	const counts = out.levels.map((l) => `${l.name} ${l.entries.length}`).join(', ');
	console.log(`wrote ${out.dir}`);
	console.log(`edition ${out.ed.published} (effective ${out.ed.effective}); ${out.report.tablePages.length} table pages`);
	console.log(`${out.rows.length} rows (serials 1–${out.rows.at(-1).serial}); dropped ${out.report.watermark} watermark glyphs, ${out.report.pageNumbers} page numbers`);
	console.log(`entries: ${counts}`);
	console.log(`kept once (same form and reading listed again): ${out.stats.repeated.length}${out.stats.repeated.length ? ': ' + out.stats.repeated.join('; ') : ''}`);
	console.log(`wrote ${out.charsDir}`);
	console.log(`character lists on pages ${out.chars.report.pages[0]}–${out.chars.report.pages.at(-1)}; dropped ${out.chars.report.pageNumbers} page numbers`);
	for (const l of out.chars.lists) console.log(`  ${l.heading}: ${l.chars.length}`);
	console.log(`characters: ${out.charLevels.levels.map((l) => `${l.name} ${l.entries.length}`).join(', ')}; repeated ${out.charLevels.stats.repeated.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err instanceof PackError ? `prepare-hsk-syllabus: ${err.message}` : err);
		process.exit(1);
	});
}
