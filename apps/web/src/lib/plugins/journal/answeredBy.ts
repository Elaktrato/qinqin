/** "Answered by gpt-6-luna · OpenAI (fallback)": who wrote a review or the ideas. */
export function answeredBy(model: string, providerName?: string, fallbackFrom?: string): string {
	const who = providerName ? `${model} · ${providerName}` : model;
	return `Answered by ${who}${fallbackFrom ? ' (fallback)' : ''}`;
}
