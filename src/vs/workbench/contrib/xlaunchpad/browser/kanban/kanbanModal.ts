/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './kanbanModal.css';
import { $, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import { XLaunchpadModalId } from '../../common/xlaunchpad.js';
import { IKanbanCard, KanbanColumn, KanbanCategory, KanbanColumnLabels, KanbanCategoryLabels } from '../../common/kanbanStorage.js';
import { KanbanDataService } from './kanbanDataService.js';

const ALL_COLUMNS: KanbanColumn[] = ['todo', 'doing', 'done', 'onhold', 'cancelled'];

export class KanbanModal extends XLaunchpadModal {

	private dataService: KanbanDataService;
	private activeCardId: string | undefined;
	private loaded = false;

	constructor(
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(
			XLaunchpadModalId.Kanban,
			'Kanban Board',
			940, 640,
			400, 300,
			layoutService,
			storageService,
		);
		this.dataService = this._register(instantiationService.createInstance(KanbanDataService));
	}

	override show(): void {
		if (!this.loaded) {
			this.loaded = true;
			this.dataService.load();
		}
		super.show();
	}

	protected getTabs(): IXLaunchpadTab[] {
		return [
			{ id: 'board', label: 'Board' },
			{ id: 'list', label: 'List' },
		];
	}

	protected renderTabContent(tabId: string, container: HTMLElement): void {
		if (tabId === 'board') {
			this.renderBoard(container);
		} else if (tabId === 'list') {
			this.renderList(container);
		}
	}

	protected onTabChanged(_tabId: string): void {
		// Re-rendered by switchTab in base class
	}

	// ─── Board View ─────────────────────────────────────

	private renderBoard(container: HTMLElement): void {
		const board = container.appendChild($('.kanban-board'));
		board.style.height = '100%';

		for (const column of ALL_COLUMNS) {
			const cards = this.dataService.getCardsByColumn(column);
			this.renderColumn(board, column, cards);
		}
	}

	private renderColumn(parent: HTMLElement, column: KanbanColumn, cards: IKanbanCard[]): void {
		const col = parent.appendChild($('.kanban-column'));

		// Header
		const header = col.appendChild($('.kanban-column-header'));
		const label = header.appendChild($('span'));
		label.textContent = KanbanColumnLabels[column];
		const count = header.appendChild($('.kanban-column-count'));
		count.textContent = String(cards.length);

		// Body (drop zone)
		const body = col.appendChild($('.kanban-column-body'));
		body.dataset.column = column;

		// Drag-over events
		body.addEventListener('dragover', (e) => {
			e.preventDefault();
			e.dataTransfer!.dropEffect = 'move';
			body.classList.add('drag-over');
		});
		body.addEventListener('dragleave', () => {
			body.classList.remove('drag-over');
		});
		body.addEventListener('drop', (e) => {
			e.preventDefault();
			body.classList.remove('drag-over');
			const cardId = e.dataTransfer!.getData('text/plain');
			if (cardId) {
				const cardEls = body.querySelectorAll('.kanban-card');
				this.dataService.moveCard(cardId, column, cardEls.length);
				this.refreshBoard(parent.parentElement!);
			}
		});

		// Cards
		for (const card of cards) {
			this.renderCard(body, card);
		}

		// Add button (only for todo)
		if (column === 'todo') {
			const addBtn = col.appendChild($('.kanban-add-btn'));
			addBtn.textContent = '+ Add Card';
			addBtn.addEventListener('click', () => {
				this.dataService.addCard('New Task');
				this.refreshBoard(parent.parentElement!);
			});
		}
	}

	private renderCard(parent: HTMLElement, card: IKanbanCard): void {
		const el = parent.appendChild($('.kanban-card'));
		el.draggable = true;
		el.dataset.cardId = card.id;

		// Drag events
		el.addEventListener('dragstart', (e) => {
			e.dataTransfer!.setData('text/plain', card.id);
			e.dataTransfer!.effectAllowed = 'move';
			el.classList.add('dragging');
		});
		el.addEventListener('dragend', () => {
			el.classList.remove('dragging');
		});

		// Title
		const title = el.appendChild($('.kanban-card-title'));
		title.textContent = card.title;

		// Description preview
		if (card.description) {
			const preview = el.appendChild($('.kanban-card-preview'));
			preview.textContent = card.description.substring(0, 60);
		}

		// Meta row
		const meta = el.appendChild($('.kanban-card-meta'));
		const catBadge = meta.appendChild($('.kanban-card-category'));
		catBadge.classList.add(card.category);
		catBadge.textContent = KanbanCategoryLabels[card.category];

		// Delete button
		const delBtn = meta.appendChild($('.kanban-card-delete'));
		delBtn.textContent = '\u00D7'; // ×
		delBtn.title = 'Delete card';
		delBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			this.dataService.deleteCard(card.id);
			this.refreshBoard(parent.parentElement!.parentElement!);
		});
	}

	private refreshBoard(container: HTMLElement): void {
		container.innerHTML = '';
		this.renderBoard(container);
	}

	// ─── List View ──────────────────────────────────────

	private renderList(container: HTMLElement): void {
		const list = container.appendChild($('.kanban-list'));
		list.style.height = '100%';

		// Left: card list
		const left = list.appendChild($('.kanban-list-left'));

		const header = left.appendChild($('.kanban-list-header'));
		const headerTitle = header.appendChild($('span'));
		headerTitle.textContent = 'Cards';
		headerTitle.style.flex = '1';
		headerTitle.style.fontWeight = '600';
		headerTitle.style.fontSize = '12px';

		const addBtn = header.appendChild($('.kanban-list-add'));
		addBtn.textContent = '+';
		addBtn.title = 'Add Card';
		addBtn.addEventListener('click', () => {
			const card = this.dataService.addCard('New Task');
			this.activeCardId = card.id;
			this.refreshList(container);
		});

		const items = left.appendChild($('.kanban-list-items'));

		// Right: editor
		const right = list.appendChild($('.kanban-list-right'));

		// Render card list
		const cards = this.dataService.getCards();
		if (cards.length === 0) {
			const empty = items.appendChild($('div'));
			empty.style.padding = '24px';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--vscode-descriptionForeground)';
			empty.textContent = 'No cards yet. Click + to add one.';
		}

		for (const card of cards) {
			const item = items.appendChild($('.kanban-list-item'));
			if (card.id === this.activeCardId) {
				item.classList.add('active');
			}

			const catDot = item.appendChild($('.kanban-card-category'));
			catDot.classList.add(card.category);
			catDot.textContent = KanbanCategoryLabels[card.category];
			catDot.style.fontSize = '9px';

			const title = item.appendChild($('.kanban-list-item-title'));
			title.textContent = card.title || '(untitled)';

			const status = item.appendChild($('.kanban-list-item-status'));
			status.textContent = KanbanColumnLabels[card.column];

			item.addEventListener('click', () => {
				this.activeCardId = card.id;
				// Update active state
				items.querySelectorAll('.kanban-list-item').forEach(el => el.classList.remove('active'));
				item.classList.add('active');
				// Render editor
				this.renderEditor(right, card);
			});
		}

		// Show editor for active card
		const activeCard = cards.find(c => c.id === this.activeCardId);
		if (activeCard) {
			this.renderEditor(right, activeCard);
		} else {
			right.appendChild($('.kanban-editor-empty')).textContent = 'Select a card to edit';
		}
	}

	private renderEditor(container: HTMLElement, card: IKanbanCard): void {
		container.innerHTML = '';

		// Title
		const titleField = container.appendChild($('.kanban-editor-field'));
		titleField.appendChild($('.kanban-editor-label')).textContent = 'Title';
		const titleInput = titleField.appendChild($('input.kanban-editor-input')) as HTMLInputElement;
		titleInput.value = card.title;
		titleInput.addEventListener('input', () => {
			this.dataService.updateCard(card.id, { title: titleInput.value });
		});

		// Row: Column + Category
		const row = container.appendChild($('.kanban-editor-row'));

		// Column select
		const colField = row.appendChild($('.kanban-editor-field'));
		colField.appendChild($('.kanban-editor-label')).textContent = 'Status';
		const colSelect = colField.appendChild($('select.kanban-editor-select')) as HTMLSelectElement;
		for (const col of ALL_COLUMNS) {
			const opt = colSelect.appendChild($('option')) as HTMLOptionElement;
			opt.value = col;
			opt.textContent = KanbanColumnLabels[col];
			if (col === card.column) {
				opt.selected = true;
			}
		}
		colSelect.addEventListener('change', () => {
			this.dataService.updateCard(card.id, { column: colSelect.value as KanbanColumn });
		});

		// Category select
		const catField = row.appendChild($('.kanban-editor-field'));
		catField.appendChild($('.kanban-editor-label')).textContent = 'Category';
		const catSelect = catField.appendChild($('select.kanban-editor-select')) as HTMLSelectElement;
		for (const cat of ['feature', 'bug', 'other'] as KanbanCategory[]) {
			const opt = catSelect.appendChild($('option')) as HTMLOptionElement;
			opt.value = cat;
			opt.textContent = KanbanCategoryLabels[cat];
			if (cat === card.category) {
				opt.selected = true;
			}
		}
		catSelect.addEventListener('change', () => {
			this.dataService.updateCard(card.id, { category: catSelect.value as KanbanCategory });
		});

		// Description
		const descField = container.appendChild($('.kanban-editor-field'));
		descField.appendChild($('.kanban-editor-label')).textContent = 'Description';
		const descInput = descField.appendChild($('textarea.kanban-editor-textarea')) as HTMLTextAreaElement;
		descInput.value = card.description;
		descInput.addEventListener('input', () => {
			this.dataService.updateCard(card.id, { description: descInput.value });
		});

		// Delete button
		const deleteBtn = container.appendChild($('button.kanban-add-btn'));
		deleteBtn.textContent = 'Delete Card';
		deleteBtn.style.color = 'var(--vscode-errorForeground)';
		deleteBtn.style.borderColor = 'var(--vscode-errorForeground)';
		deleteBtn.addEventListener('click', () => {
			this.dataService.deleteCard(card.id);
			this.activeCardId = undefined;
			this.refreshList(container.parentElement!);
		});
	}

	private refreshList(container: HTMLElement): void {
		container.innerHTML = '';
		this.renderList(container);
	}
}
