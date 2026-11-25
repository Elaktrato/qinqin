// Share out: a sentence, an entry. The system share sheet in the shell, navigator.share in browsers that have
// it, the clipboard otherwise. canShare says whether a Share action is worth showing at all.
import { plugin } from './shell';

export interface SharePlugin {
	shareText(options: { text: string; title?: string }): Promise<void>;
	takeIncoming(): Promise<{ items: { kind: string; value: string }[] }>;
	addListener(event: 'incoming', listener: () => void): Promise<{ remove(): Promise<void> }>;
}

export const sharePlugin = (): SharePlugin | null => plugin<SharePlugin>('QinqinShare');

/** shared: handed to a share sheet; copied: put on the clipboard; cancelled: the person closed the sheet; failed: could not. */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

const canNavigatorShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';
const canCopy = (): boolean => typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';

/** canShare: whether shareText can do anything here. */
export function canShare(): boolean {
	return sharePlugin() !== null || canNavigatorShare() || canCopy();
}

/** shareText shares a text (never HTML). */
export async function shareText(text: string, title?: string): Promise<ShareResult> {
	if (text.trim() === '') return 'failed';
	const data = title ? { text, title } : { text };
	const shell = sharePlugin();
	try {
		if (shell !== null) {
			await shell.shareText(data);
			return 'shared';
		}
		if (canNavigatorShare()) {
			try {
				await navigator.share(data);
				return 'shared';
			} catch (e) {
				if ((e as { name?: string }).name === 'AbortError') return 'cancelled';
				// not allowed here: try the clipboard
			}
		}
		if (canCopy()) {
			await navigator.clipboard.writeText(text);
			return 'copied';
		}
	} catch {
		// fall through
	}
	return 'failed';
}
