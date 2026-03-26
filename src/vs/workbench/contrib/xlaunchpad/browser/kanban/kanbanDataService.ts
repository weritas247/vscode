/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import {
	IKanbanBoard, IKanbanCard, IKanbanLog, IKanbanDataProvider,
	KanbanColumn, KanbanCategory,
	IKanbanSupabaseConfig, columnToDbStatus,
	createEmptyBoard, createDefaultCard,
	planRowToCard, planLogRowToLog,
} from '../../common/kanbanStorage.js';
import { KanbanSupabaseClient } from './kanbanSupabaseClient.js';
import { Emitter, Event } from '../../../../../base/common/event.js';

/**
 * Kanban data service with dual backend:
 * - Supabase (when configured) — same structure as x-launchpad
 * - File-based (.vscode/kanban.json) — fallback
 */
export class KanbanDataService extends Disposable {

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private provider: IKanbanDataProvider | undefined;
	private readonly workspaceService: IWorkspaceContextService;
	private readonly fileService: IFileService;
	private readonly productService: IProductService;

	constructor(
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceService: IWorkspaceContextService,
		@IProductService productService: IProductService,
	) {
		super();
		this.fileService = fileService;
		this.workspaceService = workspaceService;
		this.productService = productService;
	}

	async load(): Promise<void> {
		// Try Supabase first, fall back to file
		const config = this.loadSupabaseConfig();
		if (config) {
			console.log('[kanban] Supabase config found:', config.url, 'userId:', config.userId);
			const client = new KanbanSupabaseClient(config);
			this.provider = new SupabaseProvider(client);
		} else {
			console.log('[kanban] No Supabase config — using file provider');
			this.provider = this._register(new FileProvider(this.fileService, this.workspaceService));
		}
		try {
			await this.provider.load();
			console.log('[kanban] Loaded', this.provider.getCards().length, 'cards');
		} catch (e) {
			console.error('[kanban] Load failed:', e);
		}
		this._onDidChange.fire();
	}

	private loadSupabaseConfig(): IKanbanSupabaseConfig | undefined {
		const xlp = (this.productService as unknown as Record<string, unknown>)['xLaunchpad'] as Record<string, unknown> | undefined;
		if (xlp && xlp.supabaseUrl && xlp.supabaseAnonKey) {
			console.log('[kanban] Supabase config from product.json');
			return {
				url: xlp.supabaseUrl as string,
				anonKey: xlp.supabaseAnonKey as string,
				userId: (xlp.userId as number) ?? 1,
			};
		}
		console.log('[kanban] No xLaunchpad config in product.json');
		return undefined;
	}

	// ─── Delegated Methods ──────────────────────────────

	getCards(): IKanbanCard[] {
		return this.provider?.getCards() ?? [];
	}

	getCardById(id: string): IKanbanCard | undefined {
		return this.provider?.getCardById(id);
	}

	getCardsByColumn(column: KanbanColumn): IKanbanCard[] {
		return this.provider?.getCardsByColumn(column) ?? [];
	}

	getCardsByCategory(category: KanbanCategory): IKanbanCard[] {
		return this.provider?.getCardsByCategory(category) ?? [];
	}

	getFilteredCardsByColumn(column: KanbanColumn, category: KanbanCategory | 'all'): IKanbanCard[] {
		return this.provider?.getFilteredCardsByColumn(column, category) ?? [];
	}

	getColumnCounts(category: KanbanCategory | 'all' = 'all'): Record<KanbanColumn, number> {
		return this.provider?.getColumnCounts(category) ?? { todo: 0, doing: 0, done: 0, onhold: 0, cancelled: 0 };
	}

	getCategoryCounts(): Record<KanbanCategory | 'all', number> {
		return this.provider?.getCategoryCounts() ?? { all: 0, feature: 0, bug: 0, other: 0 };
	}

	addCard(title: string, category: KanbanCategory = 'feature'): IKanbanCard {
		const card = this.provider!.addCard(title, category);
		this._onDidChange.fire();
		return card;
	}

	updateCard(id: string, updates: Partial<Pick<IKanbanCard, 'title' | 'description' | 'category' | 'column' | 'order'>>): void {
		this.provider?.updateCard(id, updates);
		this._onDidChange.fire();
	}

	moveCard(id: string, toColumn: KanbanColumn, toOrder: number): void {
		this.provider?.moveCard(id, toColumn, toOrder);
		this._onDidChange.fire();
	}

	deleteCard(id: string): void {
		this.provider?.deleteCard(id);
		this._onDidChange.fire();
	}

	getActivityLog(): IKanbanLog[] {
		return this.provider?.getActivityLog() ?? [];
	}
}


// ═══════════════════════════════════════════════════════════════
// File-based Provider — stores data in .vscode/kanban.json
// ═══════════════════════════════════════════════════════════════

