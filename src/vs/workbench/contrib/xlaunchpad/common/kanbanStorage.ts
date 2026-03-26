/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IKanbanBoard {
	readonly version: 1;
	cards: IKanbanCard[];
	activityLog: IKanbanActivityLog[];
	nextTicketNumber: number;
}

export interface IKanbanCard {
	id: string;
	ticketId: string;
	title: string;
	description: string;
	category: KanbanCategory;
	column: KanbanColumn;
	order: number;
	createdAt: string;
	updatedAt: string;
}

export interface IKanbanActivityLog {
	id: string;
	cardId: string;
	message: string;
	timestamp: string;
}

export type KanbanColumn = 'todo' | 'doing' | 'done' | 'onhold' | 'cancelled';
export type KanbanCategory = 'feature' | 'bug' | 'other';

export const KanbanColumnLabels: Record<KanbanColumn, string> = {
	todo: 'TODO',
	doing: 'DOING',
	done: 'DONE',
	onhold: 'ON HOLD',
	cancelled: 'CANCELLED',
};

export const KanbanCategoryLabels: Record<KanbanCategory, string> = {
	feature: '기능',
	bug: '버그',
	other: '기타',
};

export function createEmptyBoard(): IKanbanBoard {
	return { version: 1, cards: [], activityLog: [], nextTicketNumber: 1 };
}
