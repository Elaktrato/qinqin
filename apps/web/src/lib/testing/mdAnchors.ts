// GitHub's heading anchors of a Markdown page, for the doc tests (README and wiki links with #anchors):
// lower case, link markup reduced to its text, punctuation dropped, spaces to hyphens; a repeated heading
// gets -1, -2, ... Headings inside fenced code blocks do not count.
export function mdAnchors(md: string): Set<string> {
	const out = new Set<string>();
	const seen = new Map<string, number>();
	let fence = false;
	for (const line of md.split('\n')) {
		if (/^\s*(```|~~~)/.test(line)) {
			fence = !fence;
			continue;
		}
		const m = !fence && /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
		if (!m) continue;
		const base = m[1]
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
			.replace(/ /g, '-');
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		out.add(n === 0 ? base : `${base}-${n}`);
	}
	return out;
}
