// System bars follow the active theme (#34). The status bar and the navigation bar are transparent over the
// page (edge to edge), so the colour behind them is the page's `--chrome`; what the shell needs from the page
// is that colour (for the window behind a WebView that does not paint under the bars) and whether the icons
// on it must be dark or light.
import { ratio } from '$lib/theme/contrast';
import { shellPlugin } from './shell';

export interface BarStyle {
	background: string;
	/** True when the icons must be dark (the background is light). */
	darkIcons: boolean;
}

const COLOR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;

/**
 * barStyle maps the chrome colour (`#rrggbb`, a trailing alpha is dropped) to the bars: the icons are
 * whichever of near-black and white contrasts more with it. Null when the value is not a colour.
 */
export function barStyle(chrome: string): BarStyle | null {
	const value = chrome.trim();
	if (!COLOR.test(value)) return null;
	const background = value.slice(0, 7).toLowerCase();
	return { background, darkIcons: ratio(background, '#000000') >= ratio(background, '#ffffff') };
}

export interface BarsDeps {
	root: HTMLElement;
	/** Applies a style in the shell. */
	apply(style: BarStyle): void;
	/** Watches `root` for the painting of a theme (its style or data-scheme change); returns the stop. */
	watch(root: HTMLElement, onChange: () => void): () => void;
}

/** startBars applies the bar style now and whenever the theme is painted. Returns the stop. */
export function startBars(deps: BarsDeps): () => void {
	let last = '';
	const sync = (): void => {
		const style = barStyle(getComputedStyle(deps.root).getPropertyValue('--chrome'));
		if (style === null) return;
		const key = `${style.background}/${style.darkIcons}`;
		if (key === last) return;
		last = key;
		deps.apply(style);
	};
	sync();
	return deps.watch(deps.root, sync);
}

/** startShellBars: startBars on the document, through the shell's plugin; nothing outside the shell. */
export function startShellBars(): () => void {
	const shell = shellPlugin();
	if (shell === null || typeof document === 'undefined') return () => undefined;
	return startBars({
		root: document.documentElement,
		apply: (style) => void Promise.resolve(shell.setBars(style)).catch(() => undefined),
		watch: (root, onChange) => {
			const observer = new MutationObserver(onChange);
			observer.observe(root, { attributes: true, attributeFilter: ['style', 'data-scheme', 'class'] });
			return () => observer.disconnect();
		}
	});
}
