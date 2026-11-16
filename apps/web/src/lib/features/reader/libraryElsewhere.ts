// The Library's empty state points to the workspaces that do hold books
// (after the upgrade, a user's books may sit in another workspace than
// the selected one).

interface WorkspaceRef {
	id: number;
}

/**
 * workspacesWithBooks counts `books` per workspace of `workspaces`, in
 * list order, leaving out workspaces without books, books of unknown
 * workspaces, and `exceptId` (the selected workspace).
 */
export function workspacesWithBooks<W extends WorkspaceRef>(
	books: readonly { workspaceId: number }[],
	workspaces: readonly W[],
	exceptId?: number
): { workspace: W; count: number }[] {
	const counts = new Map<number, number>();
	for (const book of books) counts.set(book.workspaceId, (counts.get(book.workspaceId) ?? 0) + 1);
	return workspaces
		.filter((workspace) => workspace.id !== exceptId && (counts.get(workspace.id) ?? 0) > 0)
		.map((workspace) => ({ workspace, count: counts.get(workspace.id)! }));
}
