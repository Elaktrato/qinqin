// The one-primary-action check (#106): the visible Buttons rendered with
// variant primary or filled. A page dom test asserts the count per view.

export function primaryActions(root: ParentNode): HTMLElement[] {
	const out: HTMLElement[] = [];
	for (const el of root.querySelectorAll<HTMLElement>('.button.primary, .button.filled')) {
		// A hidden branch (a settings panel, a closed view) holds no visible
		// action, even when the element's own computed display is unset.
		let node: HTMLElement | null = el;
		let shown = true;
		while (node !== null) {
			if (node.hidden) {
				shown = false;
				break;
			}
			const style = window.getComputedStyle(node);
			if (style.display === 'none' || style.visibility === 'hidden') {
				shown = false;
				break;
			}
			node = node.parentElement;
		}
		if (shown) out.push(el);
	}
	return out;
}
