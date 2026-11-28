// The look-alike drill's rules (#228; docs/contracts/lookalikes/): set keys, the set file format, the candidates, the
// mode, the word with a gap and the answer's grade and payload; and the committed sets themselves.
import { describe, expect, it } from 'vitest';
import setsFixture from '../../../../../../../docs/contracts/lookalikes/sets.json';
import checkFixture from '../../../../../../../docs/contracts/lookalikes/check.json';
import zhFile from './data/look-alikes-zh.json';
import jaFile from './data/look-alikes-ja.json';
import { validItemKey } from '$lib/studycore/drills';
import { LOOK_ALIKES_DRILL, answerOf, candidateSets, gapPrompt, modeFor, parseSetsFile, setsProblem, validSetKey, type SetsFile } from './sets';

const fileOf = setsFixture.fileOf as unknown as Record<string, unknown>;
const parsed = (name: string): SetsFile => {
	const f = parseSetsFile(fileOf[name]);
	if (f === null) throw new Error(`fixture file ${name} does not parse`);
	return f;
};

describe('set keys (docs/contracts/lookalikes/sets.json)', () => {
	for (const c of setsFixture.keys) {
		it(`${c.name}: ${JSON.stringify(c.key)} is ${c.valid ? 'valid' : 'not valid'}`, () => {
			expect(validSetKey(c.key)).toBe(c.valid);
			// Every valid set key is a drill item key.
			if (c.valid) expect(validItemKey(c.key)).toBe(true);
		});
	}
});

describe('the set file format (docs/contracts/lookalikes/sets.json)', () => {
	for (const c of setsFixture.files) {
		it(c.name, () => {
			expect(setsProblem(c.file)).toEqual(c.problem);
			expect(parseSetsFile(c.file) === null).toBe(c.problem !== null);
		});
	}
	it('keys a set by its members in order', () => {
		expect(parsed('zh').sets.map((s) => s.key)).toEqual(['未末', '鸟乌', '鳥烏']);
	});
});

describe('the candidates (docs/contracts/lookalikes/sets.json)', () => {
	for (const c of setsFixture.candidates) {
		it(c.name, () => {
			expect(candidateSets(parsed(c.file), c.language, c.studied).map((s) => s.key)).toEqual(c.expect);
		});
	}
});

describe('questions and answers (docs/contracts/lookalikes/check.json)', () => {
	it('names the drill', () => expect(LOOK_ALIKES_DRILL).toBe(checkFixture.drill));
	for (const c of checkFixture.modes) {
		it(`mode: ${c.name}`, () => expect(modeFor(c.answers)).toBe(c.mode));
	}
	for (const c of checkFixture.prompts) {
		it(`prompt: ${c.name}`, () => expect(gapPrompt(parsed(c.file), c.member, c.language)).toEqual(c.expect));
	}
	for (const c of checkFixture.answers) {
		it(`answer: ${c.name}`, () => {
			const answer = answerOf(c.item, c.mode, c.asked, c.given);
			expect(answer).toEqual(c.expect);
			// Member order is part of the event's shape.
			if (answer !== null && c.expect !== null) expect(JSON.stringify(answer.payload)).toBe(JSON.stringify(c.expect.payload));
		});
	}
});

describe('the committed sets (lookAlikes/data)', () => {
	for (const [name, file, language] of [
		['look-alikes-zh.json', zhFile, 'zh'],
		['look-alikes-ja.json', jaFile, 'ja']
	] as const) {
		it(`${name} has no problem`, () => {
			expect(setsProblem(file)).toBeNull();
			expect(parseSetsFile(file)?.language).toBe(language);
		});
		it(`${name}: every set key is a drill item`, () => {
			for (const set of parseSetsFile(file)!.sets) expect(validItemKey(set.key), set.key).toBe(true);
		});
	}
});

describe('the committed sets against the bundled stroke data (Hanzi Writer data, a dev dependency)', () => {
	// The stroke files of the characters in the sets; the highlight checks the served data's count at run time too.
	const strokeFiles = import.meta.glob<{ strokes: string[] }>('/node_modules/hanzi-writer-data/*.json', { import: 'default' });
	for (const [name, file] of [
		['look-alikes-zh.json', zhFile],
		['look-alikes-ja.json', jaFile]
	] as const) {
		it(`${name}: every character with stroke data has the file's stroke count`, async () => {
			const parsed = parseSetsFile(file)!;
			const missing: string[] = [];
			for (const [ch, c] of Object.entries(parsed.characters)) {
				if (c.kind === 'kana') continue;
				const load = strokeFiles[`/node_modules/hanzi-writer-data/${ch}.json`];
				if (load === undefined) {
					missing.push(ch);
					continue;
				}
				expect((await load()).strokes.length, ch).toBe(c.strokes);
			}
			// Chinese: every character has data. Japanese: the shinjitai forms the Chinese data lacks (KanjiVG, when
			// installed, draws them; the answer otherwise shows the font's glyph).
			expect(missing).toEqual(name === 'look-alikes-zh.json' ? [] : ['読', '続', '険', '検', '験', '緑', '縁']);
		});
	}
});
