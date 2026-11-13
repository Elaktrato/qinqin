export type ListboxAction = 'move' | 'select' | 'close' | 'none';

/**
 * listboxKey maps a key press in an open single-select listbox to what
 * should happen next. `active` is the highlighted option (-1 for none)
 * and `count` the number of options. Arrows clamp at the ends (no
 * wrapping), Home/End jump, Enter/Space choose the active option, and
 * Escape closes the list. Tab is left to the caller (focus moves on).
 */
export function listboxKey(
	key: string,
	active: number,
	count: number
): { action: ListboxAction; index: number } {
	if (key === 'Escape') return { action: 'close', index: active };
	if (count <= 0) return { action: 'none', index: active };
	const last = count - 1;
	switch (key) {
		case 'ArrowDown':
			return { action: 'move', index: active < 0 ? 0 : Math.min(active + 1, last) };
		case 'ArrowUp':
			return { action: 'move', index: active < 0 ? last : Math.max(active - 1, 0) };
		case 'Home':
			return { action: 'move', index: 0 };
		case 'End':
			return { action: 'move', index: last };
		case 'Enter':
		case ' ':
			return active >= 0 && active <= last
				? { action: 'select', index: active }
				: { action: 'none', index: active };
		default:
			return { action: 'none', index: active };
	}
}
