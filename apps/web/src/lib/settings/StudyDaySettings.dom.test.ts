import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/time/zone', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/time/zone')>()),
	browserZone: vi.fn()
}));

import { ApiError } from '$lib/api/client';
import { studyDay } from '$lib/time/studyDay';
import * as zone from '$lib/time/zone';
import { testContext, type TestContext } from '$lib/testing/context';
import { primaryActions } from '$lib/ui/testing/primary';
import StudyDaySettings from './StudyDaySettings.svelte';

let ctx: TestContext;
/** The session's StudyDays, spied (record 0009), and the mocked browser zone. */
let z: {
	browserZone: ReturnType<typeof vi.mocked<typeof zone.browserZone>>;
	currentHistory: ReturnType<typeof vi.spyOn>;
	currentStudyDay: ReturnType<typeof vi.spyOn>;
	changeZone: ReturnType<typeof vi.spyOn>;
};
const realSupported = Intl.supportedValuesOf;

function setup(history: { zone: string; from: string | null }[], device: string | null) {
	z.currentHistory.mockReturnValue(history);
	z.currentStudyDay.mockReturnValue(studyDay(history));
	z.browserZone.mockReturnValue(device);
	return render(StudyDaySettings, { context: ctx.context });
}

beforeEach(() => {
	ctx = testContext();
	const days = ctx.session.zone;
	z = {
		browserZone: vi.mocked(zone.browserZone),
		currentHistory: vi.spyOn(days, 'known'),
		currentStudyDay: vi.spyOn(days, 'day'),
		changeZone: vi.spyOn(days, 'change')
	};
	vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(['Asia/Tokyo', 'Europe/Berlin', 'America/New_York']);
});
afterEach(() => {
	cleanup();
	(Intl as unknown as { supportedValuesOf: unknown }).supportedValuesOf = realSupported;
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

describe('StudyDaySettings', () => {
	it('shows the current zone and the from-now-on sentence', () => {
		setup([{ zone: 'Europe/Berlin', from: null }], 'Europe/Berlin');
		expect(screen.getByText(/Europe\/Berlin \(UTC[+-]\d\d:\d\d\)/)).toBeTruthy();
		expect(screen.getByText('Changes apply from now on; past days stay as they were.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /from now on$/ })).toBeNull();
	});

	it('offers the device zone when it differs and changes to it on click', async () => {
		z.changeZone.mockResolvedValue(studyDay([{ zone: 'Asia/Tokyo', from: null }]));
		setup([{ zone: 'Europe/Berlin', from: null }], 'Asia/Tokyo');
		const button = screen.getByRole('button', { name: 'Use Asia/Tokyo from now on' });
		await fireEvent.click(button);
		expect(z.changeZone).toHaveBeenCalledWith('Asia/Tokyo');
	});

	it('does not show the notice for an alias of the current zone', () => {
		setup([{ zone: 'Asia/Kolkata', from: null }], 'Asia/Calcutta');
		expect(screen.queryByRole('button', { name: /from now on$/ })).toBeNull();
	});

	it('warns about a zone this browser does not know', () => {
		setup([{ zone: 'Mars/Base', from: null }], null);
		expect(screen.getByRole('alert').textContent).toMatch(/Mars\/Base/);
	});

	it('changes the zone with the keyboard-operable select and a button', async () => {
		z.changeZone.mockResolvedValue(studyDay([{ zone: 'America/New_York', from: null }]));
		setup([{ zone: 'Europe/Berlin', from: null }], 'Europe/Berlin');
		const select = screen.getByLabelText('Time zone') as HTMLSelectElement;
		expect(select.value).toBe('Europe/Berlin');
		await fireEvent.change(select, { target: { value: 'America/New_York' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Change time zone' }));
		expect(z.changeZone).toHaveBeenCalledWith('America/New_York');
	});

	it('filters the select by the search box', async () => {
		setup([{ zone: 'Europe/Berlin', from: null }], 'Europe/Berlin');
		await fireEvent.input(screen.getByLabelText('Search time zones'), { target: { value: 'new york' } });
		const options = [...(screen.getByLabelText('Time zone') as HTMLSelectElement).options].map((o) => o.value);
		expect(options).toEqual(['Europe/Berlin', 'America/New_York']);
	});

	it('works without Intl.supportedValuesOf', () => {
		(Intl as unknown as { supportedValuesOf: unknown }).supportedValuesOf = undefined;
		setup([{ zone: 'Europe/Berlin', from: null }], 'Europe/Berlin');
		const options = [...(screen.getByLabelText('Time zone') as HTMLSelectElement).options].map((o) => o.value);
		expect(options).toEqual(['Europe/Berlin']);
	});

	it('has one primary action; the search and zone are Field and Select underlines', async () => {
		setup([{ zone: 'Europe/Berlin', from: null }], 'Europe/Berlin');
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Change time zone' }).className).toContain('primary');
		expect(screen.getByRole('searchbox', { name: 'Search time zones' }).closest('.field')).toBeTruthy();
		expect(screen.getByLabelText('Time zone').closest('.field')).toBeTruthy();
	});

	it('shows an error when the change fails', async () => {
		z.changeZone.mockRejectedValue(new ApiError(400, JSON.stringify({ error: 'unknown_time_zone', message: 'x' })));
		setup([{ zone: 'Europe/Berlin', from: null }], 'Asia/Tokyo');
		await fireEvent.click(screen.getByRole('button', { name: 'Use Asia/Tokyo from now on' }));
		await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not a time zone/i));
	});

	it('announces how many time zones match once typing pauses', async () => {
		vi.useFakeTimers();
		try {
			setup([{ zone: 'Europe/Berlin', from: null }], 'Europe/Berlin');
			const box = screen.getByRole('searchbox', { name: 'Search time zones' });
			const live = () => document.querySelector('[aria-live="polite"]');
			await fireEvent.input(box, { target: { value: 'as' } });
			await vi.advanceTimersByTimeAsync(300);
			await fireEvent.input(box, { target: { value: 'asia' } });
			await vi.advanceTimersByTimeAsync(300);
			// Still typing: nothing announced yet, not even the first keystroke.
			expect(live()?.textContent).toBe('');
			await vi.advanceTimersByTimeAsync(250);
			expect(live()?.textContent).toBe('1 time zone matches.');
			await fireEvent.input(box, { target: { value: 'atlantis' } });
			await vi.advanceTimersByTimeAsync(499);
			expect(live()?.textContent).toBe('1 time zone matches.');
			await vi.advanceTimersByTimeAsync(1);
			expect(live()?.textContent).toBe('No time zones match “atlantis”.');
		} finally {
			vi.useRealTimers();
		}
	});
});