class FileProvider extends Disposable implements IKanbanDataProvider {

	private board: IKanbanBoard = createEmptyBoard();
	private readonly saveScheduler: RunOnceScheduler;
	private fileUri: URI | undefined;

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceService: IWorkspaceContextService,
	) {
		super();
		this.saveScheduler = this._register(new RunOnceScheduler(() => this.doSave(), 300));
		this.resolveFileUri();
	}

	private resolveFileUri(): void {
		const folders = this.workspaceService.getWorkspace().folders;
		if (folders.length > 0) {
			this.fileUri = URI.joinPath(folders[0].uri, '.vscode', 'kanban.json');
		}
	}

	async load(): Promise<void> {
		if (!this.fileUri) {
			this.board = createEmptyBoard();
			return;
		}
		try {
			const content = await this.fileService.readFile(this.fileUri);
			const text = new TextDecoder().decode(content.value.buffer);
			const parsed = JSON.parse(text);
			if (parsed.version === 1 && Array.isArray(parsed.cards)) {
				this.board = this.migrateBoard(parsed);
			} else {
				this.board = createEmptyBoard();
			}
		} catch {
			this.board = createEmptyBoard();
		}
	}

	private migrateBoard(parsed: IKanbanBoard): IKanbanBoard {
		if (!Array.isArray(parsed.activityLog)) {
			parsed.activityLog = [];
		}
		if (typeof parsed.nextTicketNumber !== 'number') {
			parsed.nextTicketNumber = 1;
		}
		// Migrate cards: add new fields with defaults
		const defaults = createDefaultCard();
		for (const card of parsed.cards) {
			if (!card.ticketId) {
				card.ticketId = `XL-${String(parsed.nextTicketNumber).padStart(4, '0')}`;
				parsed.nextTicketNumber++;
			}
			if (card.aiDone === undefined) {
				card.aiDone = defaults.aiDone!;
			}
			if (card.useWorktree === undefined) {
				card.useWorktree = defaults.useWorktree!;
			}
			if (card.useHeadless === undefined) {
				card.useHeadless = defaults.useHeadless!;
			}
			if (!Array.isArray(card.aiSessions)) {
				card.aiSessions = [];
			}
			if (card.project === undefined) {
				card.project = null;
			}
		}
		// Migrate logs: ensure type field exists
		for (const log of parsed.activityLog) {
			if (!(log as IKanbanLog).type) {
				(log as IKanbanLog).type = 'action';
			}
			if ((log as IKanbanLog).commitHash === undefined) {
				(log as IKanbanLog).commitHash = null;
			}
		}
		return parsed;
	}

	getCards(): IKanbanCard[] {
		return this.board.cards;
	}

	getCardById(id: string): IKanbanCard | undefined {
		return this.board.cards.find(c => c.id === id);
	}

	getCardsByColumn(column: KanbanColumn): IKanbanCard[] {
		return this.board.cards
			.filter(c => c.column === column)
			.sort((a, b) => a.order - b.order);
	}

	getCardsByCategory(category: KanbanCategory): IKanbanCard[] {
		return this.board.cards.filter(c => c.category === category);
	}

	getFilteredCardsByColumn(column: KanbanColumn, category: KanbanCategory | 'all'): IKanbanCard[] {
		return this.board.cards
			.filter(c => c.column === column && (category === 'all' || c.category === category))
			.sort((a, b) => a.order - b.order);
	}

	getColumnCounts(category: KanbanCategory | 'all' = 'all'): Record<KanbanColumn, number> {
		const counts: Record<string, number> = { todo: 0, doing: 0, done: 0, onhold: 0, cancelled: 0 };
		for (const card of this.board.cards) {
			if (category === 'all' || card.category === category) {
				counts[card.column] = (counts[card.column] || 0) + 1;
			}
		}
		return counts as Record<KanbanColumn, number>;
	}

	getCategoryCounts(): Record<KanbanCategory | 'all', number> {
		const counts = { all: this.board.cards.length, feature: 0, bug: 0, other: 0 };
		for (const card of this.board.cards) {
			counts[card.category] = (counts[card.category] || 0) + 1;
		}
		return counts;
	}

	addCard(title: string, category: KanbanCategory = 'feature'): IKanbanCard {
		const now = new Date().toISOString();
		const ticketId = `XL-${String(this.board.nextTicketNumber).padStart(4, '0')}`;
		this.board.nextTicketNumber++;

		const card: IKanbanCard = {
			id: this.generateId(),
			ticketId,
			title,
			description: '',
			category,
			column: 'todo',
			order: this.board.cards.filter(c => c.column === 'todo').length,
			...createDefaultCard() as Pick<IKanbanCard, 'aiDone' | 'useWorktree' | 'useHeadless' | 'aiSessions' | 'project'>,
			createdAt: now,
			updatedAt: now,
		};
		this.board.cards.push(card);
		this.addLog(card.id, 'action', `Created card "${title}" (${ticketId})`);
		this.scheduleSave();
		return card;
	}

	updateCard(id: string, updates: Partial<Pick<IKanbanCard, 'title' | 'description' | 'category' | 'column' | 'order'>>): void {
		const card = this.board.cards.find(c => c.id === id);
		if (!card) {
			return;
		}
		const changes: string[] = [];
		if (updates.title !== undefined && updates.title !== card.title) {
			card.title = updates.title;
			changes.push('title');
		}
		if (updates.description !== undefined && updates.description !== card.description) {
			card.description = updates.description;
			changes.push('description');
		}
		if (updates.category !== undefined && updates.category !== card.category) {
			card.category = updates.category;
			changes.push('category');
		}
		if (updates.column !== undefined && updates.column !== card.column) {
			const oldColumn = card.column;
			card.column = updates.column;
			changes.push(`status: ${oldColumn} → ${updates.column}`);
		}
		if (updates.order !== undefined) {
			card.order = updates.order;
		}
		if (changes.length > 0) {
			card.updatedAt = new Date().toISOString();
			if (changes.some(c => c !== 'description' && c !== 'title')) {
				this.addLog(card.id, 'action', `Updated ${card.ticketId}: ${changes.join(', ')}`);
			}
		}
		this.scheduleSave();
	}

	moveCard(id: string, toColumn: KanbanColumn, toOrder: number): void {
		const card = this.board.cards.find(c => c.id === id);
		if (!card) {
			return;
		}
		const oldColumn = card.column;
		const targetCards = this.board.cards
			.filter(c => c.column === toColumn && c.id !== id)
			.sort((a, b) => a.order - b.order);
		targetCards.splice(toOrder, 0, card);
		targetCards.forEach((c, i) => {
			c.order = i;
		});
		card.column = toColumn;
		card.order = toOrder;
		card.updatedAt = new Date().toISOString();
		if (oldColumn !== toColumn) {
			this.addLog(card.id, 'action', `Moved ${card.ticketId} from ${oldColumn.toUpperCase()} to ${toColumn.toUpperCase()}`);
		}
		this.scheduleSave();
	}

	deleteCard(id: string): void {
		const card = this.board.cards.find(c => c.id === id);
		if (card) {
			this.addLog(card.id, 'action', `Deleted card "${card.title}" (${card.ticketId})`);
		}
		this.board.cards = this.board.cards.filter(c => c.id !== id);
		this.scheduleSave();
	}

	getActivityLog(): IKanbanLog[] {
		return this.board.activityLog.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	private addLog(cardId: string, type: 'action' | 'commit' | 'summary', content: string): void {
		this.board.activityLog.push({
			id: this.generateId(),
			cardId,
			type,
			content,
			commitHash: null,
			createdAt: new Date().toISOString(),
		});
		if (this.board.activityLog.length > 100) {
			this.board.activityLog = this.board.activityLog.slice(-100);
		}
	}

	private scheduleSave(): void {
		this.saveScheduler.schedule();
	}

	private async doSave(): Promise<void> {
		if (!this.fileUri) {
			return;
		}
		try {
			const content = JSON.stringify(this.board, null, 2);
			await this.fileService.writeFile(this.fileUri, VSBuffer.fromString(content));
		} catch (e) {
			console.error('[kanban] Failed to save:', e);
		}
	}

	private generateId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
	}
}


