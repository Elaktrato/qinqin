// The study modal's one opener (the study modal design, 4.6): every "Study"
// button of the session calls show(); the root layout renders the modal while
// `open`. Per session (record 0009), so a sign-out closes it.

export class StudyModalState {
	#open = $state(false);

	get open(): boolean {
		return this.#open;
	}

	show(): void {
		this.#open = true;
	}

	hide(): void {
		this.#open = false;
	}
}
