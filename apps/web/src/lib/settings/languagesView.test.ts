import { describe, expect, it } from 'vitest';
import type { Language } from '$lib/api/types';
import type { InstalledPack } from '$lib/api/packs';
import { languageRows, normalizeCode } from './languagesView';

const lang = (code: string, kind: 'code' | 'data', installed = false): Language => ({
	code, name: code, installed, kind
});
const pack = (type: InstalledPack['type'], packId: string, language: string, name = ''): InstalledPack => ({
	type, packId, name, version: '1', language, license: 'l', attribution: 'a', notice: '', updatedAt: 't'
});

describe('languageRows', () => {
	const rows = languageRows(
		[lang('es', 'data', true), lang('pt_br', 'data'), lang('zh', 'code', true)],
		[
			pack('dictionary', 'cedict', 'zh', 'CC-CEDICT'),
			pack('dictionary', 'unihan', 'zh', 'Unihan'),
			pack('dictionary', 'es-demo', 'es', 'Spanish–English demo dictionary')
		],
		[{ code: 'es', workspaces: 1 }]
	);
	it('lists built-in languages with their packs, not removable', () => {
		const zh = rows.find((r) => r.code === 'zh')!;
		expect(zh).toMatchObject({ label: 'Chinese', kind: 'code', valid: true, workspaces: 0, removable: false });
		expect(zh.packs).toEqual(['CC-CEDICT (Dictionaries)', 'Unihan (Dictionaries)']);
	});
	it('counts workspaces and keeps used data languages', () => {
		const es = rows.find((r) => r.code === 'es')!;
		expect(es).toMatchObject({ kind: 'data', workspaces: 1, removable: false });
		expect(es.packs).toEqual(['Spanish–English demo dictionary (Dictionaries)']);
	});
	it('flags a legacy code and keeps it removable', () => {
		expect(rows.find((r) => r.code === 'pt_br')).toMatchObject({ valid: false, removable: true });
	});
	it('falls back to the pack id without a name', () => {
		const r = languageRows([lang('es', 'data')], [pack('levels', 'x', 'ES')], []);
		expect(r[0].packs).toEqual(['x (Level lists)']);
	});
});

describe('normalizeCode', () => {
	it('normalizes like the server', () => {
		expect(normalizeCode(' PT_br ')).toBe('pt-br');
		expect(normalizeCode('zh-hant-tw')).toBe('zh-hant-tw');
	});
	it('rejects malformed codes', () => {
		for (const bad of ['x', '', 'spanish', 'es-', 'Hello!']) expect(normalizeCode(bad)).toBeNull();
	});
});
