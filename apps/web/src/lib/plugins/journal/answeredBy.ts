/** "Answered by gpt-6-luna · OpenAI (fallback)": who wrote a review or the ideas. */
import { t } from '$lib/i18n';

export function answeredBy(model: string, providerName?: string, fallbackFrom?: string): string {
	const who = providerName ? t('journal.modelOn', { model, provider: providerName }) : model;
	return fallbackFrom ? t('journal.answeredByFallback', { who }) : t('journal.answeredBy', { who });
}
