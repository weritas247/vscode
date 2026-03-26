/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './kanbanModal.css';
import { $, clearNode } from '../../../../../base/browser/dom.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { XLaunchpadModal, IXLaunchpadTab } from '../modal/xlaunchpadModal.js';
import { XLaunchpadModalId } from '../../common/xlaunchpad.js';
import { IKanbanCard, KanbanColumn, KanbanCategory, KanbanColumnLabels, KanbanCategoryLabels } from '../../common/kanbanStorage.js';
import { KanbanDataService } from './kanbanDataService.js';

const MAIN_COLUMNS: KanbanColumn[] = ['todo', 'doing', 'done'];
const SIDEBAR_COLUMNS: KanbanColumn[] = ['cancelled', 'onhold'];
const ALL_COLUMNS: KanbanColumn[] = ['todo', 'doing', 'done', 'onhold', 'cancelled'];

const AI_AGENTS = [
	{ id: 'claude', label: 'Claude', icon: '\uD83C\uDF38' },
	{ id: 'gemini', label: 'Gemini', icon: '\u2728' },
	{ id: 'codex', label: 'Codex', icon: '\uD83C\uDF00' },
	{ id: 'opencode', label: 'OpenCode', icon: '\u25AA' },
] as const;

export class KanbanModal extends XLaunchpadModal {

	private dataService: KanbanDataService;
	private loaded = false;
	private activeCategory: KanbanCategory | 'all' = 'all';
	private activeView: 'board' | 'list' = 'board';
	private selectedCardId: string | undefined;
	private rootContainer: HTMLElement | undefined;
	private detailOverlay: HTMLElement | undefined;
	private expandedSidebarColumns: Set<KanbanColumn> = new Set();
	private contextMenuEl: HTMLElement | undefined;

	constructor(
		@ILayoutService layoutService: ILayoutService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(
			XLaunchpadModalId.Kanban,
			'X-LAUNCHPAD',
			1200, 800,
			600, 400,
			false,
			layoutService,
			storageService,
		);
		this.dataService = this._register(instantiationService.createInstance(KanbanDataService));
		// Re-render when data arrives (Supabase async load)
		this._register(this.dataService.onDidChange(() => {
			if (this.getIsVisible()) {
				this.refresh();
			}
		}));
	}

	override show(): void {
		if (!this.loaded) {
			this.loaded = true;
			this.dataService.load();
		}
		super.show();
	}

	protected getTabs(): IXLaunchpadTab[] {
		return [{ id: 'main', label: 'Main' }];
	}

	protected renderTabContent(tabId: string, container: HTMLElement): void {
		this.rootContainer = container;
		this.renderMain(container);
	}

	protected onTabChanged(_tabId: string): void {
		// Single tab — no action needed
	}

	// ─── Main Layout ────────────────────────────────────

	private renderMain(container: HTMLElement): void {
		container.classList.add('kanban-root');
		this.renderFilterBar(container);

		const content = container.appendChild($('.kanban-content'));
		if (this.activeView === 'board') {
			this.renderBoard(content);
		} else {
			this.renderList(content);
		}
	}

	private refresh(): void {
		if (!this.rootContainer) {
			return;
		}
		clearNode(this.rootContainer);
		this.renderMain(this.rootContainer);
	}

	// ─── Filter Bar ─────────────────────────────────────

