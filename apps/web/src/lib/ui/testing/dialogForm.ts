// Test helpers for the confirmation dialogs (lib/ui Dialog with a <form>
// in its content and the submit Button in its actions row, tied to the
// form by `form=`). jsdom does not implement implicit submission (Enter in
// a field), so pressEnter does what the HTML standard says a browser does:
// submit through the form's default button, unless it is disabled.
import { fireEvent } from '@testing-library/svelte';

type Submitter = HTMLButtonElement | HTMLInputElement;

/** The form's default button: the first submit button in tree order whose form owner is `form`. */
export function defaultButton(form: HTMLFormElement): Submitter | null {
	for (const el of document.querySelectorAll<Submitter>('button, input[type="submit"], input[type="image"]')) {
		if (el.form === form && (el.type === 'submit' || el.type === 'image')) return el;
	}
	return null;
}

/** Enter in `field`: true when it submitted the form (through its default button). */
export async function pressEnter(field: HTMLInputElement): Promise<boolean> {
	await fireEvent.keyDown(field, { key: 'Enter' });
	const form = field.form;
	if (!form) return false;
	const button = defaultButton(form);
	if (!button || button.disabled) return false;
	form.requestSubmit(button);
	return true;
}

/** A promise to settle from the test: a request that is still running. */
export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** The browser's Escape on a modal dialog: a cancelable `cancel`, plus the keydown. */
export async function escape(dialog: HTMLElement): Promise<void> {
	await fireEvent.keyDown(dialog, { key: 'Escape' });
	dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
}
