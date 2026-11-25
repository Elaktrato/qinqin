// The picture gate of the web client: the same vocabulary and the same canonical
// form as server/internal/images/svg.go (docs/contracts/images/, svg.json; both
// run the same fixture). A picture is parsed as XML (DOMParser), walked against
// an element and attribute allowlist and rebuilt: what comes out is either a
// canonical string (sanitizeSvg) or freshly created DOM nodes (svgElement), never
// the pack's markup. Nothing is ever put through innerHTML or {@html}: a string
// that XML reads one way and HTML another (a comment closed by "<!-->") has no
// way through, because the nodes are created, not parsed from markup.

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

/** The same limits as the server's. */
export const MAX_SVG_BYTES = 256 << 10;
const MAX_DEPTH = 64;
const MAX_USES = 64;
const MAX_ATTR_LEN = 64 << 10;

const ELEMENTS = new Set([
	'svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'defs', 'clipPath', 'mask', 'use',
	'linearGradient', 'radialGradient', 'stop', 'title', 'desc'
]);

const ATTRS = new Set([
	'id', 'class', 'version', 'viewBox', 'preserveAspectRatio', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry',
	'fx', 'fy', 'fr', 'x1', 'y1', 'x2', 'y2', 'd', 'points', 'transform', 'pathLength', 'offset',
	'gradientUnits', 'gradientTransform', 'spreadMethod', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
	'clip-path', 'clip-rule', 'mask', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap',
	'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
	'color', 'stop-color', 'stop-opacity', 'display', 'visibility', 'overflow', 'vector-effect', 'paint-order'
]);

/** The declarations of a style attribute that become the attribute of the same name. */
const STYLE_PROPS = new Set([
	'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
	'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity', 'stop-color',
	'stop-opacity', 'display', 'visibility', 'clip-rule', 'paint-order'
]);

const FRAGMENT = /^#[A-Za-z0-9_.:-]+$/;
const BAD_SUBSTRINGS = ['\\', '/*', 'javascript:', 'data:', '@import', 'expression(', 'image-set', 'src(', '<'];
const URL_ALLOWED_ON = new Set(['fill', 'stroke', 'clip-path', 'mask']);

/** One element of a checked picture, or (name === '') a run of text. */
interface Node {
	name: string;
	attrs: [string, string][];
	kids: Node[];
	text: string;
}

class Refused extends Error {}

// No message: a refused picture is simply not drawn (and the text lint reads messages as UI text).
function refuse(): never {
	throw new Refused();
}

function collapseSpace(v: string): string {
	return v.replace(/\r\n/g, ' ').replace(/[\t\n\r]/g, ' ');
}

