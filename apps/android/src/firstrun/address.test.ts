import { describe, expect, it } from 'vitest';
import { isPrivateHost, normalizeAddress } from './address';

describe('isPrivateHost', () => {
	it.each([
		'localhost',
		'foo.localhost',
		'nas.local',
		'qinqin',
		'127.0.0.1',
		'127.8.9.10',
		'10.0.0.5',
		'10.0.2.2',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.1.20',
		'169.254.10.10',
		'[::1]',
		'[fd12:3456::1]',
		'[fc00::1]',
		'[fe80::1]'
	])('%s is private', (h) => expect(isPrivateHost(h)).toBe(true));

	it.each([
		'example.com',
		'host.local.evil.com',
		'qinqin.local.example.org',
		'8.8.8.8',
		'172.15.0.1',
		'172.32.0.1',
		'192.169.0.1',
		'11.0.0.1',
		'100.64.0.1',
		'[2001:db8::1]',
		'[2a00:1450::1]',
		'1.2.3.4.5.com'
	])('%s is public', (h) => expect(isPrivateHost(h)).toBe(false));
});

describe('normalizeAddress', () => {
	it('adds https when the scheme is missing and trims', () => {
		expect(normalizeAddress('  qinqin.example.org  ')).toMatchObject({
			ok: true,
			url: 'https://qinqin.example.org',
			cleartext: false
		});
	});

	it('strips trailing slash, path, query and fragment: the app lives at the root', () => {
		const r = normalizeAddress('https://qinqin.example.org/study/today?x=1#top');
		expect(r).toMatchObject({ ok: true, url: 'https://qinqin.example.org', droppedPath: true });
		expect(normalizeAddress('https://q.example.org/')).toMatchObject({ url: 'https://q.example.org', droppedPath: false });
	});

	it('keeps a port and drops the default one', () => {
		expect(normalizeAddress('https://q.example.org:8443')).toMatchObject({ url: 'https://q.example.org:8443' });
		expect(normalizeAddress('https://q.example.org:443')).toMatchObject({ url: 'https://q.example.org' });
	});

	it('lowercases the host', () => {
		expect(normalizeAddress('HTTPS://Q.Example.ORG')).toMatchObject({ url: 'https://q.example.org' });
	});

	it('allows http for private addresses with a cleartext flag', () => {
		expect(normalizeAddress('http://192.168.1.20:8085')).toMatchObject({
			ok: true,
			url: 'http://192.168.1.20:8085',
			cleartext: true
		});
		expect(normalizeAddress('http://10.0.2.2:8085/')).toMatchObject({ ok: true, cleartext: true });
		expect(normalizeAddress('http://nas.local')).toMatchObject({ ok: true, cleartext: true });
		expect(normalizeAddress('http://[::1]:8085')).toMatchObject({ ok: true, url: 'http://[::1]:8085' });
	});

	it('a bare private address gets https (the person adds http on purpose)', () => {
		expect(normalizeAddress('192.168.1.20:8085')).toMatchObject({ ok: true, url: 'https://192.168.1.20:8085', cleartext: false });
	});

	it('refuses http for a public address', () => {
		expect(normalizeAddress('http://example.com')).toEqual({ ok: false, reason: 'insecurePublic' });
		expect(normalizeAddress('http://8.8.8.8')).toEqual({ ok: false, reason: 'insecurePublic' });
	});

	it('refuses other schemes, credentials, empty and garbage', () => {
		expect(normalizeAddress('ftp://example.com')).toEqual({ ok: false, reason: 'scheme' });
		expect(normalizeAddress('javascript://example.com/%0Aalert(1)')).toEqual({ ok: false, reason: 'scheme' });
		expect(normalizeAddress('https://me:pw@example.com')).toEqual({ ok: false, reason: 'credentials' });
		expect(normalizeAddress('')).toEqual({ ok: false, reason: 'empty' });
		expect(normalizeAddress('   ')).toEqual({ ok: false, reason: 'empty' });
		expect(normalizeAddress('https://')).toEqual({ ok: false, reason: 'invalid' });
		expect(normalizeAddress('not a url')).toEqual({ ok: false, reason: 'invalid' });
		expect(normalizeAddress('https://exa mple.com')).toEqual({ ok: false, reason: 'invalid' });
		expect(normalizeAddress('https://example.com:99999')).toEqual({ ok: false, reason: 'invalid' });
	});

	it('does not treat a lookalike as private', () => {
		expect(normalizeAddress('http://localhost.evil.com')).toEqual({ ok: false, reason: 'insecurePublic' });
		expect(normalizeAddress('http://192.168.1.1.evil.com')).toEqual({ ok: false, reason: 'insecurePublic' });
	});

	it('reads a numeric shorthand as the address the browser reads', () => {
		expect(normalizeAddress('http://2130706433')).toMatchObject({ ok: true, url: 'http://127.0.0.1' });
	});

	it('strips a trailing dot of the host', () => {
		expect(normalizeAddress('https://q.example.org.')).toMatchObject({ url: 'https://q.example.org' });
	});
});
