import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bridgeCompatibility, classifyFailure, verifyServer, type HttpFn } from './verify';

const fixture = JSON.parse(readFileSync(new URL('../../../../docs/contracts/version/bridge-compat.json', import.meta.url), 'utf8'));
const answer = JSON.parse(readFileSync(new URL('../../../../docs/contracts/version/version.json', import.meta.url), 'utf8')).anonymous;

describe('bridgeCompatibility matches the contract fixture', () => {
	for (const c of fixture.cases) {
		it(c.name, () => expect(bridgeCompatibility(c.server, c.shell)).toEqual(c.want));
	}
});

const ok = (over: object = {}): HttpFn => async (url) => ({ status: 200, url, data: { ...answer, ...over } });

describe('verifyServer', () => {
	it('accepts a qinqin answer and reports its version', async () => {
		const r = await verifyServer('https://q.example.org', ok(), { level: 1, features: [] });
		expect(r).toEqual({ ok: true, version: '0.6.0', compat: { status: 'ok', missing: [] }, bridge: answer.bridge });
	});

	it('asks GET /api/version of the origin', async () => {
		let asked = '';
		await verifyServer('https://q.example.org', async (url) => ((asked = url), { status: 200, url, data: answer }), { level: 1, features: [] });
		expect(asked).toBe('https://q.example.org/api/version');
	});

	it('accepts the body as a JSON string', async () => {
		const http: HttpFn = async (url) => ({ status: 200, url, data: JSON.stringify(answer) });
		expect(await verifyServer('https://q.example.org', http, { level: 1, features: [] })).toMatchObject({ ok: true });
	});

	it('warns when the shell is older than the server asks', async () => {
		const r = await verifyServer('https://q.example.org', ok({ bridge: { level: 2, features: ['tts'] } }), { level: 1, features: [] });
		expect(r).toMatchObject({ ok: true, compat: { status: 'shellOutdated', missing: ['tts'] } });
	});

	it('refuses an app that is not qinqin', async () => {
		expect(await verifyServer('https://q.example.org', ok({ app: 'other' }), { level: 1, features: [] })).toEqual({ ok: false, kind: 'notQinqin' });
	});

	it('refuses a body that is not the answer (an HTML page, a 404, a missing version)', async () => {
		const shell = { level: 1, features: [] };
		const html: HttpFn = async (url) => ({ status: 200, url, data: '<html></html>' });
		const nf: HttpFn = async (url) => ({ status: 404, url, data: 'not found' });
		expect(await verifyServer('https://q.example.org', html, shell)).toEqual({ ok: false, kind: 'notQinqin' });
		expect(await verifyServer('https://q.example.org', nf, shell)).toEqual({ ok: false, kind: 'notQinqin' });
		expect(await verifyServer('https://q.example.org', ok({ version: 3 }), shell)).toEqual({ ok: false, kind: 'notQinqin' });
		expect(await verifyServer('https://q.example.org', ok({ bridge: null }), shell)).toEqual({ ok: false, kind: 'notQinqin' });
	});

	it('names a redirect to another origin and offers its address', async () => {
		const http: HttpFn = async () => ({ status: 200, url: 'https://other.example.net/api/version', data: answer });
		expect(await verifyServer('https://q.example.org', http, { level: 1, features: [] })).toEqual({
			ok: false,
			kind: 'redirect',
			target: 'https://other.example.net'
		});
	});

	it('a redirect from http to https of the same host is a redirect too', async () => {
		const http: HttpFn = async () => ({ status: 200, url: 'https://192.168.1.2:8443/api/version', data: answer });
		expect(await verifyServer('http://192.168.1.2:8085', http, { level: 1, features: [] })).toMatchObject({ ok: false, kind: 'redirect', target: 'https://192.168.1.2:8443' });
	});

	it('an unfollowed 3xx with a Location on another origin is a redirect (http to https)', async () => {
		const http: HttpFn = async (url) => ({ status: 301, url, data: '', headers: { location: 'https://192.168.1.2:8443/api/version' } });
		expect(await verifyServer('http://192.168.1.2:8085', http, { level: 1, features: [] })).toEqual({
			ok: false,
			kind: 'redirect',
			target: 'https://192.168.1.2:8443'
		});
		const rel: HttpFn = async (url) => ({ status: 302, url, data: '', headers: { Location: 'https://q.example.org/api/version' } });
		expect(await verifyServer('http://q.example.org', rel, { level: 1, features: [] })).toMatchObject({ kind: 'redirect', target: 'https://q.example.org' });
	});

	it('a 3xx without a usable Location, or to the same origin, is not qinqin', async () => {
		const none: HttpFn = async (url) => ({ status: 302, url, data: '' });
		expect(await verifyServer('https://q.example.org', none, { level: 1, features: [] })).toEqual({ ok: false, kind: 'notQinqin' });
		const same: HttpFn = async (url) => ({ status: 302, url, data: '', headers: { location: '/login' } });
		expect(await verifyServer('https://q.example.org', same, { level: 1, features: [] })).toEqual({ ok: false, kind: 'notQinqin' });
	});

	it('classifies thrown errors', async () => {
		const throwing = (e: unknown): HttpFn => async () => {
			throw e;
		};
		const shell = { level: 1, features: [] };
		expect(await verifyServer('https://q.example.org', throwing({ code: 'SSLHandshakeException', message: 'x' }), shell)).toEqual({ ok: false, kind: 'tls' });
		expect(await verifyServer('https://q.example.org', throwing({ code: 'SocketTimeoutException', message: 'timeout' }), shell)).toEqual({ ok: false, kind: 'timeout' });
		expect(await verifyServer('https://q.example.org', throwing({ code: 'UnknownHostException', message: 'x' }), shell)).toEqual({ ok: false, kind: 'unreachable' });
		expect(await verifyServer('https://q.example.org', throwing(new Error('boom')), shell)).toEqual({ ok: false, kind: 'unreachable' });
	});
});

describe('classifyFailure', () => {
	it.each([
		[{ code: 'SSLPeerUnverifiedException' }, 'tls'],
		[{ message: 'java.security.cert.CertPathValidatorException: Trust anchor for certification path not found' }, 'tls'],
		[{ code: 'ConnectException' }, 'unreachable'],
		[{ code: 'SocketTimeoutException' }, 'timeout'],
		[{ message: 'Request timed out' }, 'timeout'],
		[undefined, 'unreachable']
	])('%j -> %s', (e, kind) => expect(classifyFailure(e)).toBe(kind));
});
