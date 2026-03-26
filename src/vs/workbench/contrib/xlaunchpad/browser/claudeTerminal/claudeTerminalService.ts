/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IClaudeTerminalService, IClaudeTerminalSession } from '../../common/xlaunchpad.js';
import { ClaudeTerminalModal } from './claudeTerminalModal.js';

interface IClaudeTerminalSessionInternal extends IClaudeTerminalSession {
	readonly modal: ClaudeTerminalModal;
	readonly disposables: DisposableStore;
	minimized: boolean;
}

export class ClaudeTerminalService extends Disposable implements IClaudeTerminalService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeSessionCount = this._register(new Emitter<number>());
	readonly onDidChangeSessionCount = this._onDidChangeSessionCount.event;

	private readonly sessions = new Map<string, IClaudeTerminalSessionInternal>();
	private sessionCounter = 0;
	private lastActiveSessionId: string | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	createSession(): void {
		this.sessionCounter++;
		const id = `claude-terminal-${this.sessionCounter}`;
		const label = `Claude Session ${this.sessionCounter}`;

		const disposables = new DisposableStore();
		const modal = disposables.add(this.instantiationService.createInstance(ClaudeTerminalModal, id, label));

		disposables.add(modal.onDidRequestMinimize(() => {
			this.minimizeSession(id);
		}));

		const session: IClaudeTerminalSessionInternal = {
			id,
			label,
			modal,
			disposables,
			minimized: false,
		};

		this.sessions.set(id, session);
		this.lastActiveSessionId = id;
		modal.show();

		this._onDidChangeSessionCount.fire(this.sessions.size);
	}

	closeSession(id: string): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}

		session.modal.killProcess();
		session.disposables.dispose();
		this.sessions.delete(id);

		if (this.lastActiveSessionId === id) {
			const remaining = [...this.sessions.keys()];
			this.lastActiveSessionId = remaining.length > 0 ? remaining[remaining.length - 1] : undefined;
		}

		this._onDidChangeSessionCount.fire(this.sessions.size);
	}

	toggleLastSession(): void {
		if (this.lastActiveSessionId) {
			const session = this.sessions.get(this.lastActiveSessionId);
			if (session) {
				if (session.minimized) {
					this.restoreSession(session.id);
				} else if (session.modal.getIsVisible()) {
					this.minimizeSession(session.id);
				} else {
					session.modal.show();
					session.minimized = false;
					this.lastActiveSessionId = session.id;
				}
				return;
			}
		}
		this.createSession();
	}

	minimizeSession(id: string): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}
		session.modal.hide();
		session.minimized = true;
		this._onDidChangeSessionCount.fire(this.sessions.size);
	}

	restoreSession(id: string): void {
		const session = this.sessions.get(id);
		if (!session) {
			return;
		}
		session.modal.show();
		session.minimized = false;
		this.lastActiveSessionId = id;
		this._onDidChangeSessionCount.fire(this.sessions.size);
	}

	getSessions(): IClaudeTerminalSession[] {
		return [...this.sessions.values()].map(s => ({
			id: s.id,
			label: s.label,
			minimized: s.minimized,
		}));
	}

	get minimizedCount(): number {
		let count = 0;
		for (const session of this.sessions.values()) {
			if (session.minimized) {
				count++;
			}
		}
		return count;
	}

	override dispose(): void {
		for (const session of this.sessions.values()) {
			session.modal.killProcess();
			session.disposables.dispose();
		}
		this.sessions.clear();
		super.dispose();
	}
}
