// A credit for third-party material the app or a plugin ships or uses:
// the same fields a pack manifest carries (name, licence, attribution,
// notice), declared in code by the app (coreCredits) and by web plugins
// (PluginManifest.sources). The Sources page renders them.

/** A licence text the app serves itself, such as `/ARPHICPL.TXT`. */
export interface LicenseText {
	label: string;
	/** Root-relative path of a file under apps/web/static. */
	path: string;
}

export interface SourceCredit {
	name: string;
	/** The upstream project page; rendered only when it is https. */
	url?: string;
	license?: string;
	attribution?: string;
	/** Notice mini-markup: blank-line paragraphs, `[text](https://…)` links. */
	notice?: string;
	/** Licence texts that ship with the app. */
	licenseTexts?: LicenseText[];
	/** Language tag for CJK text in the notice (`ja`, `zh`). */
	lang?: string;
}

/**
 * localLicensePath accepts only a root-relative file name under the
 * static root (`/ARPHICPL.TXT`), so a credit can never point elsewhere.
 */
export function localLicensePath(path: string): string | null {
	return /^\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(path) ? path : null;
}
