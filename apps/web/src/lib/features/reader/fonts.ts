// System font stacks for the reader's font setting. No font is bundled
// (CJK fonts weigh 10-20 MB per weight); the chapter's `lang` already
// selects regional glyph forms. Every stack ends with a generic family.

export type ReaderFont = 'default' | 'sans' | 'serif' | 'kai';

export const READER_FONTS: readonly ReaderFont[] = ['default', 'sans', 'serif', 'kai'];

const SANS: Record<string, string> = {
	zh: '"PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", sans-serif',
	ja: '"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", Meiryo, sans-serif'
};
const SERIF: Record<string, string> = {
	zh: '"Songti SC", "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif',
	ja: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif'
};
const KAI_ZH = '"Kaiti SC", STKaiti, KaiTi, "AR PL UKai CN", serif';

/** fontStack maps the setting to a CSS font-family value for a language. */
export function fontStack(font: ReaderFont, lang: string): string {
	switch (font) {
		case 'sans':
			return SANS[lang] ?? 'sans-serif';
		case 'serif':
			return SERIF[lang] ?? 'serif';
		case 'kai':
			return lang === 'zh' ? KAI_ZH : (SERIF[lang] ?? 'serif');
		default:
			return 'inherit';
	}
}
