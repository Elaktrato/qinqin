// The reader's font setting. The stacks themselves are shared with the
// app-wide hanzi font: $lib/fonts/hanzi (#97); this module keeps the reader's
// names until the reader moves onto the shared module (#102).

import { hanziStack, installedFaces, type InstalledFaces } from '$lib/fonts/hanzi';

export type ReaderFont = 'default' | 'sans' | 'serif' | 'kai';

export const READER_FONTS: readonly ReaderFont[] = ['default', 'sans', 'serif', 'kai'];

const NONE = installedFaces([]);

/** fontStack maps the setting to a CSS font-family value for a study lang (`zh-Hant`, `ja`, …). */
export function fontStack(font: ReaderFont, lang: string, installed: InstalledFaces = NONE): string {
	if (font === 'default') return 'inherit';
	return hanziStack(font, lang, installed);
}
