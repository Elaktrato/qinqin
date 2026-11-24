// Mirrors the conversation documents of the server (journal/conversation.go,
// docs/contracts/journal/conversations.json).
import type { Annotation } from '../types';

export type Level = 'beginner' | 'elementary' | 'intermediate' | 'advanced';

export interface Message {
	seq: number;
	role: 'learner' | 'partner';
	text: string;
	/** The corrections of a learner message; a partner message has none. */
	annotations: Annotation[];
	/** Who wrote a partner message. */
	model?: string;
	provider?: string;
	/** The client's id of the turn that wrote it (both messages of a turn). */
	turnId: string;
	createdAt: string;
}

export interface Conversation {
	id: string;
	topic: string;
	level: Level;
	createdAt: string;
	updatedAt: string;
	messages: Message[];
}

export interface ConversationSummary {
	id: string;
	topic: string;
	level: Level;
	messageCount: number;
	createdAt: string;
	updatedAt: string;
}
