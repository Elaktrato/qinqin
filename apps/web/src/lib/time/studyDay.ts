// The learner's day: the calendar date an instant belongs to, by the
// time zone in effect at that instant. Pure and shared by every consumer
// of a "day"; none of them calls Intl directly. The rule and its JSON
// fixtures live in docs/contracts/study-day/ (Go and Android implement
// the same rule); read its README before changing anything here.
//
// A history is the learner's zone changes in effect order; `from` is an
// RFC 3339 UTC instant, null for the first (it also covers every earlier
// event). `[]` means UTC.

export interface ZoneChange {
	zone: string;
	from: string | null;
}

export interface StudyDay {
	/** The current zone's name (UTC for an empty history). */
	zone: string;
	/** The learner's day (YYYY-MM-DD) of an instant in epoch milliseconds. */
	dayOf(ms: number): string;
	/** The earliest instant (epoch ms, whole seconds) whose day is at least `day`. */
	dayStart(day: string): number;
	/** The learner's day of `now` (default: the clock). */
	today(now?: number): string;
}

/** Counts Intl format calls; the performance test reads it. */
export const studyDayStats = { formatCalls: 0 };

const SECOND = 1000;
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
/** Instants before the epoch are clamped to it (the rule's domain). */
const EPOCH = 0;
const MAX_WINDOWS = 4000;

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** isDay: YYYY-MM-DD and a date that exists. */
export function isDay(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	const m = DAY_PATTERN.exec(value);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const t = new Date(Date.UTC(y, mo - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function utcMs(day: string): number {
	const m = DAY_PATTERN.exec(day);
	if (!m) throw new RangeError(`not a day: ${day}`);
	return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatUtcDay(ms: number): string {
	const d = new Date(ms);
	const y = String(d.getUTCFullYear()).padStart(4, '0');
	return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** addDays is civil-date arithmetic (never + 86 400 s). */
export function addDays(day: string, n: number): string {
	return formatUtcDay(utcMs(day) + n * DAY_MS);
}

/** daysBetweenDates is b − a in civil days. */
export function daysBetweenDates(a: string, b: string): number {
	return Math.round((utcMs(b) - utcMs(a)) / DAY_MS);
}

function makeFormatter(zone: string): Intl.DateTimeFormat | null {
	try {
		return new Intl.DateTimeFormat('en-CA', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	} catch {
		return null;
	}
}

/** unusableZones lists the history's zones this runtime's tz database does not know. */
export function unusableZones(history: readonly ZoneChange[]): string[] {
	const out: string[] = [];
	for (const change of history) {
		if (!out.includes(change.zone) && makeFormatter(change.zone) === null) out.push(change.zone);
	}
	return out;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
	let f = formatters.get(zone);
	if (!f) {
		f = makeFormatter(zone) ?? makeFormatter('UTC')!;
		formatters.set(zone, f);
	}
	return f;
}

interface Wall {
	/** The civil date on the zone's wall clock. */
	day: string;
	/** The zone's UTC offset at the instant, in milliseconds. */
	offset: number;
}

/** The wall clock of an instant in a zone: its date and UTC offset. */
function wallOf(fmt: Intl.DateTimeFormat, ms: number): Wall {
	studyDayStats.formatCalls++;
	const t = ms < EPOCH ? EPOCH : Math.floor(ms / SECOND) * SECOND;
	const parts = fmt.formatToParts(t);
	const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? NaN);
	const year = n('year');
	const month = n('month');
	const date = n('day');
	const hour = n('hour') % 24; // some runtimes print midnight as 24
	const wall = Date.UTC(year, month - 1, date, hour, n('minute'), n('second'));
	return {
		day: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`,
		offset: wall - t
	};
}

interface Window {
	lo: number;
	hi: number;
	day: string;
}

interface Segment {
	fmt: Intl.DateTimeFormat;
	/** Instant (ms) this segment starts; -Infinity for the first. */
	from: number;
	/** First day this segment may report (the floor); '' for none. */
	floor: string;
	starts: Map<string, number>;
	wins: Window[];
}

/**
 * startOfDay: the earliest whole second whose wall clock has reached the
 * midnight of `day`, from offsets (not by bisecting the local date, which
 * is not monotone where a clock goes back across midnight). tzdb never
 * has two offset changes within the 28 hour bracket, so at most one
 * transition lies in it; see the contract README.
 */
function startOfDay(seg: Segment, day: string): number {
	const cached = seg.starts.get(day);
	if (cached !== undefined) return cached;
	const base = utcMs(day);
	const lo = base - 15 * HOUR;
	const hi = base + 13 * HOUR;
	const oLo = wallOf(seg.fmt, lo).offset;
	const oHi = wallOf(seg.fmt, hi).offset;
	let result: number;
	if (oLo === oHi) {
		result = base - oLo;
	} else {
		let a = lo / SECOND;
		let b = hi / SECOND;
		while (b - a > 1) {
			const mid = a + Math.floor((b - a) / 2);
			if (wallOf(seg.fmt, mid * SECOND).offset === oLo) a = mid;
			else b = mid;
		}
		const transition = b * SECOND;
		const c = base - oLo;
		result = c < transition ? c : Math.max(transition, base - oHi);
	}
	if (result < EPOCH) result = EPOCH;
	if (seg.starts.size > MAX_WINDOWS) seg.starts.clear();
	seg.starts.set(day, result);
	return result;
}

/** studyDay builds the rule for a history; see the file comment. */
export function studyDay(history: readonly ZoneChange[]): StudyDay {
	const segments: Segment[] = [];
	for (const change of history) {
		let from = Number.NEGATIVE_INFINITY;
		if (segments.length > 0) {
			from = change.from === null ? NaN : Date.parse(change.from);
			if (!Number.isFinite(from) || from <= segments[segments.length - 1].from) continue; // malformed: skipped
			from = Math.floor(from / SECOND) * SECOND;
		}
		const seg: Segment = {
			fmt: formatterFor(change.zone),
			from,
			floor: '',
			starts: new Map(),
			wins: []
		};
		if (segments.length > 0) {
			const prev = segments[segments.length - 1];
			const prevDate = wallOf(prev.fmt, from).day;
			seg.floor = prev.floor > prevDate ? prev.floor : prevDate;
		}
		segments.push(seg);
	}
	const zone = history.length > 0 ? history[history.length - 1].zone : 'UTC';
	if (segments.length === 0) {
		segments.push({ fmt: formatterFor('UTC'), from: Number.NEGATIVE_INFINITY, floor: '', starts: new Map(), wins: [] });
	}

	function segmentAt(ms: number): number {
		let k = 0;
		for (let i = 1; i < segments.length; i++) {
			if (segments[i].from <= ms) k = i;
			else break;
		}
		return k;
	}

	function dayOf(ms: number): string {
		const t = ms < EPOCH ? EPOCH : ms;
		const k = segmentAt(t);
		const seg = segments[k];
		// Cached windows, sorted by lo.
		const wins = seg.wins;
		let a = 0;
		let b = wins.length;
		while (a < b) {
			const mid = (a + b) >> 1;
			if (wins[mid].hi <= t) a = mid + 1;
			else b = mid;
		}
		if (a < wins.length && wins[a].lo <= t) return wins[a].day;

		let day = wallOf(seg.fmt, t).day;
		if (day < seg.floor) day = seg.floor; // the clamp: a date never repeats
		for (let i = 0; i < 3 && startOfDay(seg, addDays(day, 1)) <= t; i++) day = addDays(day, 1);
		const next = k + 1 < segments.length ? segments[k + 1].from : Number.POSITIVE_INFINITY;
		const lo = k >= 1 && seg.floor >= day ? seg.from : Math.max(startOfDay(seg, day), seg.from);
		const hi = Math.min(startOfDay(seg, addDays(day, 1)), next);
		if (seg.wins.length > MAX_WINDOWS) seg.wins = [];
		seg.wins.splice(seg.wins === wins ? a : 0, 0, { lo, hi, day });
		return day;
	}

	function dayStart(day: string): number {
		const last = segments.length - 1;
		for (let k = 0; k <= last; k++) {
			const seg = segments[k];
			if (k >= 1 && seg.floor >= day) return seg.from;
			let c = startOfDay(seg, day);
			if (k >= 1 && c < seg.from) c = seg.from;
			if (k === last || c < segments[k + 1].from) return c;
		}
		return EPOCH;
	}

	return { zone, dayOf, dayStart, today: (now = Date.now()) => dayOf(now) };
}
