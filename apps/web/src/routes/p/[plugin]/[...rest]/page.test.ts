import { describe, expect, it } from 'vitest';
import { load } from './+page';

// The old plugin URLs (#199): the core features' land on their routes, every
// other /p/<id> is gone.
function run(path: string): unknown {
	const url = new URL(`http://localhost${path}`);
	try {
		load({ url } as never);
	} catch (thrown) {
		return thrown;
	}
	return undefined;
}

describe('/p/<plugin>', () => {
	it('redirects the core features to their routes, keeping query and fragment', () => {
		expect(run('/p/journal/e/e1?x=1#a')).toMatchObject({ status: 308, location: '/journal/e/e1?x=1#a' });
		expect(run('/p/grammar')).toMatchObject({ status: 308, location: '/grammar' });
		expect(run('/p/flashcards/deck/general')).toMatchObject({ status: 308, location: '/flashcards/deck/general' });
		expect(run('/p/reader/book/2/1')).toMatchObject({ status: 308, location: '/reader/book/2/1' });
	});

	it('answers 404 for any other plugin id', () => {
		expect(run('/p/notes')).toMatchObject({ status: 404 });
		expect(run('/p/qinqin-journal/x')).toMatchObject({ status: 404 });
	});
});
