// Reading types a language pack may attach to an entry. Types outside
// this map are pack-defined extensions and render as their value alone.
const READING_LABELS: Record<string, string> = {
	pinyin: 'Pinyin',
	bopomofo: 'Bopomofo',
	kana: 'Kana',
	romaji: 'Romaji',
	on: 'On',
	kun: 'Kun'
};

/**
 * formatReading turns a reading type and value into its display form,
 * e.g. "Pinyin: hàn". The value is kept verbatim so tone marks, kana,
 * and bopomofo survive untouched. Unknown types render as the value
 * alone rather than inventing a label.
 */
export function formatReading(type: string, value: string): string {
	const key = type.trim().toLowerCase();
	const label = READING_LABELS[key];
	return label ? `${label}: ${value}` : value;
}
