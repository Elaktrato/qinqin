#!/usr/bin/env node
// Build the topic labels of the words (#220):
//
//   node scripts/build-topic-labels.mjs [--check]
//       the labels files server/internal/topics/labels/<lang>.json from the
//       committed inputs (no network, no agent): the batches in
//       scripts/topics/<lang>/batch-NN.json, the picture mapping
//       scripts/images/openmoji/map.tsv, the concept groups
//       scripts/topics/openmoji-groups.tsv and the group -> topic table
//       scripts/topics/openmoji-topics.tsv. --check fails when a committed
//       file differs from a fresh build.
//   node scripts/build-topic-labels.mjs --groups <openmoji.json>
//       rewrites scripts/topics/openmoji-groups.tsv from the pinned OpenMoji
//       data file (scripts/images/pins.json, checked by SHA-256 here).
//
// The batches are written by the agent step, scripts/topic-agents.mjs.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTsv, parseTsv, MAP_HEADER } from './images-lib.mjs';
import { GROUPS_HEADER, GROUP_TOPICS_HEADER, buildLabels, formatLabels, groupRows, groupTopics, pictureTopics, topicIds } from './topics-lib.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const LANGS = ['zh', 'ja'];
const OUT = (lang) => join(root, 'server/internal/topics/labels', `${lang}.json`);

/** Everything the build and the agent step read, from the committed files. */
export function inputs() {
	const ids = topicIds(JSON.parse(readFileSync(join(root, 'docs/contracts/topics/topics.json'), 'utf8')));
	const groups = parseTsv(readFileSync(join(root, 'scripts/topics/openmoji-groups.tsv'), 'utf8'), GROUPS_HEADER);
	const table = parseTsv(readFileSync(join(root, 'scripts/topics/openmoji-topics.tsv'), 'utf8'), GROUP_TOPICS_HEADER);
	const map = parseTsv(readFileSync(join(root, 'scripts/images/openmoji/map.tsv'), 'utf8'), MAP_HEADER);
	const reviewers = JSON.parse(readFileSync(join(root, 'scripts/topics/reviewers.json'), 'utf8'));
	const topicOf = groupTopics(table, ids);
	const picture = (lang) => pictureTopics(map, lang, groups, topicOf);
	return { ids, picture, reviewers };
}

export function batchFiles(lang) {
	const dir = join(root, 'scripts/topics', lang);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((n) => /^batch-\d+\.json$/.test(n))
		.sort()
		.map((n) => join(dir, n));
}

export function build(lang, { ids, picture, reviewers }) {
	const batches = batchFiles(lang).map((f) => JSON.parse(readFileSync(f, 'utf8')));
	const meta = reviewers[lang];
	return formatLabels(buildLabels(lang, batches, picture(lang), ids, { attribution: meta.attribution, reviewers: meta.reviewers }));
}

function main() {
	const a = process.argv.slice(2);
	if (a[0] === '--groups') {
		const buf = readFileSync(a[1]);
		const pin = JSON.parse(readFileSync(join(root, 'scripts/images/pins.json'), 'utf8')).openmoji.data;
		const got = createHash('sha256').update(buf).digest('hex');
		if (got !== pin.sha256) throw new Error(`${a[1]}: SHA-256 ${got}, the pin says ${pin.sha256}`);
		const map = parseTsv(readFileSync(join(root, 'scripts/images/openmoji/map.tsv'), 'utf8'), MAP_HEADER);
		const rows = groupRows(JSON.parse(buf.toString('utf8')), new Set(map.map((r) => r.concept)));
		writeFileSync(join(root, 'scripts/topics/openmoji-groups.tsv'), formatTsv(GROUPS_HEADER, rows));
		console.log(`openmoji-groups.tsv: ${rows.length} concepts`);
		return;
	}
	const check = a.includes('--check');
	const ins = inputs();
	let stale = 0;
	for (const lang of LANGS) {
		const text = build(lang, ins);
		const n = JSON.parse(text).labels.length;
		if (check) {
			const have = existsSync(OUT(lang)) ? readFileSync(OUT(lang), 'utf8') : '';
			if (have !== text) {
				console.error(`${OUT(lang)} is not what the inputs build: run node scripts/build-topic-labels.mjs`);
				stale++;
			}
			continue;
		}
		writeFileSync(OUT(lang), text);
		console.log(`${lang}: ${n} labels -> ${OUT(lang)}`);
	}
	if (stale) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
