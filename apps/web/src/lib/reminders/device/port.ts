// The device notification port (#137, Android shell): the interface the shell's native notification module
// (lib/native/notifications) implements. The web side talks to the port only; the real port is wired by one
// call, setDevicePort (see scheduler.ts). Until then every call answers 'unsupported' and does nothing.

export type PermissionState = 'granted' | 'denied' | 'prompt' | 'unsupported';

export interface DeviceNotification {
	/** Stable per (learner day, kind): scheduling the same id again replaces the notification. */
	id: number;
	title: string;
	body: string;
	at: Date;
	/** The app route a tap opens; the web side always sends '/study'. */
	route?: string;
}

export interface DevicePort {
	permissionStatus(): Promise<PermissionState>;
	requestPermission(): Promise<PermissionState>;
	schedule(items: DeviceNotification[]): Promise<void>;
	cancelAll(): Promise<void>;
}

let installed: DevicePort | null = null;

/** setDevicePort installs the shell's port (null: none, the default); returns nothing, the last call wins. */
export function setDevicePort(port: DevicePort | null): void {
	installed = port;
}

/** The port in use: the installed one, else a port that reports 'unsupported' and does nothing. */
export const devicePort: DevicePort = {
	permissionStatus: async () => (installed ? installed.permissionStatus() : 'unsupported'),
	requestPermission: async () => (installed ? installed.requestPermission() : 'unsupported'),
	schedule: async (items) => void (await installed?.schedule(items)),
	cancelAll: async () => void (await installed?.cancelAll())
};

export interface FakePort extends DevicePort {
	permission: PermissionState;
	/** What the next requestPermission answers (default: 'granted'). */
	requestResult: PermissionState;
	/** The notifications currently scheduled. */
	scheduled: DeviceNotification[];
	/** Every call in order, as "name" (schedule adds its count). */
	calls: string[];
}

/** fakePort: a port for tests that keeps what was scheduled. */
export function fakePort(permission: PermissionState = 'granted'): FakePort {
	const port: FakePort = {
		permission,
		requestResult: 'granted',
		scheduled: [],
		calls: [],
		async permissionStatus() {
			port.calls.push('permissionStatus');
			return port.permission;
		},
		async requestPermission() {
			port.calls.push('requestPermission');
			port.permission = port.requestResult;
			return port.permission;
		},
		async schedule(items) {
			port.calls.push(`schedule:${items.length}`);
			port.scheduled = [...port.scheduled.filter((s) => !items.some((i) => i.id === s.id)), ...items];
		},
		async cancelAll() {
			port.calls.push('cancelAll');
			port.scheduled = [];
		}
	};
	return port;
}
