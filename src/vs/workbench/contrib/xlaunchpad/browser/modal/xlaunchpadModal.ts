/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './xlaunchpadModal.css';
import { $, addDisposableListener, clearNode, EventType, getWindow } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { registerZIndex, ZIndex } from '../../../../../platform/layout/browser/zIndexRegistry.js';

// Register z-index for xlaunchpad modals (ModalDialog base=2600, +50 = 2650)
registerZIndex(ZIndex.ModalDialog, 50, 'xlaunchpad-modal');

export interface IXLaunchpadTab {
	readonly id: string;
	readonly label: string;
	badge?: number;
}

export abstract class XLaunchpadModal extends Disposable {

	private overlay: HTMLElement | undefined;
	private modalBox: HTMLElement | undefined;
	private body: HTMLElement | undefined;
	private tabElements: Map<string, HTMLElement> = new Map();
	private activeTabId: string | undefined;
	private focusToReturn: HTMLElement | undefined;
	private isVisible = false;
	private readonly showDisposables = this._register(new DisposableStore());

	// Floating mode drag state
	private isDragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;

	constructor(
		protected readonly id: string,
		protected readonly title: string,
		protected readonly defaultWidth: number,
		protected readonly defaultHeight: number,
		protected readonly minWidth: number,
		protected readonly minHeight: number,
		protected readonly floating: boolean,
		@ILayoutService protected readonly layoutService: ILayoutService,
		@IStorageService protected readonly storageService: IStorageService,
	) {
		super();
	}

	// --- Template methods for subclasses ---

	protected abstract getTabs(): IXLaunchpadTab[];
	protected abstract renderTabContent(tabId: string, container: HTMLElement): void;
	protected abstract onTabChanged(tabId: string): void;
	protected renderTitlebarActions(_container: HTMLElement): void { /* override in subclass */ }

	// --- Public API ---

	toggle(): void {
		if (this.isVisible) {
			this.hide();
		} else {
			this.show();
		}
	}

	show(): void {
		if (this.isVisible) {
			return;
		}
		this.isVisible = true;

		// Store focus for restoration
		const window = getWindow(this.layoutService.activeContainer);
		this.focusToReturn = window.document.activeElement as HTMLElement;

		// Create DOM
		this.createDOM();

		// Animate in (next frame to trigger CSS transition)
		requestAnimationFrame(() => {
			this.overlay?.classList.add('visible');
		});

		// Focus the modal
		this.modalBox?.focus();
	}

	hide(): void {
		if (!this.isVisible) {
			return;
		}
		this.isVisible = false;

		// Save size and position
		this.persistSize();
		if (this.floating) {
			this.persistPosition();
		}

		// Animate out
		this.overlay?.classList.remove('visible');

		// Remove after transition
		setTimeout(() => {
			this.destroyDOM();
		}, 160);

		// Restore focus
		if (this.focusToReturn && this.focusToReturn.isConnected) {
			this.focusToReturn.focus();
		}
	}

	getIsVisible(): boolean {
		return this.isVisible;
	}

	// --- DOM ---

