import { describe, expect, it } from 'vitest';
import { answeredBy } from './answeredBy';

describe('answeredBy', () => {
	it('names the model and the provider', () => {
		expect(answeredBy('gpt-6-luna', 'OpenAI')).toBe('Answered by gpt-6-luna · OpenAI');
	});
	it('keeps the fallback suffix', () => {
		expect(answeredBy('claude-opus-5', 'Anthropic', 'claude-opus-5-5')).toBe(
			'Answered by claude-opus-5 · Anthropic (fallback)'
		);
		expect(answeredBy('claude-opus-5', undefined, 'claude-opus-5-5')).toBe('Answered by claude-opus-5 (fallback)');
	});
	it('works for reviews written before providers were recorded', () => {
		expect(answeredBy('claude-opus-5-5')).toBe('Answered by claude-opus-5-5');
	});
});
