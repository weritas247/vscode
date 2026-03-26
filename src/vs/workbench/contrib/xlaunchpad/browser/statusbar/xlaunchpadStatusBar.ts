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
			// Apply inline styles to guarantee visibility regardless of CSS specificity
			Object.assign(this._popup.style, {
				background: '#252526',
				color: '#cccccc',
				border: '1px solid #454545',
				borderRadius: '6px',
				boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
				padding: '4px 0',
				fontSize: '13px',
				minWidth: '220px',
				position: 'fixed',
				zIndex: '2700',
			});
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
			Object.assign(item.style, { display: 'flex', alignItems: 'center', padding: '6px 12px', cursor: 'pointer', gap: '8px', color: '#cccccc' });
			item.addEventListener('mouseenter', () => { item.style.background = '#094771'; item.style.color = '#ffffff'; });
			item.addEventListener('mouseleave', () => { item.style.background = ''; item.style.color = '#cccccc'; });

			const dot = item.appendChild($('.claude-session-popup-item-dot'));
			Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%', background: '#4ec9b0', flexShrink: '0' });
			if (session.minimized) {
				dot.style.opacity = '0.4';
			}

			const label = item.appendChild($('.claude-session-popup-item-label'));
			label.textContent = session.label;
			Object.assign(label.style, { flex: '1', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });

			const closeBtn = item.appendChild($('button.claude-session-popup-item-close'));
			closeBtn.textContent = '\u00D7'; // ×
			Object.assign(closeBtn.style, { display: 'none', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', border: 'none', background: 'transparent', color: '#cccccc', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', flexShrink: '0' });
			item.addEventListener('mouseenter', () => { closeBtn.style.display = 'flex'; });
			item.addEventListener('mouseleave', () => { closeBtn.style.display = 'none'; });

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
			const sep = this._popup.appendChild($('.claude-session-popup-separator'));
			Object.assign(sep.style, { height: '1px', background: '#454545', margin: '4px 8px' });
		}

		// New session
		const newItem = this._popup.appendChild($('.claude-session-popup-action'));
		Object.assign(newItem.style, { display: 'flex', alignItems: 'center', padding: '6px 12px', cursor: 'pointer', gap: '8px', color: '#cccccc', opacity: '0.8' });
		newItem.addEventListener('mouseenter', () => { newItem.style.background = '#094771'; newItem.style.color = '#ffffff'; newItem.style.opacity = '1'; });
		newItem.addEventListener('mouseleave', () => { newItem.style.background = ''; newItem.style.color = '#cccccc'; newItem.style.opacity = '0.8'; });
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
			const closeAllItem = this._popup.appendChild($('.claude-session-popup-action'));
			Object.assign(closeAllItem.style, { display: 'flex', alignItems: 'center', padding: '6px 12px', cursor: 'pointer', gap: '8px', color: '#cccccc', opacity: '0.8' });
			closeAllItem.addEventListener('mouseenter', () => { closeAllItem.style.background = '#094771'; closeAllItem.style.color = '#f48771'; closeAllItem.style.opacity = '1'; });
			closeAllItem.addEventListener('mouseleave', () => { closeAllItem.style.background = ''; closeAllItem.style.color = '#cccccc'; closeAllItem.style.opacity = '0.8'; });
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
				statusBarEl.classList.add('xlaunchpad-statusbar-offset');

				// Track sidebar width and set CSS variable
				const updateOffset = () => {
					const sidebarWidth = sidebarEl.offsetWidth;
					const activityBarWidth = activityBarEl?.offsetWidth ?? 0;
					statusBarEl.style.setProperty('--xlaunchpad-statusbar-offset', `${sidebarWidth + activityBarWidth}px`);
				};

				const resizeObserver = new ResizeObserver(() => updateOffset());
				resizeObserver.observe(sidebarEl);
				if (activityBarEl) {
					resizeObserver.observe(activityBarEl);
				}
				this._register({ dispose: () => resizeObserver.disconnect() });

				// Intercept inline backgroundColor: move it to CSS variable, set element bg to transparent
				const interceptBgColor = () => {
					const bg = statusBarEl.style.backgroundColor;
					if (bg && bg !== 'transparent') {
						statusBarEl.style.setProperty('--xlaunchpad-statusbar-bg', bg);
						statusBarEl.style.backgroundColor = 'transparent';
					}
				};

				const mutationObserver = new MutationObserver(() => interceptBgColor());
				mutationObserver.observe(statusBarEl, { attributes: true, attributeFilter: ['style'] });
				this._register({ dispose: () => mutationObserver.disconnect() });

				updateOffset();
				interceptBgColor();
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
