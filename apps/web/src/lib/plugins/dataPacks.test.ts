import { describe, expect, it } from 'vitest';
import type { PluginInfo } from '$lib/api/types';
import { isDataPackPlugin } from './dataPacks';

function info(id: string, manifest: Record<string, unknown>): PluginInfo {
	return { id, manifest, enabled: true, order: 0 };
}

describe('isDataPackPlugin', () => {
	it('is true for the synthesized pack manifests of every type', () => {
		for (const type of ['dictionary', 'frequency', 'levels', 'sentences', 'grammar', 'audio', 'components', 'strokes', 'theme', 'font']) {
			expect(isDataPackPlugin(info('p', { id: 'p', name: 'P', type })), type).toBe(true);
		}
	});
	it('is false for feature plugins', () => {
		expect(isDataPackPlugin(info('qinqin-flashcards', { name: 'Flashcards', type: 'feature' }))).toBe(false);
		expect(isDataPackPlugin(info('legacy', { name: 'No type' }))).toBe(false);
	});
});
