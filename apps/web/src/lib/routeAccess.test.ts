import { describe, expect, it } from 'vitest';
import {
	allowed,
	normalizePath,
	redirectTarget,
	redirectsOnUnauthorized,
	routeAccess
} from './routeAccess';

describe('normalizePath', () => {
	it('drops trailing slashes and keeps the root', () => {
		expect(normalizePath('/sources/')).toBe('/sources');
		expect(normalizePath('/sources//')).toBe('/sources');
		expect(normalizePath('/')).toBe('/');
		expect(normalizePath('')).toBe('/');
	});
});

describe('routeAccess', () => {
	it('classifies the auth pages', () => {
		expect(routeAccess('/login')).toBe('auth-only');
		expect(routeAccess('/register/')).toBe('auth-only');
	});

	it('classifies the Sources page as open, with or without a trailing slash', () => {
		expect(routeAccess('/sources')).toBe('open');
		expect(routeAccess('/sources/')).toBe('open');
	});

	it('matches exactly: no prefix or subpath matches', () => {
		expect(routeAccess('/sourcesx')).toBe('private');
		expect(routeAccess('/sources/extra')).toBe('private');
		expect(routeAccess('/loginx')).toBe('private');
		expect(routeAccess('/SOURCES')).toBe('private');
	});

	it('treats everything else as private', () => {
		expect(routeAccess('/')).toBe('private');
		expect(routeAccess('/study')).toBe('private');
		expect(routeAccess('/settings')).toBe('private');
		expect(routeAccess('/stats')).toBe('private');
		expect(routeAccess('/stats/characters')).toBe('private');
		expect(routeAccess('/study/map')).toBe('private');
		expect(routeAccess('/no-such-page')).toBe('private');
	});
});

describe('allowed', () => {
	it('renders nothing before the session has booted', () => {
		expect(allowed('/sources', false, false)).toBe(false);
		expect(allowed('/sources', true, false)).toBe(false);
		expect(allowed('/login', false, false)).toBe(false);
	});

	it('shows the auth pages only signed out', () => {
		expect(allowed('/login', false, true)).toBe(true);
		expect(allowed('/login', true, true)).toBe(false);
	});

	it('shows open pages either way', () => {
		expect(allowed('/sources', false, true)).toBe(true);
		expect(allowed('/sources/', true, true)).toBe(true);
	});

	it('shows private pages only signed in', () => {
		expect(allowed('/study', true, true)).toBe(true);
		expect(allowed('/study', false, true)).toBe(false);
		expect(allowed('/sourcesx', false, true)).toBe(false);
	});
});

describe('redirectTarget', () => {
	it('sends a signed-in user from the auth pages home', () => {
		expect(redirectTarget('/login', true)).toBe('/');
		expect(redirectTarget('/register', true)).toBe('/');
		expect(redirectTarget('/login', false)).toBeNull();
	});

	it('never redirects from the Sources page', () => {
		expect(redirectTarget('/sources', false)).toBeNull();
		expect(redirectTarget('/sources/', true)).toBeNull();
	});

	it('sends a signed-out visitor on any other path to /login', () => {
		expect(redirectTarget('/study', false)).toBe('/login');
		expect(redirectTarget('/unknown/path', false)).toBe('/login');
		expect(redirectTarget('/sources/extra', false)).toBe('/login');
		expect(redirectTarget('/study', true)).toBeNull();
	});
});

describe('redirectsOnUnauthorized', () => {
	it('redirects on private pages only', () => {
		expect(redirectsOnUnauthorized('/study')).toBe(true);
		expect(redirectsOnUnauthorized('/')).toBe(true);
		expect(redirectsOnUnauthorized('/login')).toBe(false);
		expect(redirectsOnUnauthorized('/register')).toBe(false);
		expect(redirectsOnUnauthorized('/sources')).toBe(false);
	});
});
