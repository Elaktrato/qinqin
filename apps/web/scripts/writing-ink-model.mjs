// Hand-drawn ink model for the writing matcher: turns a stroke median (unit coordinates,
// y down) into the kind of ink a real hand produces. Used by make-writing-fixtures.mjs to
// pin the matcher's behaviour and by the noise sweeps that tune it. Pure and seeded.

export function mulberry32(a) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const length = (ps) => ps.reduce((s, p, i) => (i ? s + dist(ps[i - 1], p) : 0), 0);

export function resample(ps, n) {
	const total = length(ps);
	if (total === 0) return Array.from({ length: n }, () => ({ ...ps[0] }));
	const out = [];
	let seg = 1;
	let acc = 0;
	for (let k = 0; k < n; k++) {
		const target = (total * k) / (n - 1);
		while (seg < ps.length - 1 && acc + dist(ps[seg - 1], ps[seg]) < target) {
			acc += dist(ps[seg - 1], ps[seg]);
			seg++;
		}
		const a = ps[seg - 1];
		const b = ps[seg];
		const l = dist(a, b);
		const t = l === 0 ? 0 : Math.min(1, Math.max(0, (target - acc) / l));
		out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
	}
	return out;
}

export function centroid(ps) {
	return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
}

function rdp(ps, eps) {
	if (ps.length < 3) return [0, ps.length - 1];
	const a = ps[0];
	const b = ps[ps.length - 1];
	const l = dist(a, b) || 1e-9;
	let best = -1;
	let at = 0;
	for (let i = 1; i < ps.length - 1; i++) {
		const d = Math.abs((b.x - a.x) * (a.y - ps[i].y) - (a.x - ps[i].x) * (b.y - a.y)) / l;
		if (d > best) {
			best = d;
			at = i;
		}
	}
	if (best <= eps) return [0, ps.length - 1];
	const left = rdp(ps.slice(0, at + 1), eps);
	const right = rdp(ps.slice(at), eps).map((i) => i + at);
	return [...left, ...right.slice(1)];
}

