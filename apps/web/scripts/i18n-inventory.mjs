#!/usr/bin/env node
// Interface-string inventory (issue #73, dev script, not shipped). Orientation only: no count is a gate;
// coverage is decided by the guard tests in src/lib/i18n/ (spec "Inventory", Ruling).
//
//   node scripts/i18n-inventory.mjs            per-directory table
//   node scripts/i18n-inventory.mjs --files    one line per file with findings
//
// Columns per directory under src/ (two segments, e.g. lib/settings, routes/stats):
//   files   non-test .svelte/.ts files
//   markup  markup text nodes and aria-label/title/placeholder/alt/label values with two or more letters
//           (the hard-coded-string lint's heuristic, src/lib/i18n/lint.ts)
//   tsText  sentence-like string literals in non-test .ts (and <script>) code (the lint's TS rule)
//   plural  hand-rolled plural patterns (`=== 1 ?`, `!== 1 ?`, `(s)`)
//   intl    Intl.*Format( / Intl.PluralRules( / toLocale*String( calls
//   noLang  .svelte files with no lang= attribute at all
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { intlFindings, markupFindings, markupOnly, tsFindings } from '../src/lib/i18n/lint.ts';

const src = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir) {
	const out = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) out.push(...walk(p));
		else if (/\.(svelte|ts)$/.test(e.name) && !/\.test\.(ts|svelte)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
	}
	return out;
}

const PLURAL = /[!=]==\s*1\s*\?|\(s\)/g;

const rows = new Map();
const perFile = [];
for (const file of walk(src).sort()) {
	const rel = relative(src, file);
	const parts = rel.split('/');
	const depth = parts[0] === 'lib' && (parts[1] === 'features' || parts[1] === 'plugins') ? 3 : 2;
	const dir = parts.slice(0, depth).join('/').replace(/\.(svelte|ts)$/, '');
	const text = readFileSync(file, 'utf8');
	const svelte = file.endsWith('.svelte');
	const markup = svelte ? markupFindings(text).length : 0;
	const tsText = tsFindings(text, svelte).length;
	const plural = (text.match(PLURAL) ?? []).length;
	const intl = intlFindings(text, svelte).length;
	const noLang = svelte && !/\slang=/.test(markupOnly(text)) ? 1 : 0;
	const r = rows.get(dir) ?? { files: 0, markup: 0, tsText: 0, plural: 0, intl: 0, noLang: 0 };
	r.files++;
	r.markup += markup;
	r.tsText += tsText;
	r.plural += plural;
	r.intl += intl;
	r.noLang += noLang;
	rows.set(dir, r);
	if (markup + tsText + plural + intl > 0) perFile.push({ rel, markup, tsText, plural, intl });
}

if (process.argv.includes('--files')) {
	for (const f of perFile) console.log(`${f.rel}\tmarkup ${f.markup}\ttsText ${f.tsText}\tplural ${f.plural}\tintl ${f.intl}`);
} else {
	const cols = ['files', 'markup', 'tsText', 'plural', 'intl', 'noLang'];
	const total = Object.fromEntries(cols.map((c) => [c, 0]));
	console.log(['dir'.padEnd(28), ...cols.map((c) => c.padStart(7))].join(''));
	for (const [dir, r] of [...rows].sort((a, b) => b[1].markup - a[1].markup || a[0].localeCompare(b[0]))) {
		console.log([dir.padEnd(28), ...cols.map((c) => String(r[c]).padStart(7))].join(''));
		for (const c of cols) total[c] += r[c];
	}
	console.log(['TOTAL'.padEnd(28), ...cols.map((c) => String(total[c]).padStart(7))].join(''));
}
