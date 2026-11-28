// The labels of a grade button's next interval (#101): `<1m`, `6m`, `3h`,
// `1d`, `2 mths`, `1.4y` in English, the locale's own unit letters elsewhere,
// and the long form for screen readers ("in 6 minutes"). The buckets are a
// contract (docs/contracts/scheduler/README.md, "Interval text"; fixture
// interval-text.json); the text is the format locale's.

import { t } from '$lib/i18n';
import { formatNumber, formatRelative } from '$lib/i18n/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type IntervalUnit = 'lessThanMinute' | 'minute' | 'hour' | 'day' | 'month' | 'year';

export interface IntervalParts {
	unit: IntervalUnit;
	value: number;
}

/** intervalParts: the bucket and the number shown for `ms` from now to a due. */
export function intervalParts(ms: number): IntervalParts {
	if (!(ms > MINUTE)) return { unit: 'lessThanMinute', value: 1 };
	if (ms < HOUR) return { unit: 'minute', value: Math.max(1, Math.round(ms / MINUTE)) };
	if (ms < DAY) return { unit: 'hour', value: Math.round(ms / HOUR) };
	const days = ms / DAY;
	if (days < 30) return { unit: 'day', value: Math.round(days) };
	if (days < 365) return { unit: 'month', value: Math.max(1, Math.round(days / 30)) };
	return { unit: 'year', value: Math.round((days / 365) * 10) / 10 };
}

type Unit = 'minute' | 'hour' | 'day' | 'month' | 'year';

function unitText(value: number, unit: Unit): string {
	const narrow = formatNumber(value, { style: 'unit', unit, unitDisplay: 'narrow' });
	// Some locales (English) write a narrow month like a narrow minute ("2m"):
	// the month then takes its short form ("2 mths") so the two never read alike.
	if (unit === 'month' && narrow === formatNumber(value, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' })) {
		return formatNumber(value, { style: 'unit', unit, unitDisplay: 'short' });
	}
	return narrow;
}

/** shortInterval: the visible label under a grade name. */
export function shortInterval(ms: number): string {
	const { unit, value } = intervalParts(ms);
	if (unit === 'lessThanMinute') return t('study.interval.under', { lt: '<', value: unitText(1, 'minute') });
	return unitText(value, unit);
}

/** longInterval: the same interval for screen readers ("in 6 minutes", "in 1 day"). */
export function longInterval(ms: number): string {
	const { unit, value } = intervalParts(ms);
	return formatRelative(value, unit === 'lessThanMinute' ? 'minute' : unit);
}
