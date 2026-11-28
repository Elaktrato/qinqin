// Routing inside /courses (#222): `rest` is what follows the slug. The player lives under /courses/play, where the
// frame hides the bottom bar (lib/frame/barItems.ts).

export type CourseRoute =
	/** The roadmap of a course; null: the workspace's course. */
	| { view: 'roadmap'; course: string | null }
	| { view: 'lesson'; course: string; unit: string; lesson: string }
	| { view: 'test'; course: string; unit: string }
	| { view: 'exam'; course: string; section: string }
	/** A placement exam (#224): the section exam of `section`, as a step of placement. */
	| { view: 'placement'; course: string; section: string };

/** The path segment the player lives under. */
export const PLAY = 'play';

function decode(part: string): string | null {
	try {
		return decodeURIComponent(part);
	} catch {
		return null;
	}
}

export function parseCourseRoute(rest: string): CourseRoute {
	const raw = rest.split('/').filter((s) => s !== '');
	const parts = raw.map(decode);
	if (parts.some((p) => p === null)) return { view: 'roadmap', course: null };
	const p = parts as string[];
	if (p.length === 1 && p[0] !== PLAY) return { view: 'roadmap', course: p[0] };
	if (p[0] === PLAY && p.length === 4) {
		if (p[3] === 'test') return { view: 'test', course: p[1], unit: p[2] };
		return { view: 'lesson', course: p[1], unit: p[2], lesson: p[3] };
	}
	if (p[0] === PLAY && p.length === 5 && p[2] === 'section' && (p[4] === 'exam' || p[4] === 'placement')) {
		return { view: p[4], course: p[1], section: p[3] };
	}
	return { view: 'roadmap', course: null };
}

const enc = encodeURIComponent;

export function courseHref(route: CourseRoute): string {
	switch (route.view) {
		case 'roadmap':
			return route.course === null ? '/courses' : `/courses/${enc(route.course)}`;
		case 'lesson':
			return `/courses/${PLAY}/${enc(route.course)}/${enc(route.unit)}/${enc(route.lesson)}`;
		case 'test':
			return `/courses/${PLAY}/${enc(route.course)}/${enc(route.unit)}/test`;
		case 'exam':
			return `/courses/${PLAY}/${enc(route.course)}/section/${enc(route.section)}/exam`;
		case 'placement':
			return `/courses/${PLAY}/${enc(route.course)}/section/${enc(route.section)}/placement`;
	}
}
