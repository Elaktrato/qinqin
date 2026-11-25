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

	it('reads short hex and rgb()/rgba() too, and always sends #rrggbb', () => {
		expect(barStyle('#fff')).toEqual({ background: '#ffffff', darkIcons: true });
		expect(barStyle('#0008')).toEqual({ background: '#000000', darkIcons: false });
		expect(barStyle('rgb(227, 244, 250)')).toEqual({ background: '#e3f4fa', darkIcons: true });
		expect(barStyle('rgba(32 21 51 / 0.8)')).toEqual({ background: '#201533', darkIcons: false });
		expect(barStyle('rgb(32,21,51,0.5)')).toEqual({ background: '#201533', darkIcons: false });
	});

	it('is null for anything that is not a colour it can read', () => {
		for (const v of ['', 'red', 'rgb(1, 2)', 'rgb(300, 2, 3)', '#ff', '#fffff', 'var(--chrome)', 'color-mix(in srgb, red, blue)'])
			expect(barStyle(v), v).toBeNull();
	});
});
