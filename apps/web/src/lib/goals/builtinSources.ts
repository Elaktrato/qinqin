// The activity sources in the shape the activity route lists them: the
// fallback choices for Settings when the route cannot be reached (offline).
import { ACTIVITY_SOURCES } from '../activity/sources';
import type { ActivitySource } from '../api/stats';

export const BUILTIN_SOURCES: readonly ActivitySource[] = ACTIVITY_SOURCES;
