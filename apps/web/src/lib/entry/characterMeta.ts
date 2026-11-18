// The small line under a word's character (#104): "Radical 力 · 13 strokes ·
// HSK 5", with each part only when the data carries it (the server sends
// strokes 0 for unknown, never to be printed).

import { t } from '$lib/i18n';
import type { EntryCharacter, SearchLevel } from '$lib/api/types';

/** levelLabel is a hit's or character's first level, e.g. "HSK 5". */
export function levelLabel(level: SearchLevel | undefined): string {
	if (!level) return '';
	return [level.scheme, level.level].filter(Boolean).join(' ');
}

export function characterMeta(character: EntryCharacter): string {
	const parts: string[] = [];
	if (character.radical) parts.push(t('entry.char.meta', { radical: character.radical.written }));
	if (character.strokes > 0) parts.push(t('entry.char.strokes', { strokes: character.strokes }));
	const meta = parts.join(' · ');
	const level = levelLabel(character.levels?.[0]);
	if (!level) return meta;
	return meta ? t('entry.char.level', { meta, level }) : level;
}
