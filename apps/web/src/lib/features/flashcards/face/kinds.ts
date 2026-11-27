// The session's names of the six card kinds (#101, design §9): the exercise
// the learner is doing. Settings, decks and the XP breakdown keep the card
// type names (study.cardType.*).
import { t } from '$lib/i18n';
import type { StudyCardKind } from '$lib/studycore/types';

export const KIND_TASK_LABELS: Readonly<Record<StudyCardKind, string>> = {
	get vocab() {
		return t('study.session.kind.vocab');
	},
	get reverse() {
		return t('study.session.kind.reverse');
	},
	get cloze() {
		return t('study.session.kind.cloze');
	},
	get sentence() {
		return t('study.session.kind.sentence');
	},
	get writing() {
		return t('study.session.kind.writing');
	},
	get tone() {
		return t('study.session.kind.tone');
	}
};
