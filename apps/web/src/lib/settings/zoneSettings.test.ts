import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { canonicalZone, changeErrorMessage, mismatch, zoneLabel, zoneOptions } from './zoneSettings';

describe('canonicalZone', () => {
	it('maps aliases to one name', () => {
		expect(canonicalZone('Asia/Calcutta')).toBe(canonicalZone('Asia/Kolkata'));
		expect(canonicalZone('Europe/Berlin')).toBe(canonicalZone('Europe/Berlin'));
	});
	it('returns the input when the zone is unknown', () => {
		expect(canonicalZone('Mars/Base')).toBe('Mars/Base');
	});
});

describe('mismatch', () => {
	it('is null when the zones are the same or aliases', () => {
		expect(mismatch('Asia/Kolkata', 'Asia/Calcutta')).toBeNull();
		expect(mismatch('Europe/Berlin', 'Europe/Berlin')).toBeNull();
	});
	it('is null without a device zone', () => {
		expect(mismatch('Europe/Berlin', null)).toBeNull();
	});
	it('names the device zone when it differs', () => {
		expect(mismatch('Europe/Berlin', 'Asia/Tokyo')).toBe('Asia/Tokyo');
	});
});

describe('zoneOptions', () => {
	const supported = ['Africa/Cairo', 'America/New_York', 'America/Argentina/Buenos_Aires', 'Asia/Tokyo', 'Europe/Berlin'];
	it('lists everything for an empty query with the current zone first', () => {
		const out = zoneOptions(supported, 'Asia/Tokyo', '');
		expect(out[0]).toBe('Asia/Tokyo');
		expect(out).toHaveLength(supported.length);
	});
	it('filters case-insensitively and treats / and _ as spaces', () => {
		expect(zoneOptions(supported, 'Europe/Berlin', 'new york')).toEqual(['Europe/Berlin', 'America/New_York']);
		expect(zoneOptions(supported, 'Europe/Berlin', 'AMERICA/ARG')).toEqual(['Europe/Berlin', 'America/Argentina/Buenos_Aires']);
		expect(zoneOptions(supported, 'Europe/Berlin', 'buenos aires')).toContain('America/Argentina/Buenos_Aires');
	});
	it('keeps the current zone even when it does not match or is not supported', () => {
		expect(zoneOptions(supported, 'Mars/Base', 'tokyo')).toEqual(['Mars/Base', 'Asia/Tokyo']);
	});
	it('offers only the current zone when the runtime cannot list zones', () => {
		expect(zoneOptions(undefined, 'Europe/Berlin', '')).toEqual(['Europe/Berlin']);
		expect(zoneOptions(undefined, 'Europe/Berlin', 'tokyo')).toEqual(['Europe/Berlin']);
	});
	it('lists no duplicate of the current zone', () => {
		const out = zoneOptions(supported, 'Asia/Tokyo', 'tokyo');
		expect(out).toEqual(['Asia/Tokyo']);
	});
});

describe('zoneLabel', () => {
	const now = Date.parse('2026-11-15T12:00:00Z');
	it('shows the offset in force now', () => {
		expect(zoneLabel('Asia/Tokyo', now)).toBe('Asia/Tokyo (UTC+09:00)');
		expect(zoneLabel('Europe/Berlin', now)).toBe('Europe/Berlin (UTC+01:00)');
		expect(zoneLabel('Europe/Berlin', Date.parse('2026-07-15T12:00:00Z'))).toBe('Europe/Berlin (UTC+02:00)');
		expect(zoneLabel('Asia/Kathmandu', now)).toBe('Asia/Kathmandu (UTC+05:45)');
		expect(zoneLabel('UTC', now)).toBe('UTC (UTC+00:00)');
	});
	it('is the plain name for an unknown zone', () => {
		expect(zoneLabel('Mars/Base', now)).toBe('Mars/Base');
	});
});

describe('changeErrorMessage', () => {
	it('explains a rejected zone', () => {
		const err = new ApiError(400, JSON.stringify({ error: 'unknown_time_zone', message: 'unknown time zone' }));
		expect(changeErrorMessage(err)).toMatch(/not a time zone/i);
	});
	it('explains a full history', () => {
		const err = new ApiError(409, JSON.stringify({ error: 'too_many_changes', message: 'x' }));
		expect(changeErrorMessage(err)).toMatch(/too many/i);
	});
	it('falls back for anything else', () => {
		expect(changeErrorMessage(new ApiError(500, 'boom'))).toMatch(/could not change/i);
		expect(changeErrorMessage(new Error('x'))).toMatch(/could not change/i);
	});
});
