// The context a Menu gives its MenuItems: how to close it after a pick.
import { getContext, setContext } from 'svelte';

export interface MenuContext {
	/** close hides the menu; returnFocus moves focus back to its trigger. */
	close(returnFocus: boolean): void;
	/** settle refocuses after a keepOpen pick changed the content (the item marked `focus`, else the first). */
	settle(): void;
}

const KEY = Symbol('qinqin-menu');

export function setMenuContext(ctx: MenuContext): void {
	setContext(KEY, ctx);
}

export function getMenuContext(): MenuContext | undefined {
	return getContext<MenuContext | undefined>(KEY);
}
