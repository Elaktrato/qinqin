import { describe, expect, it } from 'vitest';
import type { InstalledPack, PackType, StagedPack } from '$lib/api/packs';
import {
	LICENCE_CAUTION,
	LICENCE_CONFIRMATION,
	LICENCE_LABEL,
	LICENCE_NOT_RECORDED,
	PACK_TYPE_LABELS,
	groupPacks,
	licenceCaution,
	licenceLine,
	progressText,
	replaceLines,
	uninstallWarning
} from './packsView';

const FORBIDDEN = /verified|approved|cleared|safe|✓|✔/i;

function pack(type: PackType, packId: string, name: string): InstalledPack {
	return { type, packId, name, version: '1', language: 'es', license: 'MIT', attribution: 'a', notice: '', updatedAt: 't' };
}

function staged(over: Partial<StagedPack> = {}): StagedPack {
	return {
		token: 't',
		expiresAt: '2026-11-15T12:00:00Z',
		manifest: {
			id: 'es-demo',
			name: 'Demo',
			version: '2.0',
			type: 'dictionary',
			language: 'es',
			license: 'CC0-1.0',
			attribution: 'Qinqin',
			notice: '',
			format: 'json'
		},
		replaces: null,
		files: 2,
		bytes: 100,
		...over
	};
}

describe('licenceLine', () => {
	it('shows the stated licence verbatim', () => {
		expect(licenceLine('CC BY-SA 4.0')).toEqual({ text: 'CC BY-SA 4.0', recorded: true });
	});
	it('marks a missing licence as not recorded', () => {
		expect(licenceLine('')).toEqual({
			text: 'Licence not recorded — reinstall the pack to record it',
			recorded: false
		});
		expect(licenceLine('   ').recorded).toBe(false);
	});
});

describe('licenceCaution', () => {
	it('flags licences that may restrict use', () => {
		for (const l of ['unknown', 'Proprietary', 'CC BY-NC 4.0', 'research use only', 'All rights reserved', 'no redistribution', 'Unspecified', 'non-commercial']) {
			expect(licenceCaution(l), l).toBe('This licence may restrict use or redistribution — check it before installing');
		}
	});
	it('stays quiet for common open licences, and never turns into a positive badge', () => {
		for (const l of ['CC0-1.0', 'CC BY-SA 4.0', 'MIT', 'Apache-2.0']) expect(licenceCaution(l), l).toBeNull();
	});
	it('does not warn about a missing licence (it has its own line)', () => {
		expect(licenceCaution('')).toBeNull();
	});
});

describe('groupPacks', () => {
	it('groups by type in a fixed order and drops empty groups', () => {
		const groups = groupPacks([
			pack('sentences', 's', 'S'),
			pack('dictionary', 'b', 'B'),
			pack('dictionary', 'a', 'A')
		]);
		expect(groups.map((g) => [g.type, g.label])).toEqual([
			['dictionary', 'Dictionaries'],
			['sentences', 'Sentences']
		]);
		expect(groups[0].packs.map((p) => p.packId)).toEqual(['b', 'a']);
	});
	it('labels every type', () => {
		expect(PACK_TYPE_LABELS).toMatchObject({
			dictionary: 'Dictionaries',
			frequency: 'Frequency lists',
			levels: 'Level lists',
			sentences: 'Sentences',
			grammar: 'Grammar lessons'
		});
	});
});

describe('replaceLines', () => {
	it('is empty for a new pack', () => {
		expect(replaceLines(staged())).toEqual([]);
	});
	it('says what changes and marks a licence change', () => {
		const lines = replaceLines(
			staged({ replaces: { version: '1.0', license: 'MIT', attribution: 'Qinqin' } })
		);
		expect(lines.map((l) => l.text)).toEqual([
			'Replaces the installed version 1.0 with 2.0',
			'Licence changes from MIT to CC0-1.0'
		]);
		expect(lines.map((l) => l.licenceChanged)).toEqual([false, true]);
	});
	it('reports an unchanged licence and a changed attribution', () => {
		const lines = replaceLines(
			staged({ replaces: { version: '2.0', license: 'CC0-1.0', attribution: 'Someone else' } })
		);
		expect(lines.map((l) => l.text)).toEqual([
			'Replaces the installed version 2.0 with 2.0',
			'Licence stays CC0-1.0',
			'Attribution changes from "Someone else" to "Qinqin"'
		]);
		expect(lines.some((l) => l.licenceChanged)).toBe(false);
	});
	it('treats a previously unrecorded licence as a change', () => {
		const lines = replaceLines(staged({ replaces: { version: '1', license: '', attribution: '' } }));
		expect(lines.find((l) => l.licenceChanged)?.text).toBe('Licence was not recorded; now CC0-1.0');
	});
});

describe('progressText', () => {
	it('shows megabytes and a percentage', () => {
		expect(progressText({ loaded: 3355443, total: 11114906 })).toBe('3.2 of 10.6 MB (30 %)');
	});
	it('uses kilobytes for small files and copes with an unknown total', () => {
		expect(progressText({ loaded: 2048, total: 10240 })).toBe('2.0 of 10.0 KB (20 %)');
		expect(progressText({ loaded: 0, total: 0 })).toBe('0 bytes');
	});
});

describe('uninstallWarning', () => {
	it('says what disappears and what stays for dictionaries', () => {
		expect(uninstallWarning('dictionary')).toBe(
			'Its glosses disappear from lookups and entries. Entries, your flashcards and your edits stay. A later `qinqin seed` reinstalls bundled packs.'
		);
	});
	it('has a warning for every type', () => {
		for (const t of Object.keys(PACK_TYPE_LABELS) as PackType[]) expect(uninstallWarning(t).length).toBeGreaterThan(20);
	});
});

describe('wording', () => {
	it('uses the agreed licence copy', () => {
		expect(LICENCE_LABEL).toBe('Licence (as stated by the pack)');
		expect(LICENCE_NOT_RECORDED).toBe('Licence not recorded — reinstall the pack to record it');
		expect(LICENCE_CONFIRMATION).toBe(
			'I have read the licence and attribution above and this server may use the data under these terms'
		);
		expect(LICENCE_CAUTION).toBe('This licence may restrict use or redistribution — check it before installing');
	});
	it('never implies a licence is cleared', () => {
		const out: string[] = [LICENCE_LABEL, LICENCE_NOT_RECORDED, LICENCE_CONFIRMATION, LICENCE_CAUTION];
		for (const t of Object.keys(PACK_TYPE_LABELS) as PackType[]) out.push(uninstallWarning(t), PACK_TYPE_LABELS[t]);
		for (const l of ['', 'MIT', 'unknown', 'CC BY-NC 4.0']) out.push(licenceLine(l).text, licenceCaution(l) ?? '');
		out.push(progressText({ loaded: 1, total: 2 }));
		for (const r of [null, { version: '1', license: 'MIT', attribution: 'x' }, { version: '1', license: '', attribution: '' }]) {
			for (const l of replaceLines(staged({ replaces: r }))) out.push(l.text);
		}
		for (const s of out) expect(s).not.toMatch(FORBIDDEN);
	});
});