function turn(a, b, c) {
	const u = { x: b.x - a.x, y: b.y - a.y };
	const v = { x: c.x - b.x, y: c.y - b.y };
	const cos = (u.x * v.x + u.y * v.y) / ((Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) || 1e-9);
	return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** The stroke's simplified skeleton: vertices, and where a hook (tail) and sharp corners are. */
export function features(m) {
	const L = length(m);
	const dense = resample(m, 64);
	const idx = rdp(dense, Math.max(0.012, 0.03 * L));
	const v = idx.map((i) => dense[i]);
	let tail = null;
	if (v.length >= 3) {
		const last = dist(v.at(-2), v.at(-1));
		if (last < 0.25 * L && turn(v.at(-3), v.at(-2), v.at(-1)) > 50) tail = idx.at(-2);
	}
	// Corners: vertices turning 60° or more, counting a rounded corner (several close vertices)
	// as one; the hook's own turn is not a corner.
	const corners = [];
	const near = 0.12 * L;
	for (let i = 1; i < v.length - 1; i++) {
		if (tail !== null && idx[i] >= tail) break;
		let j = i;
		while (j + 1 < v.length - 1 && (tail === null || idx[j + 1] < tail) && dist(v[j], v[j + 1]) < near) j++;
		if (turn(v[i - 1], v[i], v[j + 1]) >= 60 || turn(v[i - 1], v[j], v[j + 1]) >= 60) {
			corners.push(idx[(i + j) >> 1]);
			i = j;
		}
	}
	return { dense, tail, corners, L };
}

/** Simplified drawing: a straight line from the start to the end of the stroke body (hook left off). */
export function straight(m) {
	const { dense, tail } = features(m);
	const end = tail === null ? dense.at(-1) : dense[tail];
	return resample([dense[0], end], 24);
}

/** Hook left off: the ink stops where the hook turns. */
export function hookOmitted(m) {
	const { dense, tail } = features(m);
	return tail === null ? null : resample(dense.slice(0, tail + 1), 32);
}

/** Hook exaggerated: the hook is drawn `factor` times as long, in its own direction. */
export function hookExaggerated(m, factor = 2.2) {
	const { dense, tail } = features(m);
	if (tail === null) return null;
	const a = dense[tail];
	const b = dense.at(-1);
	const tip = { x: a.x + (b.x - a.x) * factor, y: a.y + (b.y - a.y) * factor };
	return resample([...dense.slice(0, tail + 1), tip], 32);
}

/** Corners drawn round: each sharp corner becomes a quadratic arc. */
export function cornerRounded(m, frac = 0.35) {
	const { dense, corners } = features(m);
	if (corners.length === 0) return null;
	const out = [];
	let from = 0;
	for (const c of corners) {
		const span = Math.max(2, Math.round(frac * Math.min(c - from, dense.length - 1 - c, 20)));
		const p0 = dense[c - span];
		const p1 = dense[c];
		const p2 = dense[c + span];
		out.push(...dense.slice(from, c - span));
		for (let k = 0; k <= 8; k++) {
			const t = k / 8;
			out.push({
				x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
				y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y
			});
		}
		from = c + span + 1;
	}
	out.push(...dense.slice(from));
	return resample(out, 40);
}

/**
 * A hand: smooth low-frequency wobble of `amp`, each end over- or undershot by up to
 * `endFrac` of the length, rotation up to `rotDeg`, and a little jitter.
 */
export function hand(m, rnd, { amp = 0.03, endFrac = 0.15, rotDeg = 10, jitter = 0.004 } = {}) {
	const u = (a) => (rnd() * 2 - 1) * a;
	const n = 40;
	let pts = resample(m, n);
	const L = length(pts);
	const ext = (a, b, d) => {
		const l = dist(a, b) || 1;
		return { x: a.x + ((a.x - b.x) / l) * d, y: a.y + ((a.y - b.y) / l) * d };
	};
	// positive = undershoot (trim), negative = overshoot (extend along the end tangent)
	const trim = (ps, d) => {
		if (d < 0) return [ext(ps[0], ps[1], -d), ...ps];
		let acc = 0;
		let i = 1;
		while (i < ps.length - 1 && acc + dist(ps[i - 1], ps[i]) < d) {
			acc += dist(ps[i - 1], ps[i]);
			i++;
		}
		return ps.slice(i - 1);
	};
	pts = trim(pts, u(endFrac) * L);
	pts = trim(pts.slice().reverse(), u(endFrac) * L).reverse();
	pts = resample(pts, n);
	const p1 = rnd() * 6.28;
	const p2 = rnd() * 6.28;
	const f1 = 0.5 + rnd();
	const f2 = 0.5 + rnd();
	const ax = u(amp);
	const ay = u(amp);
	pts = pts.map((p, i) => {
		const t = i / (n - 1);
		return { x: p.x + ax * Math.sin(6.28 * f1 * t + p1), y: p.y + ay * Math.sin(6.28 * f2 * t + p2) };
	});
	pts = rotate(pts, u(rotDeg));
	return pts.map((p) => ({ x: p.x + u(jitter), y: p.y + u(jitter) }));
}

export function rotate(ps, deg) {
	const c = centroid(ps);
	const r = (deg * Math.PI) / 180;
	const cs = Math.cos(r);
	const sn = Math.sin(r);
	return ps.map((p) => ({ x: c.x + (p.x - c.x) * cs - (p.y - c.y) * sn, y: c.y + (p.x - c.x) * sn + (p.y - c.y) * cs }));
}

export const shift = (ps, dx, dy) => ps.map((p) => ({ x: p.x + dx, y: p.y + dy }));

export function scale(ps, f) {
	const c = centroid(ps);
	return ps.map((p) => ({ x: c.x + (p.x - c.x) * f, y: c.y + (p.y - c.y) * f }));
}

/**
 * Every hand-model variant of a correct stroke, as [label, ink] pairs. `rnd` drives the noise;
 * `hands` is how many noisy hands are drawn.
 */
export function correctVariants(m, rnd, hands = 4) {
	const out = [];
	const { corners } = features(m);
	if (corners.length === 0) out.push(['straight line', straight(m)]);
	for (let k = 0; k < hands; k++) out.push([`hand ${k + 1}`, hand(m, rnd)]);
	// Pointer jitter: many samples, each off by up to 0.003 (about a pixel on a phone pad).
	out.push(['fine jitter', resample(m, 120).map((p) => ({ x: p.x + (rnd() * 2 - 1) * 0.003, y: p.y + (rnd() * 2 - 1) * 0.003 }))]);
	const ho = hookOmitted(m);
	if (ho) {
		out.push(['hook omitted', hand(ho, rnd, { amp: 0.015, endFrac: 0.05, rotDeg: 5 })]);
		out.push(['hook exaggerated', hand(hookExaggerated(m), rnd, { amp: 0.015, endFrac: 0.05, rotDeg: 5 })]);
		out.push(['hook overshot', hand(hookExaggerated(m, 3), rnd, { amp: 0.01, endFrac: 0, rotDeg: 3 })]);
	}
	const cr = cornerRounded(m);
	if (cr) out.push(['corner rounded', hand(cr, rnd, { amp: 0.015, endFrac: 0.05, rotDeg: 5 })]);
	const base = hand(m, rnd, { amp: 0.01, endFrac: 0.05, rotDeg: 3 });
	const c = centroid(m);
	out.push(['shifted', shift(base, c.x < 0.5 ? 0.1 : -0.1, c.y < 0.5 ? 0.1 : -0.1)]);
	out.push(['scaled x0.7', scale(base, 0.7)]);
	out.push(['scaled x1.4', scale(base, 1.4)]);
	return out;
}
