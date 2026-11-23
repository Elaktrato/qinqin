// The suite's fixtures: a server per worker, an admin per worker, a fresh
// learner per test (its own user, so tests never share study data), and a
// browser signed in as that learner unless a test opts out.

import { test as base, expect, type Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { Api, login } from './api';
import { ADMIN } from './build';
import { startServer, type RunningServer } from './server';

export interface Learner {
	username: string;
	password: string;
	api: Api;
	/** Workspace id per language (the fixture installs ja and zh). */
	workspaces: Record<string, number>;
	/** The id of the entry written `written` in `language` (exact match). */
	entryId: (language: string, written: string) => Promise<number>;
}

interface WorkerFixtures {
	server: RunningServer;
	admin: Api;
}

interface TestFixtures {
	learner: Learner;
	/** false: the browser starts signed out (the sign-in tests). */
	signedIn: boolean;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
	server: [
		async ({}, use, workerInfo) => {
			const server = await startServer(workerInfo.project.outputDir, `w${workerInfo.workerIndex}`);
			await use(server);
			await server.stop();
		},
		{ scope: 'worker', timeout: 60_000 }
	],
	admin: [
		async ({ server }, use) => {
			await use(new Api(server.url, await login(server.url, ADMIN.username, ADMIN.password)));
		},
		{ scope: 'worker' }
	],
	baseURL: async ({ server }, use) => {
		await use(server.url);
	},
	signedIn: [true, { option: true }],
	learner: async ({ server, admin }, use, testInfo) => {
		const username = `learner-${testInfo.workerIndex}-${randomBytes(4).toString('hex')}`;
		const password = `e2e-${randomBytes(8).toString('hex')}-Pw!`;
		await admin.post('/api/auth/register', { username, password });
		const api = new Api(server.url, await login(server.url, username, password));
		// The first read creates one workspace per installed language.
		const list = await api.get<{ id: number; language: string }[]>('/api/workspaces');
		const workspaces = Object.fromEntries(list.map((w) => [w.language, w.id]));
		const entryId = async (language: string, written: string) => {
			const hits = await api.get<{ id: number; written: string }[]>(
				`/api/search?q=${encodeURIComponent(written)}&lang=${language}`
			);
			const hit = hits.find((h) => h.written === written);
			if (!hit) throw new Error(`no ${language} entry ${written} in the fixture packs`);
			return hit.id;
		};
		await use({ username, password, api, workspaces, entryId });
	},
	storageState: async ({ signedIn, learner, baseURL }, use) => {
		await use(
			signedIn
				? { cookies: [], origins: [{ origin: baseURL!, localStorage: [{ name: 'qinqin.token', value: learner.api.token }] }] }
				: { cookies: [], origins: [] }
		);
	}
});

export { expect };

/**
 * Pins Math.random in the page to a seeded generator, so a study session's
 * shuffle and type mix (seeded from Math.random at Start) are the same on
 * every run. Event ids use crypto.getRandomValues and stay unique.
 */
export async function seedRandom(page: Page, seed: number): Promise<void> {
	await page.addInitScript((s) => {
		let a = s >>> 0;
		Math.random = () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}, seed);
}
