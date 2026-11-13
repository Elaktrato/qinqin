// Which workspace a reading session is credited to: the workspace whose
// library holds the book. A book without one (served by an older server)
// falls back to the workspace of its language, else the selected one.

interface WorkspaceRef {
	id: number;
	language: string;
}

/**
 * workspaceForBook returns the book's workspace id. Without one: the
 * selected workspace if its language matches the book's, else the first
 * that does, else the selected workspace, else null (nothing is recorded).
 */
export function workspaceForBook(
	book: { workspaceId?: number | null; language?: string | null },
	list: readonly WorkspaceRef[],
	current: WorkspaceRef | null
): number | null {
	if (book.workspaceId && book.workspaceId > 0) return book.workspaceId;
	const language = book.language;
	if (language) {
		if (current?.language === language) return current.id;
		const match = list.find((workspace) => workspace.language === language);
		if (match) return match.id;
	}
	return current?.id ?? null;
}
