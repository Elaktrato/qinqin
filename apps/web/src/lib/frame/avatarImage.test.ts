import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/auth/avatar.json';
import { AVATAR_PX, avatarSrc } from './avatarImage';

const url = fixture.upload.body.avatarUrl;

describe('avatarSrc', () => {
	it('takes the 64 px file while it covers the drawn size in device pixels', () => {
		expect(avatarSrc(url, 28, 1)).toBe(`${url}?size=64`);
		expect(avatarSrc(url, 28, 2)).toBe(`${url}?size=64`);
		expect(avatarSrc(url, 32, 2)).toBe(`${url}?size=64`);
	});

	it('takes the 256 px file beyond that (a dense phone screen, the menu header, the settings preview)', () => {
		expect(avatarSrc(url, 28, 3)).toBe(url);
		expect(avatarSrc(url, 36, 2)).toBe(url);
		expect(avatarSrc(url, 96, 1)).toBe(url);
	});

	it('reads a missing or odd pixel ratio as 1', () => {
		expect(avatarSrc(url, 28, 0)).toBe(`${url}?size=64`);
		expect(avatarSrc(url, 28, Number.NaN)).toBe(`${url}?size=64`);
	});

	it('names the files the contract names', () => {
		expect(fixture.picture_small.request.path.endsWith('?size=64')).toBe(true);
		expect(fixture.picture.image.width).toBe(256);
		expect(fixture.picture_small.image.width).toBe(64);
	});

	it('has a drawn size for every avatar size', () => {
		expect(AVATAR_PX).toEqual({ m: 28, l: 36, xl: 96 });
	});
});
