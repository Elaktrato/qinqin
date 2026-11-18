// The one-primary-action check (#106): the visible Buttons rendered with
// variant primary or filled. A page dom test asserts the count per view.

export function primaryActions(root: ParentNode): HTMLElement[] {
	const out: HTMLElement[] = [];
	for (const el of root.querySelectorAll<HTMLElement>('.button.primary, .button.filled')) {
		if (el.hidden) continue;
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden') continue;
		out.push(el);
	}
	return out;
}
