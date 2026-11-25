import { afterEach, describe, expect, it, vi } from 'vitest';
import { shellPort } from './shellPort';

type Calls = { name: string; arg: unknown }[];

function installShell(permission = 'granted'): Calls {
	const calls: Calls = [];
	const record = (name: string, result: unknown) => async (arg?: unknown) => {
		calls.push({ name, arg });
		return result;
	};
	(window as unknown as { Capacitor: unknown }).Capacitor = {
		isNativePlatform: () => true,
		Plugins: {
			QinqinNotifications: {
				permission: record('permission', { state: permission }),
				requestPermission: record('requestPermission', { state: permission }),
				schedule: record('schedule', {}),
				cancel: record('cancel', {}),
				cancelAll: record('cancelAll', {}),
				pending: record('pending', { ids: [] })
			}
		}
	};
	return calls;
}

afterEach(() => {
	delete (window as unknown as { Capacitor?: unknown }).Capacitor;
	vi.useRealTimers();
});

describe('shellPort', () => {
	it('reports unsupported outside the shell and does nothing', async () => {
		expect(await shellPort.permissionStatus()).toBe('unsupported');
		await shellPort.schedule([{ id: 1, title: 'x', body: '', at: new Date(Date.now() + 60_000) }]);
		await shellPort.cancelAll();
	});

	it('schedules each notification on the reminders channel', async () => {
		const calls = installShell();
		const at = new Date(Date.now() + 3_600_000);
		await shellPort.schedule([
			{ id: 7, title: 'Time to study', body: '3 cards are due.', at, route: '/study' },
			{ id: 8, title: 'Your daily goal', body: 'Open.', at, route: '/study' }
		]);
		const scheduled = calls.filter((c) => c.name === 'schedule').map((c) => c.arg as { id: number; channel: { id: string } });
		expect(scheduled.map((s) => s.id)).toEqual([7, 8]);
		expect(scheduled[0].channel.id).toBe('reminders');
	});

	it('passes permission and cancel through', async () => {
		const calls = installShell('prompt');
		expect(await shellPort.permissionStatus()).toBe('prompt');
		expect(await shellPort.requestPermission()).toBe('prompt');
		await shellPort.cancelAll();
		expect(calls.map((c) => c.name)).toEqual(['permission', 'requestPermission', 'cancelAll']);
	});
});