// ═══════════════════════════════════════════════════════════════
// Supabase Provider — stores data in Supabase (same as x-launchpad)
// ═══════════════════════════════════════════════════════════════

class SupabaseProvider implements IKanbanDataProvider {

	private cards: IKanbanCard[] = [];
	private logs: IKanbanLog[] = [];

	constructor(
		private readonly client: KanbanSupabaseClient,
	) { }

	async load(): Promise<void> {
		try {
			console.log('[kanban:supabase] Fetching plans...');
			const rows = await this.client.getPlans();
			console.log('[kanban:supabase] Received', rows.length, 'rows');
			this.cards = rows.map((row, i) => planRowToCard(row, i));
		} catch (e) {
			console.error('[kanban:supabase] Failed to load plans:', e);
			this.cards = [];
		}
	}

	getCards(): IKanbanCard[] {
		return this.cards;
	}

	getCardById(id: string): IKanbanCard | undefined {
		return this.cards.find(c => c.id === id);
	}

	getCardsByColumn(column: KanbanColumn): IKanbanCard[] {
		return this.cards
			.filter(c => c.column === column)
			.sort((a, b) => a.order - b.order);
	}

	getCardsByCategory(category: KanbanCategory): IKanbanCard[] {
		return this.cards.filter(c => c.category === category);
	}

