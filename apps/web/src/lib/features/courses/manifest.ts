// The courses feature (/courses, #222): a guided path through sections, units and lessons. Its courses are course
// packs (#221), credited on the Sources page with the packs. Its Home widget "Continue course" (#225) is the one-tap
// entry: first in the default Home layout.
import type { FeatureDef } from '$lib/features';
import { t } from '$lib/i18n';
import CourseWidget from './CourseWidget.svelte';

export const coursesDef: FeatureDef = {
	widgets: [
		{
			id: 'course-continue',
			get title() {
				return t('widgets.course.title');
			},
			get description() {
				return t('widgets.course.description');
			},
			owner: 'courses',
			size: 'wide',
			// Home only: Stats shows the course's numbers as an activity row and milestones.
			surfaces: ['home'],
			component: CourseWidget
		}
	]
};
