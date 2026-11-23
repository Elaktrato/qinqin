// UserError (#168): an error raised by the app itself whose text the learner sees. It carries a catalogue key and
// its arguments, so `errorText` (apiErrors.ts) shows it translated. Developer errors stay
// plain `Error`s and screens show their own fallback for them.
import { t, type MessageKey } from '$lib/i18n';

export class UserError extends Error {
	readonly key: MessageKey;
	readonly args?: Readonly<Record<string, string | number>>;

	constructor(key: MessageKey, args?: Record<string, string | number>) {
		super(t(key, args)); // the text in the interface language at the time, for the console
		this.name = 'UserError';
		this.key = key;
		if (args !== undefined) this.args = args;
	}
}

/**
 * ShownError is an error whose text is already interface text (built with `t` or `errorText` where it was thrown),
 * such as the study store's partial-write errors; `errorText` shows `text` as it is.
 */
export class ShownError extends Error {
	readonly text: string;

	constructor(text: string) {
		super(text);
		this.name = 'ShownError';
		this.text = text;
	}
}
