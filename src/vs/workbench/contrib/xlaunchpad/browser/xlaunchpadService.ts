/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IXLaunchpadService, XLaunchpadModalId } from '../common/xlaunchpad.js';
import { XLaunchpadModal } from './modal/xlaunchpadModal.js';
import { GitGraphModal } from './gitGraph/gitGraphModal.js';
import { KanbanModal } from './kanban/kanbanModal.js';
import { ClaudeMonitorModal } from './claudeMonitor/claudeMonitorModal.js';

export class XLaunchpadService extends Disposable implements IXLaunchpadService {

	declare readonly _serviceBrand: undefined;

	private readonly modals = new Map<string, XLaunchpadModal>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	toggleGitGraphModal(): void {
		this.getOrCreateModal(XLaunchpadModalId.GitGraph, () => this.instantiationService.createInstance(GitGraphModal)).toggle();
	}

	toggleKanbanModal(): void {
		this.getOrCreateModal(XLaunchpadModalId.Kanban, () => this.instantiationService.createInstance(KanbanModal)).toggle();
	}

	toggleClaudeMonitorModal(): void {
		this.getOrCreateModal(XLaunchpadModalId.ClaudeMonitor, () => this.instantiationService.createInstance(ClaudeMonitorModal)).toggle();
	}

	isModalOpen(modalId: string): boolean {
		return this.modals.get(modalId)?.getIsVisible() ?? false;
	}

	private getOrCreateModal(id: string, factory: () => XLaunchpadModal): XLaunchpadModal {
		let modal = this.modals.get(id);
		if (!modal) {
			modal = this._register(factory());
			this.modals.set(id, modal);
		}
		return modal;
	}

	override dispose(): void {
		this.modals.clear();
		super.dispose();
	}
}
