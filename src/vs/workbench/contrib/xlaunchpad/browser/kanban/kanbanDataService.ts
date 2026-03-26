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
import { IKanbanBoard, IKanbanCard, KanbanColumn, KanbanCategory, createEmptyBoard } from '../../common/kanbanStorage.js';
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
				this.board = parsed;
			} else {
				this.board = createEmptyBoard();
			}
		} catch {
			// File doesn't exist yet — start with empty board
			this.board = createEmptyBoard();
		}
		this._onDidChange.fire();
	}

	getCards(): IKanbanCard[] {
		return this.board.cards;
	}

	getCardsByColumn(column: KanbanColumn): IKanbanCard[] {
		return this.board.cards
			.filter(c => c.column === column)
			.sort((a, b) => a.order - b.order);
	}

	getColumnCounts(): Record<KanbanColumn, number> {
		const counts: Record<string, number> = { todo: 0, doing: 0, done: 0, onhold: 0, cancelled: 0 };
		for (const card of this.board.cards) {
			counts[card.column] = (counts[card.column] || 0) + 1;
		}
		return counts as Record<KanbanColumn, number>;
	}

	addCard(title: string, category: KanbanCategory = 'other'): IKanbanCard {
		const now = new Date().toISOString();
		const card: IKanbanCard = {
			id: this.generateId(),
			title,
			description: '',
			category,
			column: 'todo',
			order: this.board.cards.filter(c => c.column === 'todo').length,
			createdAt: now,
			updatedAt: now,
		};
		this.board.cards.push(card);
		this.scheduleSave();
		this._onDidChange.fire();
		return card;
	}

	updateCard(id: string, updates: Partial<Pick<IKanbanCard, 'title' | 'description' | 'category' | 'column' | 'order'>>): void {
		const card = this.board.cards.find(c => c.id === id);
		if (!card) {
			return;
		}
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
		this.scheduleSave();
		this._onDidChange.fire();
	}

	moveCard(id: string, toColumn: KanbanColumn, toOrder: number): void {
		const card = this.board.cards.find(c => c.id === id);
		if (!card) {
			return;
		}

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

		this.scheduleSave();
		this._onDidChange.fire();
	}

	deleteCard(id: string): void {
		this.board.cards = this.board.cards.filter(c => c.id !== id);
		this.scheduleSave();
		this._onDidChange.fire();
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
