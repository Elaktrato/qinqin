// Small pure helpers for the source browser and the reader popup.

import { displayForm, type DisplayEntry } from '../../entry/displayForm';
import type { StudyDay } from '../../time/studyDay';

/**
 * browseSeed is the seed of the daily browse assortment: the learner's
 * date, as the server uses by default, so "Suggestions for today" is the
 * same list all day long on every device.
 */
export function browseSeed(now: Date, day: StudyDay): string {
	return day.today(now.getTime());
}

/** shuffleSeed is a random seed for the Shuffle button (never a date, at most 64 characters). */
export function shuffleSeed(random: () => number = Math.random): string {
	return `s${Math.floor(random() * 2 ** 40).toString(36)}`;
}

/**
 * popupWritten is the written form snapshotted onto a study card added from
 * a lookup popup: the entry's display form (contract
 * reader/popup-written.json: の, not the search-only 乃; こと for the
 * usually-kana 事), else the looked-up term.
 */
export function popupWritten(r: DisplayEntry & { term: string }): string {
	return displayForm(r) || r.term;
}
