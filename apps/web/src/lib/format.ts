import { t, type MessageKey } from '$lib/i18n';

// Reading types a language pack may attach to an entry. Types outside
// this map are pack-defined extensions and render as their value alone.
const READING_LABELS: Record<string, MessageKey> = {
	pinyin: 'entry.reading.pinyin',
	bopomofo: 'entry.reading.bopomofo',
	kana: 'entry.reading.kana',
	romaji: 'entry.reading.romaji',
	on: 'entry.reading.on',
	kun: 'entry.reading.kun'
};

/**
 * formatReading turns a reading type and value into its display form,
 * e.g. "Pinyin: hàn". The value is kept verbatim so tone marks, kana,
 * and bopomofo survive untouched. Unknown types render as the value
 * alone rather than inventing a label.
 */
export function formatReading(type: string, value: string): string {
	const key = type.trim().toLowerCase();
	const label = Object.hasOwn(READING_LABELS, key) ? READING_LABELS[key] : undefined;
	return label ? t('entry.reading.withLabel', { label: t(label), value }) : value;
}

/** The interface label of a reading type ("Pinyin"), or null for a pack-defined type shown as its value alone. */
export function readingLabel(type: string): string | null {
	const key = type.trim().toLowerCase();
	return Object.hasOwn(READING_LABELS, key) ? t(READING_LABELS[key]) : null;
}
