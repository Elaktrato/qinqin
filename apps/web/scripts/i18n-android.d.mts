// Types for i18n-android.mjs (the reference catalogue-to-Android converter, docs/contracts/i18n/README.md).
export function resourceName(key: string): string;
export function convert(
	catalogue: Readonly<Record<string, string>>,
	en: Readonly<Record<string, string>>,
	notes: Readonly<Record<string, string>>
): string;
