import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCatalogue, resetCatalogue } from '$lib/i18n';
import en from '$lib/i18n/messages/en.json';
import { activityLabel, activityText, builtinKeys, pluginDescription, pluginName } from './manifestText';

// Built-in plugin manifests (server/internal/plugins/builtin/*.json) carry English text the server also serves; the
// interface shows the catalogue's wording for a built-in id (`plugin.<idCamel>.*`) and a third-party manifest's own
// text verbatim (spec "Plugin manifests").

const dir = resolve(__dirname, '../../../../../server/internal/plugins/builtin');
type Activity = { label: string; describe: { one: string; other: string } };
type Manifest = { id: string; name: string; description?: string; events?: { type: string; activity?: Activity }[] };
const manifests: Manifest[] = readdirSync(dir)
	.filter((f) => f.endsWith('.json'))
	.map((f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Manifest);

afterEach(() => resetCatalogue());

describe('built-in manifests', () => {
	it('reads every built-in manifest', () => {
		expect(manifests.map((m) => m.id)).toContain('qinqin-journal');
	});

	it.each(manifests.map((m) => [m.id, m] as const))('%s: every string has a catalogue key with the same English', (_, m) => {
		const keys = builtinKeys(m.id);
		expect(keys).not.toBeNull();
		expect(Object.hasOwn(en, keys!.name)).toBe(true);
		expect(pluginName(m)).toBe(m.name);
		if (m.description !== undefined) expect(pluginDescription(m)).toBe(m.description);
		for (const e of m.events ?? []) {
			if (e.activity === undefined) continue;
			const source = { plugin: m.id, type: e.type, label: e.activity.label, describe: e.activity.describe };
			expect(activityLabel(source)).toBe(e.activity.label);
			expect(activityText(source, 1, '1')).toBe(e.activity.describe.one.replaceAll('{n}', '1'));
			expect(activityText(source, 3, '2 of 3')).toBe(e.activity.describe.other.replaceAll('{n}', '2 of 3'));
		}
	});

	it('follows the active catalogue for a built-in id', () => {
		const journal = manifests.find((m) => m.id === 'qinqin-journal')!;
		installCatalogue('xx', { ...en, 'plugin.qinqinJournal.name': 'Tagebuch' });
		expect(pluginName(journal)).toBe('Tagebuch');
	});
});

describe('third-party manifests', () => {
	const other = { id: 'acme-cards', name: 'Acme Cards', description: 'Cards by Acme.' };
	const source = { plugin: 'acme-cards', type: 'acme', label: 'Acme drills', describe: { one: '{n} drill', other: '{n} drills' } };

	it('keeps the manifest text verbatim', () => {
		installCatalogue('xx', {});
		expect(pluginName(other)).toBe('Acme Cards');
		expect(pluginDescription(other)).toBe('Cards by Acme.');
		expect(pluginDescription({ id: 'acme-cards' })).toBe('');
		expect(activityLabel(source)).toBe('Acme drills');
		expect(activityText(source, 1, '1')).toBe('1 drill');
		expect(activityText(source, 5, '5')).toBe('5 drills');
	});

	it('an unknown activity type of a built-in id keeps its own text', () => {
		const odd = { ...source, plugin: 'qinqin-journal', type: 'unknown' };
		expect(activityLabel(odd)).toBe('Acme drills');
	});
});
