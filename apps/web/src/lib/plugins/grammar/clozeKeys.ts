/** choiceForKey maps the keys 1-5 to a choice index; anything else (or out of range) is null. */
export function choiceForKey(key: string, count: number): number | null {
	if (!/^[1-5]$/.test(key)) return null;
	const index = Number(key) - 1;
	return index < count ? index : null;
}
