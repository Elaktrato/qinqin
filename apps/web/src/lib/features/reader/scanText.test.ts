import { describe, expect, it } from 'vitest';
import { scanTarget } from './scanText';

// The vitest environment has no DOM: a minimal node tree with the members
// scanTarget reads (nodeType, parentNode, childNodes, nodeValue,
// getAttribute) stands in for it.
interface FakeNode {
	nodeType: number;
	nodeValue: string | null;
	parentNode: FakeNode | null;
	childNodes: FakeNode[];
	attrs: Record<string, string>;
	getAttribute(name: string): string | null;
}

function node(nodeType: number, nodeValue: string | null, attrs: Record<string, string>, children: FakeNode[]): FakeNode {
	const n: FakeNode = {
		nodeType,
		nodeValue,
		parentNode: null,
		childNodes: children,
		attrs,
		getAttribute: (name) => (name in attrs ? attrs[name] : null)
	};
	for (const child of children) child.parentNode = n;
	return n;
}

const el = (attrs: Record<string, string>, ...children: FakeNode[]) => node(1, null, attrs, children);
const txt = (value: string) => node(3, value, {}, []);

// The DOM types are what scanTarget takes; the fakes satisfy what it reads.
const scan = (root: FakeNode, caret: FakeNode, offset: number) =>
	scanTarget(root as unknown as HTMLElement, caret as unknown as Node, offset);

describe('scanTarget', () => {
	it('returns the scan element text and the code-point offset of the caret', () => {
		const word = txt('為さる');
		const xref = el({ 'data-scan': 'ja' }, txt('see also '), word);
		const root = el({}, el({}, txt('to do')), xref);
		expect(scan(root, word, 1)).toEqual({ element: xref, text: 'see also 為さる', offset: 10, lang: 'ja' });
	});

	it('counts astral characters as one code point', () => {
		const tail = txt('𠮷野家');
		const region = el({ 'data-scan': 'ja' }, txt('a𠮷'), tail);
		const root = el({}, region);
		// 'a𠮷' is 2 code points (3 UTF-16 units); the caret is after '𠮷' in tail (UTF-16 2).
		expect(scan(root, tail, 2)).toMatchObject({ text: 'a𠮷𠮷野家', offset: 3 });
	});

	it('uses the innermost scan region when regions nest', () => {
		const inner = txt('马');
		const innerRegion = el({ 'data-scan': 'zh' }, txt('馬|'), inner);
		const outer = el({ 'data-scan': 'ja' }, txt('variant of '), innerRegion);
		const root = el({}, outer);
		expect(scan(root, inner, 0)).toMatchObject({ element: innerRegion, text: '馬|马', offset: 2, lang: 'zh' });
	});

	it('is null for a caret outside any scan region', () => {
		const plain = txt('to do; to perform');
		const root = el({}, el({}, plain), el({ 'data-scan': 'ja' }, txt('為る')));
		expect(scan(root, plain, 3)).toBeNull();
	});

	it('is null for a caret outside the root, even inside a scan region', () => {
		const other = txt('学习');
		el({ 'data-scan': 'zh' }, other);
		const root = el({}, el({ 'data-scan': 'zh' }, txt('行')));
		expect(scan(root, other, 0)).toBeNull();
	});

	it('maps an element caret (offset counts child nodes) to the text before it', () => {
		const region = el({ 'data-scan': 'ja' }, txt('見'), el({}, txt('る')), txt('こと'));
		const root = el({}, region);
		expect(scan(root, region, 2)).toMatchObject({ text: '見ること', offset: 2 });
	});

	it('clamps a caret past the end of its text node', () => {
		const t = txt('為る');
		const root = el({}, el({ 'data-scan': 'ja' }, t));
		expect(scan(root, t, 9)).toMatchObject({ offset: 2 });
	});
});
