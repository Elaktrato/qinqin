// IME composition (#178): with a Japanese IME, Enter first commits the composed text (かく → 書く); only an Enter
// after that submits. Browsers mark the committing key `isComposing`; the Android WebView and older Safari send
// keyCode 229 instead; the field also tracks compositionstart/compositionend itself.

/** submitsAnswer: this keydown is an Enter that submits the answer (not one that ends a composition). */
export function submitsAnswer(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode' | 'shiftKey'>, composing: boolean): boolean {
	return event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !composing;
}
