import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCatalogue, resetCatalogue } from '$lib/i18n';
import en from '$lib/i18n/messages/en.json';
import { pseudoCatalogue } from '$lib/i18n/pseudo';
import { intervalParts, longInterval, shortInterval } from './intervalText';

const fixture = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../../docs/contracts/scheduler/interval-text.json'), 'utf8')
) as { cases: { ms: number; unit: string; value: number; note: string }[] };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

afterEach(() => resetCatalogue());

describe('intervalText (#101)', () => {
	describe('decodes interval-text.json (unit and value)', () => {
		for (const c of fixture.cases) {
			it(`${c.ms} ms: ${c.note}`, () => {
				expect(intervalParts(c.ms)).toEqual({ unit: c.unit, value: c.value });
			});
		}
	});

	it('short labels in English: <1m, 6m, 3h, 1d, 4d, 2 mths, 1.4y', () => {
		installCatalogue('en', en, 'en');
		expect(shortInterval(MIN)).toBe('<1m');
		expect(shortInterval(6 * MIN)).toBe('6m');
		expect(shortInterval(3 * HOUR)).toBe('3h');
		expect(shortInterval(DAY)).toBe('1d');
		expect(shortInterval(4 * DAY)).toBe('4d');
		// English narrow months read "2m" like minutes: the short month form is used then.
		expect(shortInterval(60 * DAY)).toBe('2 mths');
		expect(shortInterval(1.44 * 365 * DAY)).toBe('1.4y');
	});

	it('long labels: in 6 minutes, in 1 day', () => {
		installCatalogue('en', en, 'en');
		expect(longInterval(6 * MIN)).toBe('in 6 minutes');
		expect(longInterval(DAY)).toBe('in 1 day');
		expect(longInterval(30 * 1000)).toBe('in 1 minute');
		expect(longInterval(1.44 * 365 * DAY)).toBe('in 1.4 years');
	});

	it('a German format locale gives German unit letters', () => {
		installCatalogue('en', en, 'de');
		expect(shortInterval(6 * MIN)).toBe('6 Min.');
		expect(shortInterval(1.44 * 365 * DAY)).toBe('1,4 J');
		expect(shortInterval(60 * DAY)).toBe('2 M');
		expect(longInterval(DAY)).toBe('in 1 Tag');
	});

	it('the pseudo locale wraps the under-a-minute text', () => {
		installCatalogue('en-XA', pseudoCatalogue(en), 'en');
		const out = shortInterval(0);
		expect(out.startsWith('⟦')).toBe(true);
		expect(out.endsWith('⟧')).toBe(true);
		expect(out).toContain('1m');
	});
});
