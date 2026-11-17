// Pure logic of Settings → Study: zone names, the device-zone notice and
// the select's options. The component stays thin.

import { apiErrorBody } from '../api/client';
import { t } from '../i18n';

/**
 * canonicalZone resolves aliases through the runtime's own database
 * (Chrome reports `Asia/Calcutta` where Firefox and Go say
 * `Asia/Kolkata`); an unknown zone is returned as given.
 */
export function canonicalZone(zone: string): string {
	try {
		return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
	} catch {
		return zone;
	}
}

/** mismatch returns the device zone when it names a different zone than `current`, else null. */
export function mismatch(current: string, device: string | null): string | null {
	if (!device) return null;
	return canonicalZone(current) === canonicalZone(device) ? null : device;
}

function words(value: string): string {
	return value.toLowerCase().replace(/[/_]/g, ' ');
}

/**
 * zoneOptions lists the zones the select offers: the current zone first
 * (always), then every supported zone matching the query (case-insensitive,
 * `/` and `_` match as spaces). Without `Intl.supportedValuesOf` only the
 * current zone is offered.
 */
export function zoneOptions(
	supported: readonly string[] | undefined,
	current: string,
	query: string
): string[] {
	if (!supported) return [current];
	const q = words(query.trim());
	const all = supported.includes('UTC') ? supported : [...supported, 'UTC'];
	const rest = all.filter((zone) => zone !== current && (q === '' || words(zone).includes(q)));
	return [current, ...rest];
}

/**
 * zoneMatchText is the live count while searching time zones (#12),
 * matching the same way as zoneOptions; '' with no query or zone list.
 */
export function zoneMatchText(supported: readonly string[] | undefined, query: string): string {
	const q = words(query.trim());
	if (!supported || q === '') return '';
	const all = supported.includes('UTC') ? supported : [...supported, 'UTC'];
	const n = all.filter((zone) => words(zone).includes(q)).length;
	if (n === 0) return t('settings.zone.noMatch', { query: query.trim() });
	return t('settings.zone.matches', { count: n });
}

/** zoneLabel is "Asia/Tokyo (UTC+09:00)" with the offset in force at `now`. */
export function zoneLabel(zone: string, now: number): string {
	try {
		const parts = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(now);
		const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
		const offset = name === 'GMT' ? '+00:00' : name.replace('GMT', '').replace('\u2212', '-');
		return /^[+-]\d\d:\d\d$/.test(offset) ? `${zone} (UTC${offset})` : zone;
	} catch {
		return zone;
	}
}

/** changeErrorMessage words a failed zone change for the learner. */
export function changeErrorMessage(err: unknown): string {
	switch (apiErrorBody(err)?.error) {
		case 'unknown_time_zone':
			return t('settings.zone.unknown');
		case 'too_many_changes':
			return t('settings.zone.tooMany');
		default:
			return t('settings.zone.failed');
	}
}
