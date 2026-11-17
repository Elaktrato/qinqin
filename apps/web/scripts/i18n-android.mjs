#!/usr/bin/env node
// Reference converter from a qinqin message catalogue to an Android strings.xml (issue #73; the normative rule is
// docs/contracts/i18n/README.md "Android conversion", fixture android-convert.json).
//
//   node scripts/i18n-android.mjs <lang.json> [en.json] [notes.json] > values-<lang>/strings.xml
//
// en.json fixes the argument positions (identical for every language); without it the catalogue is English.
// Uses the web parser (src/lib/i18n/message.ts) through Node's type stripping.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseMessage } from '../src/lib/i18n/message.ts';

/** `settings.account.title` → `settings_account_title`. */
export function resourceName(key) {
	return key.split('.').join('_');
}

/** Segment lists of a parsed message in message order (one per plural branch). */
function segmentLists(parsed) {
	return parsed.plural ? Object.values(parsed.plural.branches) : [parsed.segments];
}

/** Argument positions from the English message: the plural argument is 1, others by first appearance. */
function positions(enMessage) {
	const parsed = parseMessage(enMessage);
	const pos = new Map();
	if (parsed.plural) pos.set(parsed.plural.arg, 1);
	const visit = (segments) => {
		for (const s of segments) {
			if (s.type === 'arg' && !pos.has(s.name)) pos.set(s.name, pos.size + 1);
			else if (s.type === 'tag') visit(s.children);
		}
	};
	for (const list of segmentLists(parsed)) visit(list);
	return pos;
}

// Private-use sentinels survive escaping; they become format arguments and annotations at the end.
const ARG_OPEN = '';
const ARG_CLOSE = '';
const TAG_OPEN = '';
const TAG_NAME_END = '';
const TAG_CLOSE = '';

function raw(segments, pos, key) {
	let out = '';
	for (const s of segments) {
		if (s.type === 'text') out += s.value;
		else if (s.type === 'count') out += `${ARG_OPEN}1${ARG_CLOSE}`;
		else if (s.type === 'arg') {
			const n = pos.get(s.name);
			if (n === undefined) throw new Error(`${key}: argument {${s.name}} is not in the English message`);
			out += `${ARG_OPEN}${n}${ARG_CLOSE}`;
		} else out += `${TAG_OPEN}${s.name}${TAG_NAME_END}${raw(s.children, pos, key)}${TAG_CLOSE}`;
	}
	return out;
}

function escape(text, formatted) {
	let s = text
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/"/g, '\\"')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\n/g, '\\n');
	if (formatted) s = s.replace(/%/g, '%%');
	if (s.startsWith('@') || s.startsWith('?')) s = `\\${s}`;
	const chars = [...s];
	s = chars.map((c, i) => (c === ' ' && (i === 0 || i === chars.length - 1 || chars[i - 1] === ' ') ? '\\u0020' : c)).join('');
	return s
		.replace(new RegExp(`${ARG_OPEN}(\\d+)${ARG_CLOSE}`, 'g'), '%$1$$s')
		.replace(new RegExp(`${TAG_OPEN}([a-zA-Z0-9]+)${TAG_NAME_END}`, 'g'), '<annotation tag="$1">')
		.replace(new RegExp(TAG_CLOSE, 'g'), '</annotation>');
}

/**
 * strings.xml text for `catalogue`, with argument positions from `en` and `notes` as comments.
 * @param {Record<string, string>} catalogue
 * @param {Record<string, string>} en
 * @param {Record<string, string>} notes
 * @returns {string}
 */
export function convert(catalogue, en, notes) {
	let out = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n';
	for (const key of Object.keys(catalogue).sort()) {
		if (!(key in en)) continue;
		let parsed;
		let pos;
		try {
			parsed = parseMessage(catalogue[key]);
			pos = positions(en[key]);
		} catch (e) {
			throw new Error(`${key}: ${e instanceof Error ? e.message : String(e)}`);
		}
		const note = notes[key];
		if (note !== undefined) out += `    <!-- ${note.replace(/--/g, '- -')} -->\n`;
		const name = resourceName(key);
		if (parsed.plural) {
			out += `    <plurals name="${name}">\n`;
			for (const [category, segments] of Object.entries(parsed.plural.branches))
				out += `        <item quantity="${category}">${escape(raw(segments, pos, key), true)}</item>\n`;
			out += '    </plurals>\n';
		} else {
			const formatted = parsed.segments.length > 0 && pos.size > 0;
			out += `    <string name="${name}">${escape(raw(parsed.segments, pos, key), formatted)}</string>\n`;
		}
	}
	return `${out}</resources>\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [file, enFile, notesFile] = process.argv.slice(2);
	if (!file) {
		console.error('usage: node scripts/i18n-android.mjs <lang.json> [en.json] [notes.json]');
		process.exit(2);
	}
	const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
	const catalogue = read(file);
	process.stdout.write(convert(catalogue, enFile ? read(enFile) : catalogue, notesFile ? read(notesFile) : {}));
}
