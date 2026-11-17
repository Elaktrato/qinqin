// `lang` attributes of study text (issue #73, spec "lang and dir attributes"). Interface text never carries a `lang`
// of its own (it inherits `<html lang>`); study text always carries the study language through these helpers, so a
// screen reader reads it in the right voice and fonts pick the right glyph forms (zh-Hans/zh-Hant/ja).

export type ScriptVariant = 'original' | 'simplified' | 'traditional';

/**
 * The `lang` of study text in `language` (the workspace's, a book's or a pack's): a bare `zh` reads as simplified
 * (`zh-Hans`); a converted variant names its script; `undefined` (no attribute) for an unknown language.
 */
export function studyLang(language: string | undefined, opts: { variant?: ScriptVariant } = {}): string | undefined {
	const tag = (language ?? '').trim();
	if (tag === '') return undefined;
	if (tag.toLowerCase() === 'zh') {
		if (opts.variant === 'original') return tag;
		return opts.variant === 'traditional' ? 'zh-Hant' : 'zh-Hans';
	}
	return tag;
}

/** The `lang` of a reading: pinyin and bopomofo name their script, romaji is Latin Japanese, kana is Japanese. */
export function readingLang(type: string, language: string): string | undefined {
	switch (type.trim().toLowerCase()) {
		case 'pinyin':
			return 'zh-Latn-pinyin';
		case 'bopomofo':
			return 'zh-Bopo';
		case 'romaji':
			return 'ja-Latn';
		case 'kana':
		case 'on':
		case 'kun':
			return 'ja';
		default:
			return studyLang(language);
	}
}

/** The `lang` of dictionary glosses: the pack's gloss language, English by default. */
export function glossLang(language: string | undefined): string {
	return language && language.trim() ? language : 'en';
}

/** The `lang` of a word's main reading shown beside it (pinyin for Chinese, kana for Japanese). */
export function wordReadingLang(language: string | undefined): string | undefined {
	const primary = (language ?? '').trim().toLowerCase().split('-')[0];
	if (primary === 'zh') return readingLang('pinyin', language ?? '');
	if (primary === 'ja') return readingLang('kana', language ?? '');
	return studyLang(language);
}
