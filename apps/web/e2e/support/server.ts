// One qinqin server per Playwright worker: a copy of the template data
// directory, a free loopback port, the log in the test output folder.

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { scratchDir, serverEnv } from './build';

export interface RunningServer {
	url: string;
	dataDir: string;
	logFile: string;
	stop: () => Promise<void>;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const address = srv.address();
			const port = typeof address === 'object' && address !== null ? address.port : 0;
			srv.close(() => resolve(port));
		});
	});
}

/** Polls /healthz until it answers 200, the process exits, or the deadline passes. */
async function waitHealthy(url: string, proc: ChildProcess, logFile: string, deadlineMs: number): Promise<void> {
	const until = Date.now() + deadlineMs;
	let exited = false;
	proc.once('exit', () => (exited = true));
	while (Date.now() < until && !exited) {
		try {
			const res = await fetch(`${url}/healthz`);
			if (res.ok) return;
		} catch {
			// Not listening yet.
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`qinqin did not come up at ${url} (${exited ? 'it exited' : 'timeout'}); see ${logFile}`);
}

export async function startServer(logDir: string, name: string): Promise<RunningServer> {
	const bin = process.env.QINQIN_E2E_BIN;
	const template = process.env.QINQIN_E2E_TEMPLATE;
	if (!bin || !template) throw new Error('QINQIN_E2E_BIN / QINQIN_E2E_TEMPLATE unset: run through the e2e config (global setup)');
	const root = scratchDir(`qinqin-e2e-${name}-`);
	const dataDir = join(root, 'data');
	const packs = join(root, 'no-packs');
	mkdirSync(packs, { recursive: true });
	cpSync(template, dataDir, { recursive: true });
	mkdirSync(logDir, { recursive: true });
	const logFile = join(logDir, `server-${name}.log`);
	const log = createWriteStream(logFile);

	const cleanup = () => {
		log.end();
		rmSync(root, { recursive: true, force: true });
	};

	// A port taken between the probe and the bind makes serve exit; try again.
	for (let attempt = 0; attempt < 3; attempt++) {
		const port = await freePort();
		const url = `http://127.0.0.1:${port}`;
		// Its own process group: teardown signals the whole group, so nothing
		// serve starts outlives it.
		const proc = spawn(bin, ['serve', '--addr', `127.0.0.1:${port}`, '--data', dataDir], {
			env: serverEnv(packs),
			stdio: ['ignore', 'pipe', 'pipe'],
			detached: true
		});
		const signalGroup = (signal: NodeJS.Signals) => {
			try {
				if (proc.pid !== undefined) process.kill(-proc.pid, signal);
			} catch {
				// Already gone.
			}
		};
		// A worker that exits without its teardown (an error, a signal it handles) still stops the server.
		const onExit = () => signalGroup('SIGKILL');
		process.once('exit', onExit);
		proc.stdout?.pipe(log, { end: false });
		proc.stderr?.pipe(log, { end: false });
		try {
			await waitHealthy(url, proc, logFile, 30_000);
		} catch (err) {
			signalGroup('SIGKILL');
			process.off('exit', onExit);
			if (attempt === 2) {
				cleanup();
				throw err;
			}
			continue;
		}
		const stop = async () => {
			if (proc.exitCode === null && proc.signalCode === null) {
				const exited = new Promise((r) => proc.once('exit', r));
				signalGroup('SIGTERM');
				await exited;
			}
			process.off('exit', onExit);
			cleanup();
		};
		return { url, dataDir, logFile, stop };
	}
	throw new Error('unreachable');
}
