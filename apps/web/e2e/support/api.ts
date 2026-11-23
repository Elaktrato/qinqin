// The HTTP API as the fixture and the assertions use it: from Node, never
// through the browser, so a browser that is offline does not affect it.

import { randomBytes } from 'node:crypto';

export class Api {
	constructor(
		readonly base: string,
		readonly token: string
	) {}

	async call<T>(method: string, path: string, body?: unknown): Promise<T> {
		const res = await fetch(this.base + path, {
			method,
			headers: {
				authorization: `Bearer ${this.token}`,
				...(body === undefined || body instanceof FormData ? {} : { 'content-type': 'application/json' })
			},
			body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body)
		});
		const text = await res.text();
		if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
		return (text === '' ? null : JSON.parse(text)) as T;
	}

	get<T>(path: string): Promise<T> {
		return this.call<T>('GET', path);
	}

	post<T>(path: string, body?: unknown): Promise<T> {
		return this.call<T>('POST', path, body);
	}

	/** Every event of a workspace (GET /api/events pages, events/page.json). */
	async events(workspaceId: number): Promise<StoredEvent[]> {
		const out: StoredEvent[] = [];
		let path = `/api/events?limit=500&workspace=${workspaceId}`;
		for (;;) {
			const page = await this.get<{ events: StoredEvent[]; more: boolean; next: string | null }>(path);
			out.push(...page.events);
			if (!page.more || !page.next) return out;
			path = `/api/events?page=${encodeURIComponent(page.next)}&workspace=${workspaceId}`;
		}
	}

	/** The review events the server holds for a workspace. */
	async reviews(workspaceId: number): Promise<ReviewEvent[]> {
		return (await this.events(workspaceId)).filter((e): e is ReviewEvent => e.type === 'review');
	}
}

export interface StoredEvent {
	id: string;
	workspaceId: number;
	ts: string;
	type: string;
	payload: unknown;
}

export interface ReviewEvent extends StoredEvent {
	type: 'review';
	payload: { cardId: string; mode: string; grade: number; replaces?: string };
}

/** Signs in through the API, from an address of its own (X-Forwarded-For; the server trusts loopback). */
export async function login(base: string, username: string, password: string): Promise<string> {
	const address = `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${1 + (randomBytes(1)[0] % 250)}`;
	const res = await fetch(`${base}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
		body: JSON.stringify({ username, password, deviceName: 'e2e' })
	});
	const body = (await res.json()) as { status?: string; token?: string };
	if (!res.ok || body.status !== 'ok' || !body.token) throw new Error(`login ${username}: ${res.status} ${JSON.stringify(body)}`);
	return body.token;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID for a given time (event ids are ULIDs). */
export function ulid(time: number): string {
	let head = '';
	let t = time;
	for (let i = 0; i < 10; i++) {
		head = CROCKFORD[t % 32] + head;
		t = Math.floor(t / 32);
	}
	let tail = '';
	for (const byte of randomBytes(16)) tail += CROCKFORD[byte % 32];
	return head + tail;
}
