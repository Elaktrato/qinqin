// The study modal's pure view (the study modal design, 4.1): which card-type
// chips show and how a click changes the setup, and the wording of its lines.

import { t, type MessageKey } from '$lib/i18n';
import { profileOf } from '$lib/languages/profiles';
import { CARD_TYPES, type StudySessionMode } from '$lib/study/session';
import { setupKinds, type SetupNote, type StudySetup } from '$lib/study/setup';
import { CARD_KINDS, OPT_IN_KINDS, type OptInKind, type StudyCardKind } from '$lib/study/types';

export interface ChipView {
	id: StudyCardKind;
	label: string;
	checked: boolean;
	/** The last selected kind: it cannot be unchecked. */
	locked: boolean;
}

function isOptIn(kind: StudyCardKind): kind is OptInKind {
	return OPT_IN_KINDS.includes(kind as OptInKind);
}

/**
 * visibleChips: the kinds the language offers; Reverse and Cloze only when a
 * selected deck switches them on (`enabled`), and never for a level session.
 */
export function visibleChips(setup: StudySetup, enabled: ReadonlySet<OptInKind>, language: string): ChipView[] {
	const offered = profileOf(language).cardKinds;
	const selected = setupKinds(setup, enabled, language).filter((kind) => setup.mode === 'decks' || !isOptIn(kind));
	return CARD_KINDS.filter((kind) => offered.includes(kind) && (!isOptIn(kind) || (setup.mode === 'decks' && enabled.has(kind)))).map(
		(kind) => {
			const checked = selected.includes(kind);
			return {
				id: kind,
				label: CARD_TYPES.find((type) => type.id === kind)?.label ?? kind,
				checked,
				locked: checked && selected.length === 1
			};
		}
	);
}

/** toggleChip: the setup after a click on `id`; an opt-in chip changes only `unchecked`; nothing selected is refused. */
export function toggleChip(setup: StudySetup, id: StudyCardKind, enabled: ReadonlySet<OptInKind>, language: string): StudySetup {
	let next: StudySetup;
	if (isOptIn(id)) {
		next = setup.unchecked.includes(id)
			? { ...setup, unchecked: setup.unchecked.filter((kind) => kind !== id) }
			: { ...setup, unchecked: OPT_IN_KINDS.filter((kind) => kind === id || setup.unchecked.includes(kind)) };
	} else {
		next = setup.cardTypes.includes(id)
			? { ...setup, cardTypes: setup.cardTypes.filter((kind) => kind !== id) }
			: { ...setup, cardTypes: CARD_KINDS.filter((kind) => kind === id || setup.cardTypes.includes(kind)) };
	}
	return visibleChips(next, enabled, language).some((chip) => chip.checked) ? next : setup;
}

export function summaryLine(input: {
	mode: StudySessionMode;
	due: number;
	fresh: number;
	decks: number;
	scheme: string | null;
	level: string | null;
}): string {
	if (input.mode === 'levels') {
		return t('study.modal.summaryLevel', { scheme: input.scheme ?? '', level: input.level ?? '', due: input.due, fresh: input.fresh });
	}
	return t('study.modal.summaryDecks', { due: input.due, fresh: input.fresh, decks: input.decks });
}

/** todayLine: the cards Start plans, or why it cannot start. */
export function todayLine(session: number, guidance: string): string {
	return guidance !== '' ? guidance : t('study.modal.session', { count: session });
}

const NOTE_KEYS: Record<SetupNote, MessageKey> = {
	levelGone: 'study.modal.note.levelGone',
	decksGone: 'study.modal.note.decksGone',
	typesGone: 'study.modal.note.typesGone'
};

/** noteText: the one line that says the saved setup was repaired, or null. */
export function noteText(notes: readonly SetupNote[]): string | null {
	return notes.length === 0 ? null : notes.map((note) => t(NOTE_KEYS[note])).join(' ');
}
