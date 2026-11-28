// Mascot state is a pure function of level and streak; the assets are
// static SVGs named by stage and mood.

export type MascotMood = 'sleepy' | 'happy' | 'proud' | 'cheering';

export function mascotState(args: { level: number; streak: number; todayDone: boolean }): {
	stage: 1 | 2 | 3 | 4;
	mood: MascotMood;
	assetPath: string;
} {
	const { level, streak, todayDone } = args;
	const stage = level >= 20 ? 4 : level >= 10 ? 3 : level >= 5 ? 2 : 1;

	let mood: MascotMood = 'happy';
	if (!todayDone && streak > 0) mood = 'sleepy';
	else if (todayDone && streak >= 30) mood = 'cheering';
	else if (todayDone && streak >= 7) mood = 'proud';

	return { stage, mood, assetPath: `/mascot/${stage}-${mood}.svg` };
}
