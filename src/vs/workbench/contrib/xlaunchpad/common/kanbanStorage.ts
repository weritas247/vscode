/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ─── Domain Model (camelCase, used by UI) ───────────────────

export interface IKanbanCard {
	id: string;
	ticketId: string;
	title: string;
	description: string;
	category: KanbanCategory;
	column: KanbanColumn;
	order: number;
	aiDone: boolean;
	useWorktree: boolean;
	useHeadless: boolean;
	aiSessions: IAiSessionEntry[];
	project: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface IKanbanLog {
	id: string;
	cardId: string;
	type: KanbanLogType;
	content: string;
	commitHash: string | null;
	createdAt: string;
}

export interface IAiSessionEntry {
	sessionId: string;
	ai: string;
	mode?: string;
	ts: number;
}

// ─── Supabase Row Types (snake_case, match DB columns) ──────

export interface IKanbanPlanRow {
	id: string;
	user_id: number;
	title: string;
	content: string;
	category: string;
	status: string;
	ticket_id: string | null;
	ai_done: boolean;
	use_worktree: boolean;
	use_headless: boolean;
	ai_sessions: IAiSessionEntry[];
	project: string | null;
	created_at: string;
	updated_at: string;
}

export interface IKanbanPlanLogRow {
	id: number;
	plan_id: string;
	type: string;
	content: string;
	commit_hash: string | null;
	created_at: string;
}

// ─── File Storage Types ─────────────────────────────────────

export interface IKanbanBoard {
	readonly version: 1;
	cards: IKanbanCard[];
	activityLog: IKanbanLog[];
	nextTicketNumber: number;
}

// ─── Enums & Labels ─────────────────────────────────────────

export type KanbanColumn = 'todo' | 'doing' | 'done' | 'onhold' | 'cancelled';
export type KanbanCategory = 'feature' | 'bug' | 'other';
export type KanbanLogType = 'commit' | 'summary' | 'action';

export const KanbanColumnLabels: Record<KanbanColumn, string> = {
	todo: 'TODO',
	doing: 'DOING',
	done: 'DONE',
	onhold: 'ON HOLD',
	cancelled: 'CANCELLED',
};

export const KanbanCategoryLabels: Record<KanbanCategory, string> = {
	feature: '기능',
	bug: '버그',
	other: '기타',
};

// ─── Configuration ──────────────────────────────────────────

export interface IKanbanSupabaseConfig {
	url: string;
	anonKey: string;
	userId: number;
}

// ─── Data Provider Interface ────────────────────────────────

export interface IKanbanDataProvider {
	load(): Promise<void>;
	getCards(): IKanbanCard[];
	getCardById(id: string): IKanbanCard | undefined;
	getCardsByColumn(column: KanbanColumn): IKanbanCard[];
	getCardsByCategory(category: KanbanCategory): IKanbanCard[];
	getFilteredCardsByColumn(column: KanbanColumn, category: KanbanCategory | 'all'): IKanbanCard[];
	getColumnCounts(category?: KanbanCategory | 'all'): Record<KanbanColumn, number>;
	getCategoryCounts(): Record<KanbanCategory | 'all', number>;
	addCard(title: string, category: KanbanCategory): IKanbanCard;
	updateCard(id: string, updates: Partial<Pick<IKanbanCard, 'title' | 'description' | 'category' | 'column' | 'order'>>): void;
	moveCard(id: string, toColumn: KanbanColumn, toOrder: number): void;
	deleteCard(id: string): void;
	getActivityLog(): IKanbanLog[];
}

// ─── Helpers ────────────────────────────────────────────────

export function createEmptyBoard(): IKanbanBoard {
	return { version: 1, cards: [], activityLog: [], nextTicketNumber: 1 };
}

export function createDefaultCard(): Partial<IKanbanCard> {
	return {
		aiDone: false,
		useWorktree: false,
		useHeadless: false,
		aiSessions: [],
		project: null,
	};
}

// ─── Row ↔ Domain Conversion ────────────────────────────────

/** DB status → UI column: on_hold ↔ onhold */
function dbStatusToColumn(status: string): KanbanColumn {
	if (status === 'on_hold') {
		return 'onhold';
	}
	return (status || 'todo') as KanbanColumn;
}

/** UI column → DB status: onhold ↔ on_hold */
export function columnToDbStatus(column: KanbanColumn): string {
	if (column === 'onhold') {
		return 'on_hold';
	}
	return column;
}

export function planRowToCard(row: IKanbanPlanRow, order: number = 0): IKanbanCard {
	return {
		id: row.id,
		ticketId: row.ticket_id || '',
		title: row.title,
		description: row.content,
		category: (row.category || 'other') as KanbanCategory,
		column: dbStatusToColumn(row.status),
		order,
		aiDone: row.ai_done ?? false,
		useWorktree: row.use_worktree ?? false,
		useHeadless: row.use_headless ?? false,
		aiSessions: row.ai_sessions || [],
		project: row.project,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export function cardToPlanRow(card: IKanbanCard, userId: number): Partial<IKanbanPlanRow> {
	return {
		id: card.id,
		user_id: userId,
		title: card.title,
		content: card.description,
		category: card.category,
		status: columnToDbStatus(card.column),
		ticket_id: card.ticketId || null,
		ai_done: card.aiDone,
		use_worktree: card.useWorktree,
		use_headless: card.useHeadless,
		ai_sessions: card.aiSessions,
		project: card.project,
	};
}

export function planLogRowToLog(row: IKanbanPlanLogRow): IKanbanLog {
	return {
		id: String(row.id),
		cardId: row.plan_id,
		type: (row.type || 'action') as KanbanLogType,
		content: row.content,
		commitHash: row.commit_hash,
		createdAt: row.created_at,
	};
}
