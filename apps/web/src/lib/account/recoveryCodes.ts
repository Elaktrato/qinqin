// Recovery codes: how they are shown, copied and saved. The server sends
// them once, already formatted ABCD-EFGH-IJKL-MNOP.

import { t } from '$lib/i18n';

function localDay(d: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The text of the downloaded file (one code per line, with the instructions). */
export function recoveryText(codes: readonly string[], site: string, now: Date): string {
	const when = localDay(now);
	return [
		t('account.recovery.fileTitle', { site }),
		t('account.recovery.fileMade', { day: when }),
		'',
		t('account.recovery.fileEach'),
		t('account.recovery.fileKeep'),
		'',
		...codes,
		''
	].join('\n');
}

/** The file name offered by Download. */
export function recoveryFileName(now: Date): string {
	return `qinqin-recovery-codes-${localDay(now)}.txt`;
}

/** What Copy puts on the clipboard: one code per line. */
export function recoveryClipboard(codes: readonly string[]): string {
	return codes.join('\n');
}
