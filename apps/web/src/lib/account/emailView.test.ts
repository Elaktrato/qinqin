import { describe, expect, it } from 'vitest';
import { emailSection } from './emailView';

describe('emailSection', () => {
	it('is hidden while the policy is off or unknown', () => {
		expect(emailSection('off', 'a@b.c').visible).toBe(false);
		expect(emailSection(null, null).visible).toBe(false);
		expect(emailSection('off', null).banner).toBe(false);
	});
	it('is optional and clearable under optional', () => {
		expect(emailSection('optional', 'a@b.c')).toMatchObject({ visible: true, canClear: true, label: 'Email (optional)', banner: false });
		expect(emailSection('optional', null).canClear).toBe(false);
	});
	it('is required, not clearable, and bannered when missing under required', () => {
		expect(emailSection('required', 'a@b.c')).toMatchObject({ visible: true, canClear: false, label: 'Email', banner: false });
		expect(emailSection('required', null).banner).toBe(true);
	});
});
