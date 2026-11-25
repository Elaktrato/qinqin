import { afterEach, describe, expect, it } from 'vitest';
import { devicePort, fakePort, setDevicePort } from './port';

afterEach(() => setDevicePort(null));

describe('devicePort', () => {
	it('reports unsupported and does nothing until a port is installed', async () => {
		expect(await devicePort.permissionStatus()).toBe('unsupported');
		expect(await devicePort.requestPermission()).toBe('unsupported');
		await expect(devicePort.schedule([{ id: 1, title: 'a', body: 'b', at: new Date() }])).resolves.toBeUndefined();
		await expect(devicePort.cancelAll()).resolves.toBeUndefined();
	});
	it('delegates to the installed port, and back to unsupported after null', async () => {
		const fake = fakePort('prompt');
		setDevicePort(fake);
		expect(await devicePort.permissionStatus()).toBe('prompt');
		expect(await devicePort.requestPermission()).toBe('granted');
		await devicePort.schedule([{ id: 1, title: 'a', body: 'b', at: new Date(0) }]);
		expect(fake.scheduled.map((s) => s.id)).toEqual([1]);
		await devicePort.cancelAll();
		expect(fake.scheduled).toEqual([]);
		setDevicePort(null);
		expect(await devicePort.permissionStatus()).toBe('unsupported');
	});
});

describe('fakePort', () => {
	it('replaces a notification with the same id', async () => {
		const fake = fakePort();
		await fake.schedule([{ id: 1, title: 'a', body: 'b', at: new Date(0) }]);
		await fake.schedule([{ id: 1, title: 'c', body: 'd', at: new Date(0) }]);
		expect(fake.scheduled.map((s) => s.title)).toEqual(['c']);
	});
});
