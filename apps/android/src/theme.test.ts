import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #283: the app showed a black window title ("qinqin", the activity label) above the web app. The activity starts
// on the splash theme and must be on a theme without a title or action bar before anything builds the window's
// decor; EdgeToEdge.enable builds it (window.getDecorView()). A resource and source test: the behaviour itself is
// checked in the emulator job (e2e/chrome.mjs).
const read = (path: string) =>
	readFileSync(new URL(`../android/app/src/main/${path}`, import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const styles = read('res/values/styles.xml');
const manifest = read('AndroidManifest.xml');
const activity = read('java/qinqin/shell/MainActivity.java').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

/** style returns the items of one <style>, by name. */
function style(name: string): { parent: string; items: Record<string, string> } {
	const m = new RegExp(`<style name="${name.replace(/\./g, '\\.')}" parent="([^"]+)"\\s*(?:/>|>([\\s\\S]*?)</style>)`).exec(styles);
	if (!m) throw new Error(`no style ${name}`);
	const items: Record<string, string> = {};
	for (const i of (m[2] ?? '').matchAll(/<item name="([^"]+)">([^<]*)<\/item>/g)) items[i[1]] = i[2].trim();
	return { parent: m[1], items };
}

const noTitle = { windowNoTitle: 'true', windowActionBar: 'false', 'android:windowNoTitle': 'true', 'android:windowActionBar': 'false' };

describe('themes (#283)', () => {
	it('the main activity starts on the splash theme', () => {
		const main = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/.exec(manifest)?.[0] ?? '';
		expect(main).toContain('android:theme="@style/AppTheme.NoActionBarLaunch"');
	});
	it('the splash theme hands over to AppTheme.NoActionBar and has no title itself', () => {
		const launch = style('AppTheme.NoActionBarLaunch');
		expect(launch.parent).toBe('Theme.SplashScreen');
		expect(launch.items.postSplashScreenTheme).toBe('@style/AppTheme.NoActionBar');
		expect(launch.items).toMatchObject({ 'android:windowNoTitle': 'true', 'android:windowActionBar': 'false' });
	});
	it('AppTheme.NoActionBar (what Capacitor and the splash switch to) has neither a title nor an action bar', () => {
		const t = style('AppTheme.NoActionBar');
		expect(t.parent).toMatch(/NoActionBar$/);
		expect(t.items).toMatchObject(noTitle);
	});
	it('AppTheme (the application theme) has no action bar', () => {
		expect(style('AppTheme').parent).toMatch(/NoActionBar$/);
	});
});

describe('MainActivity.onCreate (#283)', () => {
	const body = /public void onCreate\(Bundle savedInstanceState\) \{([\s\S]*?)\n {4}\}/.exec(activity)?.[1] ?? '';
	const at = (s: string) => body.indexOf(s);
	it('installs the splash screen first: before EdgeToEdge builds the decor and before super.onCreate', () => {
		expect(at('SplashScreen.installSplashScreen(this)')).toBeGreaterThanOrEqual(0);
		expect(at('SplashScreen.installSplashScreen(this)')).toBeLessThan(at('EdgeToEdge.enable(this)'));
		expect(at('EdgeToEdge.enable(this)')).toBeLessThan(at('super.onCreate(savedInstanceState)'));
	});
	it('imports the splash screen of androidx core-splashscreen', () => {
		expect(activity).toMatch(/import androidx\.core\.splashscreen\.SplashScreen;/);
	});
});