	private createDOM(): void {
		this.showDisposables.clear();
		const container = this.layoutService.activeContainer;

		// Overlay
		this.overlay = container.appendChild($('.xlaunchpad-overlay'));

		if (this.floating) {
			this.overlay.classList.add('floating');
		} else {
			// Click outside to close (non-floating only)
			this.showDisposables.add(addDisposableListener(this.overlay, EventType.MOUSE_DOWN, (e) => {
				if (e.target === this.overlay) {
					this.hide();
				}
			}));
		}

		// Modal box
		const { width, height } = this.loadSize();
		this.modalBox = this.overlay.appendChild($('.xlaunchpad-modal'));
		this.modalBox.style.width = `${width}px`;
		this.modalBox.style.height = `${height}px`;
		this.modalBox.style.position = this.floating ? 'absolute' : 'relative';
		this.modalBox.setAttribute('role', 'dialog');
		this.modalBox.setAttribute('aria-modal', 'true');
		this.modalBox.setAttribute('aria-label', this.title);
		this.modalBox.tabIndex = -1;

		// Position floating modal from persisted position
		if (this.floating) {
			const pos = this.loadPosition();
			this.modalBox.style.left = `${pos.x}px`;
			this.modalBox.style.top = `${pos.y}px`;
		}

		// Titlebar
		const titlebar = this.modalBox.appendChild($('.xlaunchpad-titlebar'));
		const titleEl = titlebar.appendChild($('.xlaunchpad-titlebar-title'));
		titleEl.textContent = this.title;

		// Subclass hook for toolbar actions
		const actionsArea = titlebar.appendChild($('.xlaunchpad-titlebar-actions'));
		this.renderTitlebarActions(actionsArea);

		// Minimize button (floating mode only)
		if (this.floating) {
			const minimizeBtn = titlebar.appendChild($('.xlaunchpad-titlebar-minimize'));
			minimizeBtn.textContent = '\u2500'; // ─
			minimizeBtn.title = 'Minimize';
			this.showDisposables.add(addDisposableListener(minimizeBtn, EventType.CLICK, () => this.onMinimize()));
		}

		const closeBtn = titlebar.appendChild($('.xlaunchpad-titlebar-close'));
		closeBtn.textContent = '\u00D7'; // ×
		closeBtn.title = 'Close (Escape)';
		this.showDisposables.add(addDisposableListener(closeBtn, EventType.CLICK, () => this.hide()));

		// Tabs
		const tabs = this.getTabs();
		if (tabs.length > 1) {
			const tabBar = this.modalBox.appendChild($('.xlaunchpad-tabs'));
			for (const tab of tabs) {
				const tabEl = tabBar.appendChild($('.xlaunchpad-tab'));
				tabEl.textContent = tab.label;
				tabEl.dataset.tabId = tab.id;

				if (tab.badge !== undefined && tab.badge > 0) {
					const badge = tabEl.appendChild($('.xlaunchpad-tab-badge'));
					badge.textContent = String(tab.badge);
				}

				this.showDisposables.add(addDisposableListener(tabEl, EventType.CLICK, () => {
					this.switchTab(tab.id);
				}));
				this.tabElements.set(tab.id, tabEl);
			}
		}

		// Body
		this.body = this.modalBox.appendChild($('.xlaunchpad-body'));

		// Resize handles
		if (this.floating) {
			// 8-direction edge handles for floating mode
			const directions = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
			for (const dir of directions) {
				const handle = this.modalBox.appendChild($('.xlaunchpad-resize-edge'));
				handle.dataset.dir = dir;
				this.setupEdgeResize(handle, dir);
			}
		} else {
			// Single SE resize handle for centered mode
			const resizeHandle = this.modalBox.appendChild($('.xlaunchpad-resize-handle'));
			this.setupResize(resizeHandle);
		}

		// Setup titlebar drag for floating mode
		if (this.floating) {
			this.setupDrag(titlebar);
		}

		// Keyboard: Escape to close
		this.showDisposables.add(addDisposableListener(this.overlay, EventType.KEY_DOWN, (e) => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Escape) {
				e.preventDefault();
				e.stopPropagation();
				this.hide();
			}
		}));

		// Activate first tab
		const initialTab = this.activeTabId ?? tabs[0]?.id;
		if (initialTab) {
			this.switchTab(initialTab);
		} else {
			// No tabs — render body directly
			this.renderTabContent('', this.body);
		}
	}

	private destroyDOM(): void {
		this.showDisposables.clear();
		this.tabElements.clear();
		this.overlay?.remove();
		this.overlay = undefined;
		this.modalBox = undefined;
		this.body = undefined;
	}

	// --- Tabs ---

	private switchTab(tabId: string): void {
		if (this.activeTabId === tabId && this.body?.hasChildNodes()) {
			return;
		}

		this.activeTabId = tabId;

		// Update tab active states
		for (const [id, el] of this.tabElements) {
			el.classList.toggle('active', id === tabId);
		}

		// Re-render body
		if (this.body) {
			clearNode(this.body);
			this.renderTabContent(tabId, this.body);
		}

		this.onTabChanged(tabId);
	}

	protected updateTabBadge(tabId: string, count: number): void {
		const tabEl = this.tabElements.get(tabId);
		if (!tabEl) {
			return;
		}
		let badge = tabEl.querySelector('.xlaunchpad-tab-badge') as HTMLElement | null;
		if (count > 0) {
			if (!badge) {
				badge = tabEl.appendChild($('.xlaunchpad-tab-badge'));
			}
			badge.textContent = String(count);
		} else {
			badge?.remove();
		}
	}

	// --- Resize ---

	private setupResize(handle: HTMLElement): void {
		let startX = 0;
		let startY = 0;
		let startW = 0;
		let startH = 0;

		const onMouseMove = (e: MouseEvent) => {
			if (!this.modalBox) {
				return;
			}
			const newW = Math.max(this.minWidth, startW + (e.clientX - startX));
			const newH = Math.max(this.minHeight, startH + (e.clientY - startY));
			this.modalBox.style.width = `${newW}px`;
			this.modalBox.style.height = `${newH}px`;
		};

		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this.persistSize();
		};

		this.showDisposables.add(addDisposableListener(handle, EventType.MOUSE_DOWN, (e) => {
			e.preventDefault();
			if (!this.modalBox) {
				return;
			}
			startX = e.clientX;
			startY = e.clientY;
			startW = this.modalBox.offsetWidth;
			startH = this.modalBox.offsetHeight;
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		}));
	}

	// --- Drag (floating mode) ---

	private setupDrag(titlebar: HTMLElement): void {
		const onMouseMove = (e: MouseEvent) => {
			if (!this.isDragging || !this.modalBox || !this.overlay) {
				return;
			}
			const containerRect = this.overlay.getBoundingClientRect();
			const boxW = this.modalBox.offsetWidth;
			const boxH = this.modalBox.offsetHeight;

			let newX = e.clientX - containerRect.left - this.dragOffsetX;
			let newY = e.clientY - containerRect.top - this.dragOffsetY;

			// Clamp to container bounds
			newX = Math.max(0, Math.min(newX, containerRect.width - boxW));
			newY = Math.max(0, Math.min(newY, containerRect.height - boxH));

			this.modalBox.style.left = `${newX}px`;
			this.modalBox.style.top = `${newY}px`;
		};

		const onMouseUp = () => {
			this.isDragging = false;
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this.persistPosition();
		};

		this.showDisposables.add(addDisposableListener(titlebar, EventType.MOUSE_DOWN, (e) => {
			// Only drag on left button, ignore clicks on buttons inside titlebar
			if (e.button !== 0 || (e.target as HTMLElement).closest('.xlaunchpad-titlebar-close, .xlaunchpad-titlebar-minimize, .xlaunchpad-titlebar-actions')) {
				return;
			}
			e.preventDefault();
			if (!this.modalBox) {
				return;
			}
			this.isDragging = true;
			const boxRect = this.modalBox.getBoundingClientRect();
			this.dragOffsetX = e.clientX - boxRect.left;
			this.dragOffsetY = e.clientY - boxRect.top;
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		}));
	}

	// --- 8-direction edge resize (floating mode) ---

	private setupEdgeResize(handle: HTMLElement, dir: string): void {
		let startX = 0;
		let startY = 0;
		let startW = 0;
		let startH = 0;
		let startLeft = 0;
		let startTop = 0;

		const onMouseMove = (e: MouseEvent) => {
			if (!this.modalBox) {
				return;
			}
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;

			let newW = startW;
			let newH = startH;
			let newLeft = startLeft;
			let newTop = startTop;

			// East: width grows right
			if (dir.includes('e')) {
				newW = Math.max(this.minWidth, startW + dx);
			}
			// West: width grows left + shifts left
			if (dir.includes('w')) {
				const proposedW = startW - dx;
				if (proposedW >= this.minWidth) {
					newW = proposedW;
					newLeft = startLeft + dx;
				} else {
					newW = this.minWidth;
					newLeft = startLeft + (startW - this.minWidth);
				}
			}
			// South: height grows down
			if (dir === 's' || dir === 'se' || dir === 'sw') {
				newH = Math.max(this.minHeight, startH + dy);
			}
			// North: height grows up + shifts top
			if (dir === 'n' || dir === 'ne' || dir === 'nw') {
				const proposedH = startH - dy;
				if (proposedH >= this.minHeight) {
					newH = proposedH;
					newTop = startTop + dy;
				} else {
					newH = this.minHeight;
					newTop = startTop + (startH - this.minHeight);
				}
			}

			this.modalBox.style.width = `${newW}px`;
			this.modalBox.style.height = `${newH}px`;
			this.modalBox.style.left = `${newLeft}px`;
			this.modalBox.style.top = `${newTop}px`;
			this.onDidResize();
		};

		const onMouseUp = () => {
			document.removeEventListener('mousemove', onMouseMove);
			document.removeEventListener('mouseup', onMouseUp);
			this.persistSize();
			this.persistPosition();
		};

		this.showDisposables.add(addDisposableListener(handle, EventType.MOUSE_DOWN, (e) => {
			e.preventDefault();
			if (!this.modalBox) {
				return;
			}
			startX = e.clientX;
			startY = e.clientY;
			startW = this.modalBox.offsetWidth;
			startH = this.modalBox.offsetHeight;
			startLeft = this.modalBox.offsetLeft;
			startTop = this.modalBox.offsetTop;
			document.addEventListener('mousemove', onMouseMove);
			document.addEventListener('mouseup', onMouseUp);
		}));
	}

	// --- Protected hooks ---

	/**
	 * Called when the minimize button is clicked (floating mode).
	 * Override in subclass for custom minimize behavior.
	 */
	protected onMinimize(): void {
		this.hide();
	}

	/**
	 * Called after a floating-mode resize. Override in subclass (e.g. for terminal fit).
	 */
	protected onDidResize(): void {
		// no-op by default
	}

	// --- Size Persistence ---

	private get sizeStorageKey(): string {
		return `xlaunchpad.${this.id}.size`;
	}

	private loadSize(): { width: number; height: number } {
		const raw = this.storageService.get(this.sizeStorageKey, StorageScope.WORKSPACE);
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
					return { width: parsed.width, height: parsed.height };
				}
			} catch { /* use defaults */ }
		}
		return { width: this.defaultWidth, height: this.defaultHeight };
	}

	private persistSize(): void {
		if (!this.modalBox) {
			return;
		}
		const size = { width: this.modalBox.offsetWidth, height: this.modalBox.offsetHeight };
		this.storageService.store(this.sizeStorageKey, JSON.stringify(size), StorageScope.WORKSPACE, StorageTarget.USER);
	}

	// --- Position Persistence (floating mode) ---

	private get positionStorageKey(): string {
		return `xlaunchpad.${this.id}.position`;
	}

	private loadPosition(): { x: number; y: number } {
		const raw = this.storageService.get(this.positionStorageKey, StorageScope.WORKSPACE);
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
					return { x: parsed.x, y: parsed.y };
				}
			} catch { /* use defaults */ }
		}
		// Default to center of screen
		const container = this.layoutService.activeContainer;
		const { width, height } = this.loadSize();
		const x = Math.max(0, (container.clientWidth - width) / 2);
		const y = Math.max(0, (container.clientHeight - height) / 2);
		return { x, y };
	}

	private persistPosition(): void {
		if (!this.modalBox) {
			return;
		}
		const position = { x: this.modalBox.offsetLeft, y: this.modalBox.offsetTop };
		this.storageService.store(this.positionStorageKey, JSON.stringify(position), StorageScope.WORKSPACE, StorageTarget.USER);
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}
