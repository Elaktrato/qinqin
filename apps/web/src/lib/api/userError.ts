// UserError (#168): an error raised by the app itself whose text the learner sees. It carries a catalogue key and
// its arguments, never an English sentence, so `errorText` (apiErrors.ts) shows it translated. Developer errors stay
// plain `Error`s and screens show their own fallback for them.
import type { MessageKey } from '$lib/i18n';

export class UserError extends Error {
	readonly key: MessageKey;
	readonly args?: Readonly<Record<string, string | number>>;

	constructor(key: MessageKey, args?: Record<string, string | number>) {
		super(key);
		this.name = 'UserError';
		this.key = key;
		if (args !== undefined) this.args = args;
	}
}
