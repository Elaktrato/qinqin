// Which workspace a reading session is credited to. The library lists
// every book whatever workspace is selected, and each workspace is one
// language, so the book's language decides; the header's selection is
// only the fallback.

interface WorkspaceRef {
	id: number;
	language: string;
}

/**
 * workspaceForBook returns the id of the workspace for `bookLanguage`
 * (the selected one if it matches, else the first that does), else the
 * selected workspace, else null (nothing is recorded).
 */
export function workspaceForBook(
	list: readonly WorkspaceRef[],
	current: WorkspaceRef | null,
	bookLanguage: string | null | undefined
): number | null {
	if (bookLanguage) {
		if (current?.language === bookLanguage) return current.id;
		const match = list.find((workspace) => workspace.language === bookLanguage);
		if (match) return match.id;
	}
	return current?.id ?? null;
}