	getFilteredCardsByColumn(column: KanbanColumn, category: KanbanCategory | 'all'): IKanbanCard[] {
		return this.cards
			.filter(c => c.column === column && (category === 'all' || c.category === category))
			.sort((a, b) => a.order - b.order);
	}

	getColumnCounts(category: KanbanCategory | 'all' = 'all'): Record<KanbanColumn, number> {
		const counts: Record<string, number> = { todo: 0, doing: 0, done: 0, onhold: 0, cancelled: 0 };
		for (const card of this.cards) {
			if (category === 'all' || card.category === category) {
				counts[card.column] = (counts[card.column] || 0) + 1;
			}
		}
		return counts as Record<KanbanColumn, number>;
	}

	getCategoryCounts(): Record<KanbanCategory | 'all', number> {
		const counts = { all: this.cards.length, feature: 0, bug: 0, other: 0 };
		for (const card of this.cards) {
			counts[card.category] = (counts[card.category] || 0) + 1;
		}
		return counts;
	}

	addCard(title: string, category: KanbanCategory = 'feature'): IKanbanCard {
		const now = new Date().toISOString();
		const id = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

		// Optimistic local add (Supabase insert is async)
		const card: IKanbanCard = {
			id,
			ticketId: '',
			title,
			description: '',
			category,
			column: 'todo',
			order: this.cards.filter(c => c.column === 'todo').length,
			aiDone: false,
			useWorktree: false,
			useHeadless: false,
			aiSessions: [],
			project: null,
			createdAt: now,
			updatedAt: now,
		};
		this.cards.push(card);

		// Fire-and-forget Supabase insert, update local card with server response
		this.client.createPlan({
			id,
			title,
			content: '',
			category,
			status: 'todo',
		}).then(row => {
			const idx = this.cards.findIndex(c => c.id === id);
			if (idx >= 0) {
				this.cards[idx] = planRowToCard(row, card.order);
			}
		}).catch(e => {
			console.error('[kanban:supabase] Failed to create plan:', e);
		});

		return card;
	}

	updateCard(id: string, updates: Partial<Pick<IKanbanCard, 'title' | 'description' | 'category' | 'column' | 'order'>>): void {
		const card = this.cards.find(c => c.id === id);
		if (!card) {
			return;
		}

		// Optimistic local update
		if (updates.title !== undefined) {
			card.title = updates.title;
		}
		if (updates.description !== undefined) {
			card.description = updates.description;
		}
		if (updates.category !== undefined) {
			card.category = updates.category;
		}
		if (updates.column !== undefined) {
			card.column = updates.column;
		}
		if (updates.order !== undefined) {
			card.order = updates.order;
		}
		card.updatedAt = new Date().toISOString();

		// Map to Supabase fields
		const dbUpdates: Record<string, unknown> = {};
		if (updates.title !== undefined) {
			dbUpdates.title = updates.title;
		}
		if (updates.description !== undefined) {
			dbUpdates.content = updates.description;
		}
		if (updates.category !== undefined) {
			dbUpdates.category = updates.category;
		}
		if (updates.column !== undefined) {
			dbUpdates.status = columnToDbStatus(updates.column);
		}

		if (Object.keys(dbUpdates).length > 0) {
			this.client.updatePlan(id, dbUpdates).catch(e => {
				console.error('[kanban:supabase] Failed to update plan:', e);
			});
		}
	}

	moveCard(id: string, toColumn: KanbanColumn, toOrder: number): void {
		const card = this.cards.find(c => c.id === id);
		if (!card) {
			return;
		}

		const targetCards = this.cards
			.filter(c => c.column === toColumn && c.id !== id)
			.sort((a, b) => a.order - b.order);
		targetCards.splice(toOrder, 0, card);
		targetCards.forEach((c, i) => {
			c.order = i;
		});

		card.column = toColumn;
		card.order = toOrder;
		card.updatedAt = new Date().toISOString();

		this.client.updatePlanStatus(id, toColumn).catch(e => {
			console.error('[kanban:supabase] Failed to move plan:', e);
		});
	}

	deleteCard(id: string): void {
		this.cards = this.cards.filter(c => c.id !== id);
		this.client.deletePlan(id).catch(e => {
			console.error('[kanban:supabase] Failed to delete plan:', e);
		});
	}

	getActivityLog(): IKanbanLog[] {
		return this.logs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	}

	async loadLogsForCard(cardId: string): Promise<IKanbanLog[]> {
		try {
			const rows = await this.client.getPlanLogs(cardId);
			this.logs = rows.map(planLogRowToLog);
			return this.logs;
		} catch (e) {
			console.error('[kanban:supabase] Failed to load logs:', e);
			return [];
		}
	}
}
