// The fixed topic list (#220, docs/contracts/topics/topics.json) and the names a learner sees. The ids are
// shared by every language; a course unit names its theme by id (#221). The list order is the display order.

import { labelRecord } from '$lib/i18n';

export const TOPIC_IDS = ['greetings', 'people', 'family', 'relationships', 'body', 'health', 'feelings', 'character', 'food', 'drink', 'clothing', 'home', 'routine', 'shopping', 'money', 'city', 'transport', 'travel', 'position', 'geography', 'nature', 'animals', 'plants', 'weather', 'time', 'calendar', 'numbers', 'measures', 'colours', 'school', 'language', 'communication', 'work', 'business', 'technology', 'media', 'hobbies', 'sports', 'arts', 'festivals', 'society', 'law', 'culture', 'science', 'actions', 'movement', 'qualities', 'thinking', 'function'] as const;

export type TopicId = (typeof TOPIC_IDS)[number];

/** The name of each topic in the interface language. */
export const TOPIC_NAMES: Readonly<Record<TopicId, string>> = labelRecord({
	greetings: 'topics.name.greetings',
	people: 'topics.name.people',
	family: 'topics.name.family',
	relationships: 'topics.name.relationships',
	body: 'topics.name.body',
	health: 'topics.name.health',
	feelings: 'topics.name.feelings',
	character: 'topics.name.character',
	food: 'topics.name.food',
	drink: 'topics.name.drink',
	clothing: 'topics.name.clothing',
	home: 'topics.name.home',
	routine: 'topics.name.routine',
	shopping: 'topics.name.shopping',
	money: 'topics.name.money',
	city: 'topics.name.city',
	transport: 'topics.name.transport',
	travel: 'topics.name.travel',
	position: 'topics.name.position',
	geography: 'topics.name.geography',
	nature: 'topics.name.nature',
	animals: 'topics.name.animals',
	plants: 'topics.name.plants',
	weather: 'topics.name.weather',
	time: 'topics.name.time',
	calendar: 'topics.name.calendar',
	numbers: 'topics.name.numbers',
	measures: 'topics.name.measures',
	colours: 'topics.name.colours',
	school: 'topics.name.school',
	language: 'topics.name.language',
	communication: 'topics.name.communication',
	work: 'topics.name.work',
	business: 'topics.name.business',
	technology: 'topics.name.technology',
	media: 'topics.name.media',
	hobbies: 'topics.name.hobbies',
	sports: 'topics.name.sports',
	arts: 'topics.name.arts',
	festivals: 'topics.name.festivals',
	society: 'topics.name.society',
	law: 'topics.name.law',
	culture: 'topics.name.culture',
	science: 'topics.name.science',
	actions: 'topics.name.actions',
	movement: 'topics.name.movement',
	qualities: 'topics.name.qualities',
	thinking: 'topics.name.thinking',
	function: 'topics.name.function'
});

/** Whether a stored theme id is a topic of the list (an unknown id comes from a newer list). */
export function isTopicId(id: string): id is TopicId {
	return (TOPIC_IDS as readonly string[]).includes(id);
}
