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

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*(?:,|\/)\s*[\d.]+%?)?\s*\)$/i;

const byte = (n: number): string => n.toString(16).padStart(2, '0');

/** toHex6 reads `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `rgb()`/`rgba()` as `#rrggbb` (alpha dropped); null otherwise. */
export function toHex6(value: string): string | null {
	const v = value.trim();
	const hex = HEX.exec(v);
	if (hex) {
		const h = hex[1].toLowerCase();
		if (h.length <= 4) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
		return `#${h.slice(0, 6)}`;
	}
	const rgb = RGB.exec(v);
	if (rgb) {
		const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
		if (parts.every((n) => n <= 255)) return `#${parts.map(byte).join('')}`;
	}
	return null;
}

/**
 * barStyle maps the chrome colour to the bars (see toHex6 for the accepted forms; the shell is sent `#rrggbb`
 * only): the icons are whichever of near-black and white contrasts more with it. Null when the value is not a
 * colour this can read (a named colour, `color-mix()`, a variable): the caller then keeps the last style.
 */
export function barStyle(chrome: string): BarStyle | null {
	const background = toHex6(chrome);
	if (background === null) return null;
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
		const computed = getComputedStyle(deps.root);
		// A custom property is raw text (`red`, `color-mix(...)`): when it is not one of the forms barStyle reads,
		// let the engine resolve it through a real property (`color` computes to rgb()).
		const raw = computed.getPropertyValue('--chrome');
		let style = barStyle(raw);
		if (style === null && raw.trim() !== '') {
			const probe = deps.root.ownerDocument.createElement('span');
			probe.style.color = raw.trim();
			deps.root.append(probe);
			style = barStyle(getComputedStyle(probe).color);
			probe.remove();
		}
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
