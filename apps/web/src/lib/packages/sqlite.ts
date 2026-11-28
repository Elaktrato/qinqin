// A read-only reader of package databases (`data.sqlite`, docs/contracts/packages/README.md): the web has no SQLite,
// and a package is a snapshot it only reads whole. It reads the SQLite file format's table b-trees (interior and leaf
// pages, overflow chains) and records, which is all a package needs: tables are scanned, never searched through an
// index. UTF-8 databases only (what the server writes). Anything else it does not expect is refused with SqliteError;
// the caller then has no offline data, never wrong data.

export class SqliteError extends Error {}

export type SqlValue = null | number | string | Uint8Array;

export interface SqliteTable {
	name: string;
	root: number;
	columns: string[];
	/** The index of an INTEGER PRIMARY KEY column (stored as the rowid), or -1. */
	rowidColumn: number;
}

/** The first 16 bytes of every SQLite database file (the format's header string and a NUL). */
const MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00];
const LEAF_TABLE = 0x0d;
const INTERIOR_TABLE = 0x05;
const MAX_DEPTH = 64;

/** A column definition's first word, unquoted; constraint lines (PRIMARY KEY (...), UNIQUE, CHECK, ...) are not columns. */
function columnsOf(sql: string): { columns: string[]; rowidColumn: number } {
	const open = sql.indexOf('(');
	const close = sql.lastIndexOf(')');
	if (open < 0 || close < open) throw new SqliteError('a table without columns');
	const body = sql.slice(open + 1, close);
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '(') depth++;
		else if (c === ')') depth--;
		else if (c === ',' && depth === 0) {
			parts.push(body.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(body.slice(start));
	const columns: string[] = [];
	let rowidColumn = -1;
	for (const raw of parts) {
		const part = raw.trim();
		if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|CONSTRAINT)\b/i.test(part)) continue;
		const m = /^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s*(.*)$/s.exec(part);
		if (!m) throw new SqliteError(`a column definition it cannot read: ${part}`);
		if (/^INTEGER\s+PRIMARY\s+KEY\b/i.test(m[5] ?? '')) rowidColumn = columns.length;
		columns.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
	}
	return { columns, rowidColumn };
}

export class SqliteDb {
	readonly #bytes: Uint8Array;
	readonly #view: DataView;
	readonly #pageSize: number;
	readonly #usable: number;
	readonly #pages: number;
	readonly #text = new TextDecoder('utf-8');
	readonly tables = new Map<string, SqliteTable>();

