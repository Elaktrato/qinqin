// Text inside a lookup popup that Shift+hover can look up is marked with
// data-scan="<language>" (cross-references, glosses with Han or kana). This
// maps a caret inside a popup to that region's text and the caret's
// code-point offset in it, the input lookupAt takes. It reads only the node
// tree (no layout), so it runs under vitest with a stand-in tree.
import { utf16ToCodePoint } from './lookup';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export interface ScanTarget {
	/** The innermost data-scan element around the caret. */
	element: HTMLElement;
	text: string;
	/** Code-point offset of the caret in `text`. */
	offset: number;
	/** The data-scan value: the language to look the text up in. */
	lang: string;
}

function textOf(node: Node): string {
	if (node.nodeType === TEXT_NODE) return node.nodeValue ?? '';
	let text = '';
	for (const child of node.childNodes) text += textOf(child);
	return text;
}

// UTF-16 length of the text before `target` inside `within`, or null when
// `target` is not inside it.
function textBefore(within: Node, target: Node): number | null {
	let length = 0;
	const walk = (node: Node): boolean => {
		if (node === target) return true;
		if (node.nodeType === TEXT_NODE) {
			length += node.nodeValue?.length ?? 0;
			return false;
		}
		for (const child of node.childNodes) if (walk(child)) return true;
		return false;
	};
	return walk(within) ? length : null;
}

/**
 * scanTarget finds the innermost data-scan element holding the caret
 * (caretNode, caretOffset as caretPositionFromPoint reports it) inside
 * `root`, and returns its full text with the caret's code-point offset.
 * Null when the caret is in no scan region of `root`.
 */
export function scanTarget(root: HTMLElement, caretNode: Node, caretOffset: number): ScanTarget | null {
	let region: Element | null = null;
	for (let n: Node | null = caretNode; n; n = n.parentNode) {
		if (!region && n.nodeType === ELEMENT_NODE && (n as Element).getAttribute('data-scan') !== null) {
			region = n as Element;
		}
		if (n === root) {
			if (!region) return null;
			const before = textBefore(region, caretNode);
			if (before === null) return null;
			let inNode: number;
			if (caretNode.nodeType === TEXT_NODE) {
				inNode = Math.min(Math.max(0, caretOffset), caretNode.nodeValue?.length ?? 0);
			} else {
				inNode = 0;
				const children = Array.from(caretNode.childNodes).slice(0, Math.max(0, caretOffset));
				for (const child of children) inNode += textOf(child).length;
			}
			const text = textOf(region);
			return {
				element: region as HTMLElement,
				text,
				offset: utf16ToCodePoint(text, before + inNode),
				lang: region.getAttribute('data-scan') ?? ''
			};
		}
	}
	return null;
}
