// The per-tab lookup recorder (#72): buffers lookups in memory and flushes
// them FLUSH_IDLE_MS after the last one (at most FLUSH_MAX_MS after the
// first) and when the page is hidden. A flush is always read, merge, write
// in the same flush (docs/contracts/lookups/README.md): a copy read earlier
// is never written, so a Clear on another device cannot be undone by this
// tab. Nothing is kept in browser storage.

import {
	type LookupHistory,
	type LookupHit,
	emptyHistory,
	mergeLookups,
	parseLookupCfg,
	parseLookups,
	serializeLookups
} from './lookups';

export const FLUSH_IDLE_MS = 5000;
export const FLUSH_MAX_MS = 30_000;
export const RECORDER_BUFFER_MAX = 200;

export interface RecorderIO {
	readRow(ws: number): Promise<unknown | null>;
	writeRow(ws: number, data: unknown): Promise<void>;
	readCfg(): Promise<unknown | null>;
}

interface Buffered {
	ws: number;
	hit: LookupHit;
}

export class LookupRecorder {
	#io: RecorderIO;
	#buffer: Buffered[] = [];
	#copies = new Map<number, LookupHistory>();
	#idle: ReturnType<typeof setTimeout> | undefined;
	#max: ReturnType<typeof setTimeout> | undefined;
	#chain: Promise<void> = Promise.resolve();
	/** Bumped by reset(): a flush that started before it writes nothing more. */
	#generation = 0;
	/** The last read of lookupcfg (on until read otherwise). */
	recording = true;

	constructor(io: RecorderIO) {
		this.#io = io;
	}

	/** note buffers one lookup made now; ignored while recording is off. */
	note(ws: number, hit: Omit<LookupHit, 'at'>): void {
		if (!this.recording) return;
		this.#buffer.push({ ws, hit: { ...hit, at: new Date().toISOString() } });
		if (this.#buffer.length > RECORDER_BUFFER_MAX) this.#buffer.splice(0, this.#buffer.length - RECORDER_BUFFER_MAX);
		this.#schedule(FLUSH_IDLE_MS);
	}

	#schedule(idleMs: number): void {
		if (this.#idle !== undefined) clearTimeout(this.#idle);
		this.#idle = setTimeout(() => void this.flush(), idleMs);
		if (this.#max === undefined) this.#max = setTimeout(() => void this.flush(), FLUSH_MAX_MS);
	}

	#clearTimers(): void {
		if (this.#idle !== undefined) clearTimeout(this.#idle);
		if (this.#max !== undefined) clearTimeout(this.#max);
		this.#idle = this.#max = undefined;
	}

	/** flush writes the buffer: per workspace read the switch and the row, merge, write. */
	flush(): Promise<void> {
		const run = this.#chain.then(() => this.#flushNow());
		this.#chain = run.catch(() => {});
		return run;
	}

	async #flushNow(): Promise<void> {
		this.#clearTimers();
		if (this.#buffer.length === 0) return;
		const generation = this.#generation;
		const taken = this.#buffer;
		this.#buffer = [];
		const failed: Buffered[] = [];
		try {
			const cfg = parseLookupCfg(await this.#io.readCfg());
			if (generation !== this.#generation) return;
			this.recording = cfg.record;
			if (!cfg.record) return; // the taken buffer is discarded
			const byWs = new Map<number, LookupHit[]>();
			for (const b of taken) byWs.set(b.ws, [...(byWs.get(b.ws) ?? []), b.hit]);
			for (const [ws, hits] of byWs) {
				try {
					const read = parseLookups(await this.#io.readRow(ws));
					if (generation !== this.#generation) return;
					const merged = mergeLookups(read, hits);
					await this.#io.writeRow(ws, serializeLookups(merged));
					if (generation !== this.#generation) return;
					this.#copies.set(ws, merged);
				} catch {
					failed.push(...hits.map((hit) => ({ ws, hit })));
				}
			}
		} catch {
			failed.push(...taken);
		}
		if (failed.length > 0 && generation === this.#generation && this.recording) {
			this.#buffer = [...failed, ...this.#buffer].slice(-RECORDER_BUFFER_MAX);
			this.#schedule(FLUSH_MAX_MS);
		}
	}

	/** load reads the switch and the workspace's row once (for the popup hint). */
	async load(ws: number): Promise<void> {
		const generation = this.#generation;
		const [cfg, row] = await Promise.all([this.#io.readCfg(), this.#io.readRow(ws)]);
		if (generation !== this.#generation) return;
		this.recording = parseLookupCfg(cfg).record;
		this.#copies.set(ws, parseLookups(row));
	}

	/** countOf is the entry's count in the last read copy plus the buffer. */
	countOf(ws: number, entryId: number): number {
		if (!this.recording) return 0;
		const copy = this.#copies.get(ws) ?? emptyHistory();
		const hits = this.#buffer.filter((b) => b.ws === ws && b.hit.entryId === entryId).map((b) => b.hit);
		const own = copy.items.filter((i) => i.entryId === entryId);
		const merged = mergeLookups({ ...copy, items: own }, hits);
		return merged.items[0]?.count ?? 0;
	}

	/**
	 * adopt takes the history the page just wrote (a Remove or Clear) as the
	 * workspace's copy and drops that workspace's buffered lookups.
	 */
	adopt(ws: number, h: LookupHistory): void {
		this.#copies.set(ws, h);
		this.#buffer = this.#buffer.filter((b) => b.ws !== ws);
	}

	/** setRecording is the page's switch: off drops every buffered lookup. */
	setRecording(record: boolean): void {
		this.recording = record;
		if (!record) {
			this.#buffer = [];
			this.#clearTimers();
		}
	}

	/** reset (sign-out) drops buffers, copies and timers. */
	reset(): void {
		this.#generation++;
		this.#clearTimers();
		this.#buffer = [];
		this.#copies.clear();
		this.recording = true;
	}

	/** attach flushes when the document is hidden; returns the detach. */
	attach(doc: Document): () => void {
		const onVisibility = () => {
			if (doc.visibilityState === 'hidden') void this.flush();
		};
		doc.addEventListener('visibilitychange', onVisibility);
		return () => doc.removeEventListener('visibilitychange', onVisibility);
	}
}