	private renderFilterBar(parent: HTMLElement): void {
		const bar = parent.appendChild($('.kanban-filter-bar'));

		// Category filters
		const filters = bar.appendChild($('.kanban-filters'));
		const counts = this.dataService.getCategoryCounts();

		const categories: Array<{ id: KanbanCategory | 'all'; label: string }> = [
			{ id: 'all', label: 'ALL' },
			{ id: 'feature', label: KanbanCategoryLabels.feature },
			{ id: 'bug', label: KanbanCategoryLabels.bug },
			{ id: 'other', label: KanbanCategoryLabels.other },
		];

		for (const cat of categories) {
			const btn = filters.appendChild($('.kanban-filter'));
			if (cat.id === this.activeCategory) {
				btn.classList.add('active');
			}

			const label = btn.appendChild($('span'));
			label.textContent = cat.label;

			const badge = btn.appendChild($('.kanban-filter-count'));
			badge.textContent = String(counts[cat.id]);

			btn.addEventListener('click', () => {
				this.activeCategory = cat.id;
				this.refresh();
			});
		}

		// Actions (same row as filters)
		const actions = filters.appendChild($('.kanban-actions'));

		// Progress bar under filters (full width)
		const progressBar = bar.appendChild($('.kanban-filter-progress'));
		const filteredTotal = counts[this.activeCategory];
		if (filteredTotal > 0) {
			const columnCounts = this.dataService.getColumnCounts(this.activeCategory);
			const donePercent = (columnCounts.done / filteredTotal) * 100;
			const doingPercent = (columnCounts.doing / filteredTotal) * 100;
			const todoPercent = (columnCounts.todo / filteredTotal) * 100;

			const doneBar = progressBar.appendChild($('.kanban-progress-segment.done'));
			doneBar.style.width = `${donePercent}%`;
			const doingBar = progressBar.appendChild($('.kanban-progress-segment.doing'));
			doingBar.style.width = `${doingPercent}%`;
			const todoBar = progressBar.appendChild($('.kanban-progress-segment.todo'));
			todoBar.style.width = `${todoPercent}%`;
		}

		const newBtn = actions.appendChild($('.kanban-new-btn'));
		newBtn.textContent = '+ New';
		newBtn.addEventListener('click', () => {
			const defaultCategory: KanbanCategory = this.activeCategory === 'all' ? 'feature' : this.activeCategory;
			const card = this.dataService.addCard('New Task', defaultCategory);
			this.selectedCardId = card.id;
			this.refresh();
		});

		const listBtn = actions.appendChild($('.kanban-view-toggle'));
		if (this.activeView === 'list') {
			listBtn.classList.add('active');
		}
		listBtn.textContent = '\u2630'; // ☰ trigram
		listBtn.title = 'List View';
		listBtn.addEventListener('click', () => {
			this.activeView = 'list';
			this.refresh();
		});

		const boardBtn = actions.appendChild($('.kanban-view-toggle'));
		if (this.activeView === 'board') {
			boardBtn.classList.add('active');
		}
		boardBtn.textContent = '\u25A6'; // ▦ square with grid
		boardBtn.title = 'Board View';
		boardBtn.addEventListener('click', () => {
			this.activeView = 'board';
			this.refresh();
		});
	}

	// ─── Board View ─────────────────────────────────────

	private renderBoard(container: HTMLElement): void {
		const board = container.appendChild($('.kanban-board'));

		// Main columns + expanded sidebar columns share the same flex container
		const mainArea = board.appendChild($('.kanban-board-main'));
		for (const column of MAIN_COLUMNS) {
			const cards = this.dataService.getFilteredCardsByColumn(column, this.activeCategory);
			this.renderColumn(mainArea, column, cards);
		}

		// Sidebar columns: expanded ones go into mainArea, collapsed ones into sidebar strip
		const collapsedColumns: KanbanColumn[] = [];
		for (const column of SIDEBAR_COLUMNS) {
			if (this.expandedSidebarColumns.has(column)) {
				const cards = this.dataService.getFilteredCardsByColumn(column, this.activeCategory);
				this.renderSidebarColumn(mainArea, column, cards);
			} else {
				collapsedColumns.push(column);
			}
		}

		if (collapsedColumns.length > 0) {
			const sidebar = board.appendChild($('.kanban-board-sidebar'));
			for (const column of collapsedColumns) {
				const cards = this.dataService.getFilteredCardsByColumn(column, this.activeCategory);
				this.renderSidebarColumn(sidebar, column, cards);
			}
		}
	}

