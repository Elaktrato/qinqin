// Recovery codes: how they are shown, copied and saved. The server sends
// them once, already formatted ABCD-EFGH-IJKL-MNOP.

/** The text of the downloaded file (one code per line, with the instructions). */
export function recoveryText(codes: readonly string[], site: string, now: Date): string {
	const when = now.toISOString().slice(0, 10);
	return [
		`qinqin recovery codes for ${site}`,
		`Made on ${when}.`,
		'',
		'Each code works once, when you cannot use your authenticator app.',
		'Keep this file somewhere safe and private.',
		'',
		...codes,
		''
	].join('\n');
}

/** The file name offered by Download. */
export function recoveryFileName(now: Date): string {
	return `qinqin-recovery-codes-${now.toISOString().slice(0, 10)}.txt`;
}

/** What Copy puts on the clipboard: one code per line. */
export function recoveryClipboard(codes: readonly string[]): string {
	return codes.join('\n');
}
