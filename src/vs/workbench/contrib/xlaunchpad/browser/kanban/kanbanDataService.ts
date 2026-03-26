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
import { IKanbanBoard, IKanbanCard, IKanbanActivityLog, KanbanColumn, KanbanCategory, createEmptyBoard } from '../../common/kanbanStorage.js';
import { Emitter, Event } from '../../../../../base/common/event.js';

export class KanbanDataService extends Disposable {

	private board: IKanbanBoard = createEmptyBoard();
	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly saveScheduler: RunOnceScheduler;
	private fileUri: URI | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceService: IWorkspaceContextService,
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
			// File doesn't exist yet — start with empty board
			this.board = createEmptyBoard();
		}
		this._onDidChange.fire();
	}

	private migrateBoard(parsed: IKanbanBoard): IKanbanBoard {
		// Ensure new fields exist for backward compatibility
		if (!Array.isArray(parsed.activityLog)) {
			parsed.activityLog = [];
		}
		if (typeof parsed.nextTicketNumber !== 'number') {
			parsed.nextTicketNumber = 1;
		}

		// Assign ticketIds to cards that don't have one
		for (const card of parsed.cards) {
			if (!card.ticketId) {
				card.ticketId = `XL-${String(parsed.nextTicketNumber).padStart(4, '0')}`;
				parsed.nextTicketNumber++;
			}
		}

		return parsed;
	}

	getCards(): IKanbanCard[] {
		return this.board.cards;
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

	getCardById(id: string): IKanbanCard | undefined {
		return this.board.cards.find(c => c.id === id);
	}

	getActivityLog(): IKanbanActivityLog[] {
		return this.board.activityLog.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
			createdAt: now,
			updatedAt: now,
		};
		this.board.cards.push(card);
		this.addActivityLog(card.id, `Created card "${title}" (${ticketId})`);
		this.scheduleSave();
		this._onDidChange.fire();
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
				this.addActivityLog(card.id, `Updated ${card.ticketId}: ${changes.join(', ')}`);
			}
		}

		this.scheduleSave();
		this._onDidChange.fire();
	}

	moveCard(id: string, toColumn: KanbanColumn, toOrder: number): void {
		const card = this.board.cards.find(c => c.id === id);
		if (!card) {
			return;
		}

		const oldColumn = card.column;

		// Reorder cards in target column
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
			this.addActivityLog(card.id, `Moved ${card.ticketId} from ${oldColumn.toUpperCase()} to ${toColumn.toUpperCase()}`);
		}

		this.scheduleSave();
		this._onDidChange.fire();
	}

	deleteCard(id: string): void {
		const card = this.board.cards.find(c => c.id === id);
		if (card) {
			this.addActivityLog(card.id, `Deleted card "${card.title}" (${card.ticketId})`);
		}
		this.board.cards = this.board.cards.filter(c => c.id !== id);
		this.scheduleSave();
		this._onDidChange.fire();
	}

	private addActivityLog(cardId: string, message: string): void {
		this.board.activityLog.push({
			id: this.generateId(),
			cardId,
			message,
			timestamp: new Date().toISOString(),
		});
		// Keep only the last 100 log entries
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