	constructor(bytes: Uint8Array) {
		this.#bytes = bytes;
		this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		if (bytes.length < 100 || MAGIC.some((b, i) => bytes[i] !== b)) throw new SqliteError('not a SQLite database');
		const raw = this.#view.getUint16(16);
		this.#pageSize = raw === 1 ? 65536 : raw;
		if (this.#pageSize < 512 || (this.#pageSize & (this.#pageSize - 1)) !== 0) throw new SqliteError('bad page size');
		this.#usable = this.#pageSize - bytes[20];
		if (this.#view.getUint32(56) !== 1) throw new SqliteError('not a UTF-8 database');
		if (bytes.length % this.#pageSize !== 0) throw new SqliteError('the file is not whole pages');
		this.#pages = bytes.length / this.#pageSize;
		for (const row of this.#scan(1)) {
			const [type, name, , root, sql] = row.values;
			if (type !== 'table' || typeof name !== 'string' || typeof root !== 'number' || typeof sql !== 'string') continue;
			if (name.startsWith('sqlite_')) continue;
			this.tables.set(name, { name, root, ...columnsOf(sql) });
		}
	}

	/** rows returns every row of a table as an object by column name, in rowid order. */
	rows(table: string): Record<string, SqlValue>[] {
		const t = this.tables.get(table);
		if (!t) throw new SqliteError(`no table ${table}`);
		const out: Record<string, SqlValue>[] = [];
		for (const { rowid, values } of this.#scan(t.root)) {
			const row: Record<string, SqlValue> = {};
			t.columns.forEach((col, i) => {
				row[col] = i === t.rowidColumn && (values[i] ?? null) === null ? rowid : (values[i] ?? null);
			});
			out.push(row);
		}
		return out;
	}

	#page(n: number): number {
		if (!Number.isInteger(n) || n < 1 || n > this.#pages) throw new SqliteError(`page ${n} out of range`);
		return (n - 1) * this.#pageSize;
	}

	#varint(at: number): [value: number, next: number] {
		let value = 0;
		for (let i = 0; i < 8; i++) {
			const b = this.#bytes[at + i];
			if (b === undefined) throw new SqliteError('varint past the end');
			value = value * 128 + (b & 0x7f);
			if ((b & 0x80) === 0) return [value, at + i + 1];
		}
		const last = this.#bytes[at + 8];
		if (last === undefined) throw new SqliteError('varint past the end');
		return [value * 256 + last, at + 9];
	}

	/** The rows of the table b-tree rooted at page `root`, in key order. */
	*#scan(root: number): Generator<{ rowid: number; values: SqlValue[] }> {
		const stack: { page: number; depth: number }[] = [{ page: root, depth: 0 }];
		const seen = new Set<number>();
		while (stack.length > 0) {
			const { page, depth } = stack.pop()!;
			if (seen.has(page) || depth > MAX_DEPTH) throw new SqliteError('a b-tree loop');
			seen.add(page);
			const base = this.#page(page);
			const hdr = base + (page === 1 ? 100 : 0);
			const kind = this.#bytes[hdr];
			const cells = this.#view.getUint16(hdr + 3);
			if (kind === INTERIOR_TABLE) {
				const children: number[] = [];
				for (let i = 0; i < cells; i++) {
					const cell = base + this.#view.getUint16(hdr + 12 + 2 * i);
					children.push(this.#view.getUint32(cell));
				}
				children.push(this.#view.getUint32(hdr + 8));
				for (let i = children.length - 1; i >= 0; i--) stack.push({ page: children[i], depth: depth + 1 });
			} else if (kind === LEAF_TABLE) {
				for (let i = 0; i < cells; i++) {
					const cell = base + this.#view.getUint16(hdr + 8 + 2 * i);
					yield this.#leafCell(cell);
				}
			} else {
				throw new SqliteError(`page ${page} is not a table page`);
			}
		}
	}

	#leafCell(cell: number): { rowid: number; values: SqlValue[] } {
		const [size, afterSize] = this.#varint(cell);
		const [rowid, start] = this.#varint(afterSize);
		const u = this.#usable;
		const x = u - 35;
		let local = size;
		if (size > x) {
			const m = Math.floor(((u - 12) * 32) / 255) - 23;
			const k = m + ((size - m) % (u - 4));
			local = k <= x ? k : m;
		}
		let payload: Uint8Array;
		if (local === size) {
			payload = this.#bytes.subarray(start, start + size);
		} else {
			payload = new Uint8Array(size);
			payload.set(this.#bytes.subarray(start, start + local), 0);
			let filled = local;
			let next = this.#view.getUint32(start + local);
			const seen = new Set<number>();
			while (filled < size) {
				if (next === 0 || seen.has(next)) throw new SqliteError('a broken overflow chain');
				seen.add(next);
				const at = this.#page(next);
				const take = Math.min(u - 4, size - filled);
				payload.set(this.#bytes.subarray(at + 4, at + 4 + take), filled);
				filled += take;
				next = this.#view.getUint32(at);
			}
		}
		if (payload.length !== size) throw new SqliteError('a cell past the end');
		return { rowid, values: this.#record(payload) };
	}

	#record(p: Uint8Array): SqlValue[] {
		const v = new DataView(p.buffer, p.byteOffset, p.byteLength);
		const read = (at: number): [number, number] => {
			let value = 0;
			for (let i = 0; i < 9; i++) {
				const b = p[at + i];
				if (b === undefined) throw new SqliteError('record header past the end');
				if (i === 8) return [value * 256 + b, at + 9];
				value = value * 128 + (b & 0x7f);
				if ((b & 0x80) === 0) return [value, at + i + 1];
			}
			throw new SqliteError('bad varint');
		};
		const [headerSize, first] = read(0);
		const types: number[] = [];
		for (let at = first; at < headerSize; ) {
			const [t, next] = read(at);
			types.push(t);
			at = next;
		}
		const values: SqlValue[] = [];
		let at = headerSize;
		// A big-endian two's complement integer of n bytes (read unsigned, then shifted down when negative).
		const int = (n: number): number => {
			if (at + n > p.length) throw new SqliteError('a value past the record');
			let unsigned = 0;
			for (let i = 0; i < n; i++) unsigned = unsigned * 256 + p[at + i];
			const value = p[at] & 0x80 ? unsigned - 2 ** (8 * n) : unsigned;
			at += n;
			return value;
		};
		for (const t of types) {
			if (t === 0) values.push(null);
			else if (t >= 1 && t <= 6) values.push(int([0, 1, 2, 3, 4, 6, 8][t]));
			else if (t === 7) {
				values.push(v.getFloat64(at));
				at += 8;
			} else if (t === 8) values.push(0);
			else if (t === 9) values.push(1);
			else if (t >= 12) {
				const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
				if (at + len > p.length) throw new SqliteError('a value past the record');
				const raw = p.subarray(at, at + len);
				values.push(t % 2 === 0 ? raw.slice() : this.#text.decode(raw));
				at += len;
			} else throw new SqliteError(`serial type ${t}`);
		}
		return values;
	}
}

/** openSqlite reads a package database; throws SqliteError for one it cannot read. */
export function openSqlite(bytes: Uint8Array): SqliteDb {
	return new SqliteDb(bytes);
}
