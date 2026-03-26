/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './xlaunchpadStatusBar.css';
import { $, addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../services/statusbar/browser/statusbar.js';
import { Parts } from '../../../../services/layout/browser/layoutService.js';
import { IClaudeTerminalService } from '../../common/xlaunchpad.js';

export class XLaunchpadStatusBarContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.xlaunchpadStatusBar';

	private readonly _claudeEntry: IStatusbarEntryAccessor;
	private _popup: HTMLElement | undefined;
	private _hideTimeout: ReturnType<typeof setTimeout> | undefined;

	constructor(
		@IStatusbarService statusbarService: IStatusbarService,
		@IClaudeTerminalService private readonly _claudeTerminalService: IClaudeTerminalService,
	) {
		super();

		// Git Graph
		this._register(statusbarService.addEntry({
			name: 'Git Graph',
			text: '$(git-branch) Graph',
			ariaLabel: 'Toggle Git Graph',
			command: { id: 'xlaunchpad.toggleGitGraph', title: '' },
			tooltip: 'Toggle Git Graph (Ctrl+G)',
		}, 'xlaunchpad.gitGraph', StatusbarAlignment.RIGHT, -1000));

		// Kanban Board
		this._register(statusbarService.addEntry({
			name: 'Kanban Board',
			text: '$(checklist) Plan',
			ariaLabel: 'Toggle Kanban Board',
			command: { id: 'xlaunchpad.toggleKanban', title: '' },
			tooltip: 'Toggle Kanban Board (Ctrl+Shift+K)',
		}, 'xlaunchpad.kanban', StatusbarAlignment.RIGHT, -1001));

		// Claude Terminal — click creates new session, hover shows popup
		this._claudeEntry = this._register(statusbarService.addEntry({
			name: 'Quick Claude',
			text: '$(hubot) Claude',
			ariaLabel: 'Quick Claude',
			command: { id: 'xlaunchpad.toggleClaudeTerminal', title: '' },
			tooltip: '',
		}, 'xlaunchpad.claudeTerminal', StatusbarAlignment.RIGHT, -1002));

		// Update badge when session count changes
		this._register(this._claudeTerminalService.onDidChangeSessionCount(() => {
			this._updateBadge();
			// Refresh popup if visible
			if (this._popup) {
				this._renderPopupContent();
			}
		}));

		// Setup hover popup on Claude button
		this._setupHoverPopup();

		// Offset status bar to not extend past the sidebar
		this._setupStatusBarOffset();
	}

	private _updateBadge(): void {
		const count = this._claudeTerminalService.minimizedCount;
		const text = count > 0 ? `$(hubot) Claude [${count}]` : '$(hubot) Claude';
		this._claudeEntry.update({
			name: 'Quick Claude',
			text,
			ariaLabel: 'Quick Claude',
			command: { id: 'xlaunchpad.toggleClaudeTerminal', title: '' },
			tooltip: '',
		});
	}

	private _setupHoverPopup(): void {
		const tryAttach = (retries: number) => {
			const element = document.querySelector('[id="xlaunchpad.claudeTerminal"]') as HTMLElement | null;
			if (element) {
				// Suppress default tooltip
				element.title = '';
				const observer = new MutationObserver(() => { element.title = ''; });
				observer.observe(element, { attributes: true, attributeFilter: ['title'] });
				this._register({ dispose: () => observer.disconnect() });

				this._register(addDisposableListener(element, EventType.MOUSE_ENTER, () => {
					this._clearHideTimeout();
					this._showPopup(element);
				}));
				this._register(addDisposableListener(element, EventType.MOUSE_LEAVE, () => {
					this._scheduleHide();
				}));
			} else if (retries > 0) {
				setTimeout(() => tryAttach(retries - 1), 500);
			}
		};
		tryAttach(10);
	}

	private _showPopup(anchor: HTMLElement): void {
		if (!this._popup) {
			this._popup = document.body.appendChild($('.claude-session-popup'));
			this._register(addDisposableListener(this._popup, EventType.MOUSE_ENTER, () => {
				this._clearHideTimeout();
			}));
			this._register(addDisposableListener(this._popup, EventType.MOUSE_LEAVE, () => {
				this._scheduleHide();
			}));
		}

		this._renderPopupContent();

		// Position above the anchor
		const rect = anchor.getBoundingClientRect();
		this._popup.style.left = `${rect.left}px`;
		this._popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
		this._popup.style.top = '';
	}

	private _renderPopupContent(): void {
		if (!this._popup) {
			return;
		}

		// Clear existing content
		while (this._popup.firstChild) {
			this._popup.removeChild(this._popup.firstChild);
		}

		const sessions = this._claudeTerminalService.getSessions();

		// Session items
		for (const session of sessions) {
			const item = this._popup.appendChild($('.claude-session-popup-item'));

			const dot = item.appendChild($('.claude-session-popup-item-dot'));
			if (session.minimized) {
				dot.style.opacity = '0.4';
			}

			const label = item.appendChild($('.claude-session-popup-item-label'));
			label.textContent = session.label;

			const closeBtn = item.appendChild($('button.claude-session-popup-item-close'));
			closeBtn.textContent = '\u00D7'; // ×

			// Click label area → restore/focus
			item.addEventListener('click', (e) => {
				if (e.target === closeBtn) {
					return;
				}
				this._claudeTerminalService.restoreSession(session.id);
				this._hidePopup();
			});

			// Click close → close session
			closeBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				this._claudeTerminalService.closeSession(session.id);
			});
		}

		// Separator
		if (sessions.length > 0) {
			this._popup.appendChild($('.claude-session-popup-separator'));
		}

		// New session
		const newItem = this._popup.appendChild($('.claude-session-popup-action'));
		const newIcon = newItem.appendChild($('.claude-session-popup-action-icon'));
		newIcon.textContent = '+';
		const newLabel = newItem.appendChild($('span'));
		newLabel.textContent = '\uC0C8 Quick Claude';
		newItem.addEventListener('click', () => {
			this._claudeTerminalService.createSession();
			this._hidePopup();
		});

		// Close all (only if sessions exist)
		if (sessions.length > 0) {
			const closeAllItem = this._popup.appendChild($('.claude-session-popup-action.destructive'));
			const closeAllIcon = closeAllItem.appendChild($('.claude-session-popup-action-icon'));
			closeAllIcon.textContent = '\u00D7'; // ×
			const closeAllLabel = closeAllItem.appendChild($('span'));
			closeAllLabel.textContent = '\uC804\uCCB4 \uB2EB\uAE30';
			closeAllItem.addEventListener('click', () => {
				this._claudeTerminalService.closeAllSessions();
				this._hidePopup();
			});
		}
	}

	private _scheduleHide(): void {
		this._clearHideTimeout();
		this._hideTimeout = setTimeout(() => {
			this._hidePopup();
		}, 200);
	}

	private _clearHideTimeout(): void {
		if (this._hideTimeout !== undefined) {
			clearTimeout(this._hideTimeout);
			this._hideTimeout = undefined;
		}
	}

	private _hidePopup(): void {
		this._clearHideTimeout();
		if (this._popup) {
			this._popup.remove();
			this._popup = undefined;
		}
	}

	private _setupStatusBarOffset(): void {
		const trySetup = (retries: number) => {
			const sidebarEl = document.querySelector(`.part[id="${Parts.SIDEBAR_PART}"]`) as HTMLElement | null;
			const activityBarEl = document.querySelector(`.part[id="${Parts.ACTIVITYBAR_PART}"]`) as HTMLElement | null;
			const statusBarEl = document.querySelector(`.part[id="${Parts.STATUSBAR_PART}"]`) as HTMLElement | null;

			if (sidebarEl && statusBarEl) {
				const updateOffset = () => {
					const sidebarWidth = sidebarEl.offsetWidth;
					const activityBarWidth = activityBarEl?.offsetWidth ?? 0;
					statusBarEl.style.paddingLeft = `${sidebarWidth + activityBarWidth}px`;
				};

				const observer = new ResizeObserver(() => updateOffset());
				observer.observe(sidebarEl);
				if (activityBarEl) {
					observer.observe(activityBarEl);
				}
				this._register({ dispose: () => observer.disconnect() });

				updateOffset();
			} else if (retries > 0) {
				setTimeout(() => trySetup(retries - 1), 500);
			}
		};
		trySetup(10);
	}

	override dispose(): void {
		this._hidePopup();
		super.dispose();
	}
}
