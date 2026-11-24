// Loads a lesson ready for display: fetched, then converted to the
// reader's script setting (Chinese only) before tiles are cut or a gap
// is found.

import { studyLang } from '$lib/i18n/lang';
import { prepareVariant, convertText, type Variant } from '$lib/features/reader/variants';
import { browserStorage, loadPrefs } from '$lib/features/reader/prefs';
import { loadLesson } from './api';
import { convertLesson } from './exercises';
import type { Lesson, LessonView } from './types';

export interface DisplayLesson {
	view: LessonView;
	lesson: Lesson;
	/** The lang attribute for the lesson's target-language text. */
	textLang: string;
}

/** loadDisplayLesson is null for a lesson that does not exist (any more). */
export async function loadDisplayLesson(pack: string, id: string): Promise<DisplayLesson | null> {
	const view = await loadLesson(pack, id);
	if (view === null) return null;
	const language = view.pack.language;
	let variant: Variant = language === 'zh' ? loadPrefs(browserStorage()).variant : 'original';
	try {
		await prepareVariant(variant);
	} catch {
		// The converter could not load: show the text as the pack wrote it.
		variant = 'original';
	}
	const lesson =
		variant === 'original'
			? view.lesson
			: convertLesson(view.lesson, (s) => convertText(s, variant));
	const textLang = studyLang(language, { variant }) ?? language;
	return { view, lesson, textLang };
}