function checkValue(name: string, val: string): void {
	if (val.length > MAX_ATTR_LEN) refuse();
	const lower = val.toLowerCase();
	for (const bad of BAD_SUBSTRINGS) if (lower.includes(bad)) refuse();
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(val)) refuse();
	for (const m of val.matchAll(/url\(\s*['"]?\s*([^'")\s]*)/gi)) if (!FRAGMENT.test(m[1])) refuse();
	if (lower.includes('url(') && !URL_ALLOWED_ON.has(name)) refuse();
}

function parseStyle(v: string): [string, string][] {
	const out: [string, string][] = [];
	for (let decl of v.split(';')) {
		decl = decl.trim();
		if (decl === '') continue;
		const i = decl.indexOf(':');
		const k = i < 0 ? '' : decl.slice(0, i).trim().toLowerCase();
		const val = i < 0 ? '' : decl.slice(i + 1).trim();
		if (i < 0 || !STYLE_PROPS.has(k) || val === '' || val.includes('!')) refuse();
		checkValue(k, val);
		out.push([k, collapseSpace(val)]);
	}
	return out;
}

function checkElement(el: Element, isRoot: boolean): Node {
	if (el.namespaceURI !== SVG_NS || !ELEMENTS.has(el.localName)) refuse();
	if (isRoot && el.localName !== 'svg') refuse();
	const n: Node = { name: el.localName, attrs: [], kids: [], text: '' };
	const set = (name: string, val: string) => {
		const a = n.attrs.find((x) => x[0] === name);
		if (a) a[1] = val;
		else n.attrs.push([name, val]);
	};
	for (const a of Array.from(el.attributes)) {
		if (a.namespaceURI === XMLNS_NS) {
			if (a.localName === 'xmlns' ? a.value !== SVG_NS : a.localName !== 'xlink' || a.value !== XLINK_NS) refuse();
		} else if (a.localName === 'href' && (a.namespaceURI === null || a.namespaceURI === XLINK_NS)) {
			if (n.name !== 'use' && n.name !== 'linearGradient' && n.name !== 'radialGradient') refuse();
			if (!FRAGMENT.test(a.value)) refuse();
			if (n.attrs.some((x) => x[0] === 'href')) refuse();
			set('href', a.value);
		} else if (a.namespaceURI === null && a.localName === 'style') {
			for (const [k, v] of parseStyle(a.value)) set(k, v);
		} else if (a.namespaceURI === null && ATTRS.has(a.localName)) {
			checkValue(a.localName, a.value);
			set(a.localName, collapseSpace(a.value));
		} else refuse();
	}
	return n;
}

function walk(el: Element, depth: number, isRoot: boolean): Node {
	if (depth > MAX_DEPTH) refuse();
	const n = checkElement(el, isRoot);
	for (const c of Array.from(el.childNodes)) {
		if (c.nodeType === 1) n.kids.push(walk(c as Element, depth + 1, false));
		else if (c.nodeType === 3 || c.nodeType === 4) {
			const text = (c.nodeValue ?? '').replace(/\r/g, '');
			if (n.name === 'title' || n.name === 'desc') n.kids.push({ name: '', attrs: [], kids: [], text });
			else if (/[^ \t\r\n]/.test(text)) refuse();
		} else refuse(); // comment, processing instruction, entity reference
	}
	return n;
}

function holdsUse(n: Node): boolean {
	return n.name === 'use' || n.kids.some(holdsUse);
}

function checkUses(root: Node): void {
	const ids = new Map<string, Node>();
	const uses: Node[] = [];
	const visit = (n: Node) => {
		if (n.name === '') return;
		const id = n.attrs.find((a) => a[0] === 'id')?.[1];
		if (id !== undefined) {
			if (ids.has(id)) refuse();
			ids.set(id, n);
		}
		if (n.name === 'use') uses.push(n);
		n.kids.forEach(visit);
	};
	visit(root);
	if (uses.length > MAX_USES) refuse();
	for (const u of uses) {
		const href = (u.attrs.find((a) => a[0] === 'href')?.[1] ?? '').slice(1);
		const t = ids.get(href);
		if (t && holdsUse(t)) refuse();
	}
}

/** parse checks a picture and returns its checked tree, or null when it may not be drawn. */
function parse(svg: unknown): Node | null {
	if (typeof svg !== 'string' || svg === '' || svg.length > MAX_SVG_BYTES || typeof DOMParser === 'undefined') return null;
	try {
		const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
		const root = doc.documentElement;
		if (!root || doc.getElementsByTagName('parsererror').length > 0) return null;
		for (const c of Array.from(doc.childNodes)) {
			// the root, and nothing else (a comment, a DOCTYPE or an instruction before or after it)
			if (c !== root) return null;
		}
		const tree = walk(root, 1, true);
		checkUses(tree);
		return tree;
	} catch (e) {
		if (e instanceof Refused) return null;
		throw e;
	}
}

const attrEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function write(n: Node, root: boolean): string {
	if (n.name === '') return textEscape(n.text);
	let s = `<${n.name}${root ? ` xmlns="${SVG_NS}"` : ''}`;
	for (const [k, v] of n.attrs) s += ` ${k}="${attrEscape(v)}"`;
	if (n.kids.length === 0) return s + '/>';
	return s + '>' + n.kids.map((k) => write(k, false)).join('') + `</${n.name}>`;
}

/**
 * sanitizeSvg returns the canonical form of a picture (the one the server stores:
 * server/internal/images/svg.go CanonicalSVG) or null when it may not be drawn.
 * Pass the result to themeSvg and svgElement; do not put it into {@html}.
 */
export function sanitizeSvg(svg: unknown): string | null {
	const tree = parse(svg);
	return tree === null ? null : write(tree, true);
}

function build(n: Node, doc: Document): Element {
	const el = doc.createElementNS(SVG_NS, n.name);
	for (const [k, v] of n.attrs) el.setAttribute(k, v);
	for (const k of n.kids) el.append(k.name === '' ? doc.createTextNode(k.text) : build(k, doc));
	return el;
}

/**
 * svgElement parses and checks a picture again and builds its DOM nodes (created
 * with createElementNS, never from markup); null when it may not be drawn.
 */
export function svgElement(svg: unknown, doc: Document = document): Element | null {
	const tree = parse(svg);
	return tree === null ? null : build(tree, doc);
}
