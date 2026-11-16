import { describe, expect, it } from 'vitest';
import { workspacesWithBooks } from './libraryElsewhere';

const ws = (id: number, language: string, name = '') => ({
	id,
	language,
	name,
	settings: {},
	updatedAt: ''
});
const book = (id: number, workspaceId: number) => ({ id, workspaceId });

describe('workspacesWithBooks', () => {
	const list = [ws(1, 'ja'), ws(2, 'zh'), ws(3, 'ja', 'Novels')];

	it('counts books per workspace, in workspace-list order', () => {
		const got = workspacesWithBooks([book(1, 3), book(2, 2), book(3, 3)], list);
		expect(got.map((g) => [g.workspace.id, g.count])).toEqual([
			[2, 1],
			[3, 2]
		]);
	});

	it('leaves out workspaces without books', () => {
		expect(workspacesWithBooks([book(1, 2)], list).map((g) => g.workspace.id)).toEqual([2]);
	});

	it('ignores books of workspaces not in the list', () => {
		expect(workspacesWithBooks([book(1, 99)], list)).toEqual([]);
	});

	it('is empty without books or workspaces', () => {
		expect(workspacesWithBooks([], list)).toEqual([]);
		expect(workspacesWithBooks([book(1, 1)], [])).toEqual([]);
	});

	it('can leave out the current workspace', () => {
		const got = workspacesWithBooks([book(1, 1), book(2, 2)], list, 1);
		expect(got.map((g) => g.workspace.id)).toEqual([2]);
	});
});