	private renderColumn(parent: HTMLElement, column: KanbanColumn, cards: IKanbanCard[]): void {
		const col = parent.appendChild($('.kanban-column'));
		col.dataset.column = column;

		// Header
		const header = col.appendChild($('.kanban-column-header'));
		const label = header.appendChild($('span'));
		label.textContent = KanbanColumnLabels[column];
		const count = header.appendChild($('.kanban-column-count'));
		count.textContent = String(cards.length);

		// Body (drop zone)
		const body = col.appendChild($('.kanban-column-body'));
		body.dataset.column = column;

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
				this.refresh();
			}
		});

		// Cards
		if (cards.length === 0) {
			const empty = body.appendChild($('.kanban-column-empty'));
			empty.textContent = 'No cards';
		}
		for (const card of cards) {
			this.renderCard(body, card);
		}
	}

	private renderSidebarColumn(parent: HTMLElement, column: KanbanColumn, cards: IKanbanCard[]): void {
		const isExpanded = this.expandedSidebarColumns.has(column);

		if (isExpanded) {
			// Expanded: render as a full-size column (same as main columns)
			const col = parent.appendChild($('.kanban-column'));
			col.dataset.column = column;

			// Header with collapse button
			const header = col.appendChild($('.kanban-column-header'));
			const label = header.appendChild($('span'));
			label.textContent = KanbanColumnLabels[column];
			const count = header.appendChild($('.kanban-column-count'));
			count.textContent = String(cards.length);
			const collapseBtn = header.appendChild($('button.kanban-sidebar-toggle')) as HTMLButtonElement;
			collapseBtn.textContent = '\u00BB'; // »
			collapseBtn.title = 'Collapse';
			collapseBtn.type = 'button';
			collapseBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.expandedSidebarColumns.delete(column);
				this.refresh();
			});

			// Body (drop zone)
			const body = col.appendChild($('.kanban-column-body'));
			body.dataset.column = column;

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
					this.dataService.moveCard(cardId, column, cards.length);
					this.refresh();
				}
			});

			if (cards.length === 0) {
				const empty = body.appendChild($('.kanban-column-empty'));
				empty.textContent = 'No cards';
			}
			for (const card of cards) {
				this.renderCard(body, card);
			}
		} else {
			// Collapsed: thin vertical strip
			const col = parent.appendChild($('.kanban-sidebar-col'));
			col.dataset.column = column;

			// Drop zone
			col.addEventListener('dragover', (e) => {
				e.preventDefault();
				e.dataTransfer!.dropEffect = 'move';
				col.classList.add('drag-over');
			});
			col.addEventListener('dragleave', () => {
				col.classList.remove('drag-over');
			});
			col.addEventListener('drop', (e) => {
				e.preventDefault();
				col.classList.remove('drag-over');
				const cardId = e.dataTransfer!.getData('text/plain');
				if (cardId) {
					this.dataService.moveCard(cardId, column, cards.length);
					this.refresh();
				}
			});

			// Click to expand
			col.addEventListener('click', () => {
				this.expandedSidebarColumns.add(column);
				this.refresh();
			});

			const label = col.appendChild($('.kanban-sidebar-label'));
			label.textContent = KanbanColumnLabels[column];

			if (cards.length > 0) {
				const badge = col.appendChild($('.kanban-sidebar-count'));
				badge.textContent = String(cards.length);
			}
		}
	}

	private renderCard(parent: HTMLElement, card: IKanbanCard): void {
		const el = parent.appendChild($('.kanban-card'));
		el.draggable = true;
		el.dataset.cardId = card.id;
		el.dataset.category = card.category;
		if (card.id === this.selectedCardId) {
			el.classList.add('selected');
		}

		// Drag events
		el.addEventListener('dragstart', (e) => {
			e.dataTransfer!.setData('text/plain', card.id);
			e.dataTransfer!.effectAllowed = 'move';
			el.classList.add('dragging');
		});
		el.addEventListener('dragend', () => {
			el.classList.remove('dragging');
		});

		// Click to open detail modal
		el.addEventListener('click', () => {
			this.selectedCardId = card.id;
			this.showDetailModal(card);
		});

		// Right-click context menu
		el.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.showContextMenu(e.clientX, e.clientY, card);
		});

		// Ticket ID
		const ticketEl = el.appendChild($('.kanban-card-ticket'));
		ticketEl.textContent = card.ticketId;

		// Title
		const title = el.appendChild($('.kanban-card-title'));
		title.textContent = card.title;

		// Description preview
		if (card.description) {
			const preview = el.appendChild($('.kanban-card-preview'));
			preview.textContent = card.description.length > 60 ? card.description.substring(0, 60) + '\u2026' : card.description;
		}

		// Meta row
		const meta = el.appendChild($('.kanban-card-meta'));

		const catBadge = meta.appendChild($('.kanban-card-category'));
		catBadge.classList.add(card.category);
		catBadge.textContent = KanbanCategoryLabels[card.category];

		// AI session badges
		if (card.aiSessions && card.aiSessions.length > 0) {
			const uniqueAis = new Set(card.aiSessions.map(s => s.ai));
			for (const aiId of uniqueAis) {
				const agentDef = AI_AGENTS.find(a => a.id === aiId);
				if (agentDef) {
					const aiBadge = meta.appendChild($('.kanban-card-ai'));
					aiBadge.textContent = agentDef.icon;
					aiBadge.title = agentDef.label;
				}
			}
		}

		const timestamp = meta.appendChild($('.kanban-card-time'));
		timestamp.textContent = this.formatTimestamp(card.updatedAt);
	}

	// ─── List View ──────────────────────────────────────

	private renderList(container: HTMLElement): void {
		const list = container.appendChild($('.kanban-list'));

		// Left: card list
		const left = list.appendChild($('.kanban-list-left'));

		const header = left.appendChild($('.kanban-list-header'));
		const headerTitle = header.appendChild($('span'));
		headerTitle.textContent = 'Cards';
		headerTitle.style.flex = '1';
		headerTitle.style.fontWeight = '600';
		headerTitle.style.fontSize = '12px';

		const items = left.appendChild($('.kanban-list-items'));

		// Right: editor
		const right = list.appendChild($('.kanban-list-right'));

		// Render card list (filtered by active category)
		const cards = this.activeCategory === 'all'
			? this.dataService.getCards()
			: this.dataService.getCardsByCategory(this.activeCategory);

		if (cards.length === 0) {
			const empty = items.appendChild($('div'));
			empty.style.padding = '24px';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--vscode-descriptionForeground)';
			empty.textContent = 'No cards found.';
		}

		for (const card of cards) {
			const item = items.appendChild($('.kanban-list-item'));
			if (card.id === this.selectedCardId) {
				item.classList.add('active');
			}

			const ticketEl = item.appendChild($('.kanban-list-item-ticket'));
			ticketEl.textContent = card.ticketId;

			const catDot = item.appendChild($('.kanban-card-category'));
			catDot.classList.add(card.category);
			catDot.textContent = KanbanCategoryLabels[card.category];
			catDot.style.fontSize = '9px';

			const title = item.appendChild($('.kanban-list-item-title'));
			title.textContent = card.title || '(untitled)';

			const status = item.appendChild($('.kanban-list-item-status'));
			status.textContent = KanbanColumnLabels[card.column];

			item.addEventListener('click', () => {
				this.selectedCardId = card.id;
				items.querySelectorAll('.kanban-list-item').forEach(el => el.classList.remove('active'));
				item.classList.add('active');
				this.showDetailModal(card);
			});
		}

		// Show editor for active card
		const activeCard = cards.find(c => c.id === this.selectedCardId);
		if (activeCard) {
			this.renderEditor(right, activeCard);
		} else {
			right.appendChild($('.kanban-editor-empty')).textContent = 'Select a card to edit';
		}
	}

	private renderEditor(container: HTMLElement, card: IKanbanCard): void {
		clearNode(container);

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
		const deleteBtn = container.appendChild($('button.kanban-delete-btn'));
		deleteBtn.textContent = 'Delete Card';
		deleteBtn.addEventListener('click', () => {
			this.dataService.deleteCard(card.id);
			this.selectedCardId = undefined;
			this.refresh();
		});
	}

	// ─── Detail Modal ───────────────────────────────────

	private showDetailModal(card: IKanbanCard): void {
		this.hideDetailModal();

		const container = this.rootContainer?.closest('.xlaunchpad-overlay') as HTMLElement;
		if (!container) {
			return;
		}

		// Overlay
		const overlay = container.appendChild($('.kanban-detail-overlay'));
		this.detailOverlay = overlay;

		overlay.addEventListener('mousedown', (e) => {
			if (e.target === overlay) {
				this.hideDetailModal();
			}
		});

		// Modal box
		const modal = overlay.appendChild($('.kanban-detail-modal'));

		// Header
		const header = modal.appendChild($('.kanban-detail-header'));
		const ticketEl = header.appendChild($('.kanban-detail-ticket'));
		ticketEl.textContent = card.ticketId;
		const closeBtn = header.appendChild($('.kanban-detail-close'));
		closeBtn.textContent = '\u00D7';
		closeBtn.title = 'Close';
		closeBtn.addEventListener('click', () => this.hideDetailModal());

		// Title input
		const titleField = modal.appendChild($('.kanban-detail-field'));
		titleField.appendChild($('.kanban-detail-label')).textContent = 'Title';
		const titleInput = titleField.appendChild($('input.kanban-detail-input')) as HTMLInputElement;
		titleInput.value = card.title;
		titleInput.addEventListener('input', () => {
			this.dataService.updateCard(card.id, { title: titleInput.value });
		});

		// Description textarea
		const descField = modal.appendChild($('.kanban-detail-field'));
		descField.appendChild($('.kanban-detail-label')).textContent = 'Description';
		const descInput = descField.appendChild($('textarea.kanban-detail-textarea')) as HTMLTextAreaElement;
		descInput.value = card.description;
		descInput.placeholder = 'Add a description...';
		descInput.addEventListener('input', () => {
			this.dataService.updateCard(card.id, { description: descInput.value });
		});

		// Row: Category + Status
		const row = modal.appendChild($('.kanban-detail-row'));

		const catField = row.appendChild($('.kanban-detail-field'));
		catField.appendChild($('.kanban-detail-label')).textContent = 'Category';
		const catSelect = catField.appendChild($('select.kanban-detail-select')) as HTMLSelectElement;
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

		const colField = row.appendChild($('.kanban-detail-field'));
		colField.appendChild($('.kanban-detail-label')).textContent = 'Status';
		const colSelect = colField.appendChild($('select.kanban-detail-select')) as HTMLSelectElement;
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

		// Footer: timestamp + delete
		const footer = modal.appendChild($('.kanban-detail-footer'));

		const time = footer.appendChild($('.kanban-detail-time'));
		time.textContent = this.formatTimestamp(card.updatedAt);

		const deleteBtn = footer.appendChild($('button.kanban-detail-delete'));
		deleteBtn.textContent = '\uD83D\uDDD1 Delete';
		deleteBtn.addEventListener('click', () => {
			this.dataService.deleteCard(card.id);
			this.selectedCardId = undefined;
			this.hideDetailModal();
			this.refresh();
		});

		// Activity Log inside modal
		this.renderActivityLog(modal);

		// Keyboard: Escape to close
		overlay.tabIndex = -1;
		overlay.focus();
		overlay.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.hideDetailModal();
			}
		});

		// Animate in
		requestAnimationFrame(() => {
			overlay.classList.add('visible');
		});
	}

	// ─── Context Menu ───────────────────────────────

	private showContextMenu(x: number, y: number, card: IKanbanCard): void {
		this.hideContextMenu();

		const container = this.rootContainer?.closest('.xlaunchpad-modal') as HTMLElement;
		if (!container) {
			return;
		}

		const menu = container.appendChild($('.kanban-context-menu'));
		this.contextMenuEl = menu;

		// Position relative to the modal container
		const rect = container.getBoundingClientRect();
		let left = x - rect.left;
		let top = y - rect.top;

		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;

		// ── Edit ──
		this.addContextMenuItem(menu, '\u270F\uFE0F', '편집', () => {
			this.selectedCardId = card.id;
			this.showDetailModal(card);
		});

		menu.appendChild($('.kanban-context-separator'));

		// ── Status changes ──
		const statusItems: Array<{ column: KanbanColumn; icon: string }> = [
			{ column: 'todo', icon: '\uD83D\uDCCB' },
			{ column: 'doing', icon: '\u2692' },
			{ column: 'done', icon: '\u2705' },
			{ column: 'onhold', icon: '\u23F8' },
			{ column: 'cancelled', icon: '\u274C' },
		];

		for (const item of statusItems) {
			const menuItem = this.addContextMenuItem(menu, item.icon, KanbanColumnLabels[item.column], () => {
				this.dataService.moveCard(card.id, item.column, 0);
				this.refresh();
			});
			if (item.column === card.column) {
				menuItem.classList.add('active');
			}
		}

		menu.appendChild($('.kanban-context-separator'));

		// ── Delete ──
		this.addContextMenuItem(menu, '\uD83D\uDDD1', '삭제', () => {
			this.dataService.deleteCard(card.id);
			this.selectedCardId = undefined;
			this.refresh();
		}, 'danger');

		menu.appendChild($('.kanban-context-separator'));

		// ── AI Agents ──
		for (const agent of AI_AGENTS) {
			this.addContextMenuItem(menu, agent.icon, agent.label, () => {
				const sessions = [...(card.aiSessions || [])];
				sessions.push({
					sessionId: `${agent.id}-${Date.now()}`,
					ai: agent.id,
					ts: Date.now(),
				});
				this.dataService.updateCard(card.id, { aiSessions: sessions });
				this.refresh();
			});
		}

		// Adjust position if menu goes off screen
		requestAnimationFrame(() => {
			const menuRect = menu.getBoundingClientRect();
			if (menuRect.right > rect.right) {
				left = left - (menuRect.right - rect.right) - 8;
				menu.style.left = `${left}px`;
			}
			if (menuRect.bottom > rect.bottom) {
				top = top - (menuRect.bottom - rect.bottom) - 8;
				menu.style.top = `${top}px`;
			}
			menu.classList.add('visible');
		});

		// Close on click outside
		const closeHandler = (e: MouseEvent) => {
			if (!menu.contains(e.target as Node)) {
				this.hideContextMenu();
				document.removeEventListener('mousedown', closeHandler, true);
			}
		};
		document.addEventListener('mousedown', closeHandler, true);

		// Close on Escape
		const keyHandler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				this.hideContextMenu();
				document.removeEventListener('keydown', keyHandler, true);
			}
		};
		document.addEventListener('keydown', keyHandler, true);
	}

	private addContextMenuItem(menu: HTMLElement, icon: string, label: string, action: () => void, variant?: string): HTMLElement {
		const item = menu.appendChild($('.kanban-context-item'));
		if (variant) {
			item.classList.add(variant);
		}

		const iconEl = item.appendChild($('.kanban-context-icon'));
		iconEl.textContent = icon;

		const labelEl = item.appendChild($('.kanban-context-label'));
		labelEl.textContent = label;

		item.addEventListener('click', () => {
			this.hideContextMenu();
			action();
		});

		return item;
	}

	private hideContextMenu(): void {
		if (this.contextMenuEl) {
			this.contextMenuEl.remove();
			this.contextMenuEl = undefined;
		}
	}

	private hideDetailModal(): void {
		if (this.detailOverlay) {
			this.detailOverlay.classList.remove('visible');
			const overlay = this.detailOverlay;
			this.detailOverlay = undefined;
			setTimeout(() => overlay.remove(), 150);
			this.refresh();
		}
	}

	// ─── Activity Log ───────────────────────────────────

	private renderActivityLog(parent: HTMLElement): void {
		const logs = this.dataService.getActivityLog();
		if (logs.length === 0) {
			return;
		}

		const panel = parent.appendChild($('.kanban-activity-panel'));

		const header = panel.appendChild($('.kanban-activity-header'));
		header.textContent = 'Activity Log';

		const entries = panel.appendChild($('.kanban-activity-entries'));

		const displayLogs = logs.slice(0, 10);
		for (const log of displayLogs) {
			const entry = entries.appendChild($('.kanban-activity-entry'));

			const msg = entry.appendChild($('.kanban-activity-message'));
			msg.textContent = log.content;

			const time = entry.appendChild($('.kanban-activity-time'));
			time.textContent = this.formatTimestamp(log.createdAt);
		}
	}

	// ─── Helpers ────────────────────────────────────────

	private formatTimestamp(isoString: string): string {
		const date = new Date(isoString);
		if (isNaN(date.getTime())) {
			return isoString;
		}

		const now = new Date();
		const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
		const yesterday = new Date(today.getTime() - 86400000);
		const cardDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const time = `${hours}:${minutes}`;

		if (cardDate.getTime() === today.getTime()) {
			return `Today ${time}`;
		} else if (cardDate.getTime() === yesterday.getTime()) {
			return `Yesterday ${time}`;
		}

		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day} ${time}`;
	}
}
