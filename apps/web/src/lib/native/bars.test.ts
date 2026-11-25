import { describe, expect, it } from 'vitest';
import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { barStyle } from './bars';

describe('barStyle', () => {
	it('qinqin Day (light chrome) gets dark icons, qinqin Night (dark chrome) light icons', () => {
		const [day, night] = FALLBACK_THEMES;
		expect(barStyle(day.colors.chrome)).toEqual({ background: '#e3f4fa', darkIcons: true });
		expect(barStyle(night.colors.chrome)).toEqual({ background: '#201533', darkIcons: false });
	});

	it('picks the icon colour that contrasts more, also for mid tones', () => {
		expect(barStyle('#ffffff')?.darkIcons).toBe(true);
		expect(barStyle('#000000')?.darkIcons).toBe(false);
		expect(barStyle('#0b6bcb')?.darkIcons).toBe(false);
		expect(barStyle('#ffc857')?.darkIcons).toBe(true);
	});

	it('reads what getPropertyValue returns: spaces, case, an alpha channel', () => {
		expect(barStyle(' #E3F4FA ')).toEqual({ background: '#e3f4fa', darkIcons: true });
		expect(barStyle('#201533cc')).toEqual({ background: '#201533', darkIcons: false });
	});

	it('is null for anything that is not a colour', () => {
		for (const v of ['', 'red', 'rgb(1, 2, 3)', '#fff', 'var(--chrome)']) expect(barStyle(v), v).toBeNull();
	});
});
