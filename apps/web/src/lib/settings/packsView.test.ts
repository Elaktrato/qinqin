import { describe, expect, it } from 'vitest';
import type { InstalledPack, PackType, StagedPack } from '$lib/api/packs';
import type { CatalogueRow } from '$lib/api/packages';
import {
	licenceCautionText,
	licenceConfirmation,
	licenceLabel,
	licenceNotRecorded,
	PACK_TYPE_LABELS,
	groupPacks,
	licenceCaution,
	licenceLine,
	packLanguages,
	packagesBuilding,
	packageLine,
	packagesOf,
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
	it('lists components packs after audio', () => {
		const groups = groupPacks([pack('components', 'c', 'C'), pack('audio', 'k', 'K')]);
		expect(groups.map((g) => [g.type, g.label])).toEqual([
			['audio', 'Audio'],
			['components', 'Character components']
		]);
		expect(uninstallWarning('components')).toMatch(/radical and part lookup/);
	});
	it('groups a strokes pack with its languages instead of dropping it', () => {
		const sp = { ...pack('strokes', 's', 'S'), language: '', languages: ['ja', 'zh'] };
		const groups = groupPacks([pack('dictionary', 'd', 'D'), sp]);
		expect(groups.map((g) => g.type)).toEqual(['dictionary', 'strokes']);
		expect(groups[1].label).toBe(PACK_TYPE_LABELS.strokes);
		expect(groups[1].packs[0].languages).toEqual(['ja', 'zh']);
		expect(packLanguages(sp)).toEqual(['ja', 'zh']);
		expect(packLanguages(pack('dictionary', 'd', 'D'))).toEqual(['es']);
		expect(packLanguages({ ...pack('audio', 'a', 'A'), language: '' })).toEqual([]);
	});
	it('lists audio packs last', () => {
		const groups = groupPacks([pack('audio', 'k', 'K'), pack('grammar', 'g', 'G'), pack('dictionary', 'd', 'D')]);
		expect(groups.map((g) => g.type)).toEqual(['dictionary', 'grammar', 'audio']);
	});
	it('labels every type', () => {
		expect(PACK_TYPE_LABELS).toMatchObject({
			dictionary: 'Dictionaries',
			frequency: 'Frequency lists',
			levels: 'Level lists',
			sentences: 'Sentences',
			grammar: 'Grammar lessons',
			audio: 'Audio',
			components: 'Character components'
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

describe('uninstallWarning for audio', () => {
	it('says the recordings are removed from the data directory and the Docker image copy is not', () => {
		const w = uninstallWarning('audio');
		expect(w).toMatch(/recordings/i);
		expect(w).toMatch(/play buttons/i);
		expect(w).toMatch(/seed|fetch/i);
	});
});

describe('wording', () => {
	it('uses the agreed licence copy', () => {
		expect(licenceLabel()).toBe('Licence (as stated by the pack)');
		expect(licenceNotRecorded()).toBe('Licence not recorded — reinstall the pack to record it');
		expect(licenceConfirmation()).toBe(
			'I have read the licence and attribution above and this server may use the data under these terms'
		);
		expect(licenceCautionText()).toBe('This licence may restrict use or redistribution — check it before installing');
	});
	it('never implies a licence is cleared', () => {
		const out: string[] = [licenceLabel(), licenceNotRecorded(), licenceConfirmation(), licenceCautionText()];
		for (const t of Object.keys(PACK_TYPE_LABELS) as PackType[]) out.push(uninstallWarning(t), PACK_TYPE_LABELS[t]);
		for (const l of ['', 'MIT', 'unknown', 'CC BY-NC 4.0']) out.push(licenceLine(l).text, licenceCaution(l) ?? '');
		out.push(progressText({ loaded: 1, total: 2 }));
		for (const r of [null, { version: '1', license: 'MIT', attribution: 'x' }, { version: '1', license: '', attribution: '' }]) {
			for (const l of replaceLines(staged({ replaces: r }))) out.push(l.text);
		}
		for (const s of out) expect(s).not.toMatch(FORBIDDEN);
	});
});

function row(over: Partial<CatalogueRow> & { id: string; packId: string }): CatalogueRow {
	const { packId, ...rest } = over;
	return {
		type: 'lexicon',
		languages: ['zh'],
		formatVersion: 1,
		revision: 3,
		contentHash: `sha256:${'a'.repeat(64)}`,
		sha256: 'b'.repeat(64),
		bytes: 24117248,
		url: `/api/packages/${over.id}/3`,
		state: 'ready',
		builtAt: '2026-11-16T10:00:00Z',
		requires: [],
		optional: false,
		licenseTexts: true,
		sources: [{ type: 'dictionary', packId, name: 'n', version: '1', license: 'MIT', attribution: 'a', notice: '' }],
		updatedAt: '2026-11-16T10:00:00Z',
		deletedAt: null,
		...rest
	} as CatalogueRow;
}

describe('packagesOf', () => {
	it('finds the packages built from an installed pack by their sources, tombstones left out', () => {
		const rows = [
			row({ id: 'lexicon.zh', packId: 'cedict' }),
			row({ id: 'levels.hsk', type: 'levels', packId: 'hsk', sources: [{ type: 'levels', packId: 'hsk', name: 'n', version: '1', license: 'x', attribution: 'a', notice: '' }] }),
			row({ id: 'frequency.cedict', type: 'frequency', packId: 'cedict', state: 'deleted', deletedAt: '2026-11-16T10:00:00Z', url: null })
		];
		expect(packagesOf(pack('dictionary', 'cedict', 'CC-CEDICT'), rows).map((r) => r.id)).toEqual(['lexicon.zh']);
		expect(packagesOf(pack('dictionary', 'other', 'X'), rows)).toEqual([]);
	});
});

describe('packageLine', () => {
	it('shows revision, size in MB and state of a ready package', () => {
		expect(packageLine(row({ id: 'lexicon.zh', packId: 'cedict' }))).toEqual({ text: 'lexicon.zh: revision 3, 23.0 MB, ready', error: null });
	});
	it('says a first build is pending or failed, without a size', () => {
		const base = { revision: 0, contentHash: '', sha256: '', bytes: 0, url: null, builtAt: null } as const;
		expect(packageLine(row({ id: 'lexicon.zh', packId: 'c', state: 'building', ...base })).text).toBe('lexicon.zh: being built');
		expect(packageLine(row({ id: 'lexicon.zh', packId: 'c', state: 'failed', ...base })).text).toBe('lexicon.zh: build failed');
	});
	it('carries the administrator error text, also on a ready row of an older revision', () => {
		expect(packageLine(row({ id: 'lexicon.zh', packId: 'c', error: 'disk full' }))).toEqual({
			text: 'lexicon.zh: revision 3, 23.0 MB, ready',
			error: 'disk full'
		});
	});
	it('names the building notice', () => {
		expect(packagesBuilding()).toBe('Packages are being built');
	});
});
