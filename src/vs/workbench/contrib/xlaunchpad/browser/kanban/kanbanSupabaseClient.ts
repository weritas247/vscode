/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKanbanPlanRow, IKanbanPlanLogRow, IKanbanSupabaseConfig, IAiSessionEntry, columnToDbStatus, KanbanColumn } from '../../common/kanbanStorage.js';

/**
 * Supabase PostgREST HTTP client for kanban data.
 * Uses raw fetch — no external SDK dependency.
 * Mirrors x-launchpad/server/supabase.ts API surface.
 */
export class KanbanSupabaseClient {

	private readonly baseUrl: string;
	private readonly headers: Record<string, string>;
	private readonly userId: number;

	constructor(config: IKanbanSupabaseConfig) {
		this.baseUrl = config.url.replace(/\/$/, '');
		this.userId = config.userId;
		this.headers = {
			'apikey': config.anonKey,
			'Authorization': `Bearer ${config.anonKey}`,
			'Content-Type': 'application/json',
			'Prefer': 'return=representation',
		};
	}

	// ─── Plans CRUD ─────────────────────────────────────

	async getPlans(project?: string): Promise<IKanbanPlanRow[]> {
		let url = `${this.baseUrl}/rest/v1/plans?select=*&user_id=eq.${this.userId}&order=updated_at.desc`;
		if (project) {
			url += `&or=(project.eq.${encodeURIComponent(project)},project.is.null)`;
		}
		const res = await fetch(url, { headers: this.headers });
		if (!res.ok) {
			throw new Error(`[supabase] getPlans failed: ${res.status}`);
		}
		return res.json();
	}

	async getPlan(planId: string): Promise<IKanbanPlanRow | null> {
		const url = `${this.baseUrl}/rest/v1/plans?select=*&id=eq.${encodeURIComponent(planId)}&user_id=eq.${this.userId}`;
		const res = await fetch(url, {
			headers: { ...this.headers, 'Accept': 'application/vnd.pgrst.object+json' },
		});
		if (res.status === 406) {
			return null; // Not found
		}
		if (!res.ok) {
			throw new Error(`[supabase] getPlan failed: ${res.status}`);
		}
		return res.json();
	}

	async createPlan(plan: {
		id: string;
		title: string;
		content: string;
		category: string;
		status?: string;
		project?: string | null;
	}): Promise<IKanbanPlanRow> {
		const ticketId = await this.generateTicketId(plan.category);

		const body = {
			id: plan.id,
			user_id: this.userId,
			title: plan.title,
			content: plan.content,
			category: plan.category,
			status: plan.status || 'todo',
			ticket_id: ticketId,
			project: plan.project || null,
		};

		const res = await fetch(`${this.baseUrl}/rest/v1/plans`, {
			method: 'POST',
			headers: { ...this.headers, 'Accept': 'application/vnd.pgrst.object+json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`[supabase] createPlan failed: ${res.status}`);
		}
		return res.json();
	}

	async updatePlan(planId: string, updates: Record<string, unknown>): Promise<IKanbanPlanRow> {
		const body = { ...updates, updated_at: new Date().toISOString() };
		const url = `${this.baseUrl}/rest/v1/plans?id=eq.${encodeURIComponent(planId)}&user_id=eq.${this.userId}`;
		const res = await fetch(url, {
			method: 'PATCH',
			headers: { ...this.headers, 'Accept': 'application/vnd.pgrst.object+json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`[supabase] updatePlan failed: ${res.status}`);
		}
		return res.json();
	}

	async deletePlan(planId: string): Promise<void> {
		const url = `${this.baseUrl}/rest/v1/plans?id=eq.${encodeURIComponent(planId)}&user_id=eq.${this.userId}`;
		const res = await fetch(url, {
			method: 'DELETE',
			headers: this.headers,
		});
		if (!res.ok) {
			throw new Error(`[supabase] deletePlan failed: ${res.status}`);
		}
	}

	async updatePlanStatus(planId: string, column: KanbanColumn): Promise<IKanbanPlanRow> {
		return this.updatePlan(planId, { status: columnToDbStatus(column), ai_done: false });
	}

	// ─── AI Sessions ────────────────────────────────────

	async addAiSession(planId: string, session: IAiSessionEntry): Promise<IKanbanPlanRow> {
		const plan = await this.getPlan(planId);
		const current: IAiSessionEntry[] = plan?.ai_sessions || [];
		current.push(session);
		return this.updatePlan(planId, { ai_sessions: current });
	}

	// ─── Plan Logs ──────────────────────────────────────

	async getPlanLogs(planId: string): Promise<IKanbanPlanLogRow[]> {
		const url = `${this.baseUrl}/rest/v1/plan_logs?select=*&plan_id=eq.${encodeURIComponent(planId)}&order=created_at.desc`;
		const res = await fetch(url, { headers: this.headers });
		if (!res.ok) {
			throw new Error(`[supabase] getPlanLogs failed: ${res.status}`);
		}
		return res.json();
	}

	async appendPlanLog(log: {
		plan_id: string;
		type: string;
		content: string;
		commit_hash?: string;
	}): Promise<IKanbanPlanLogRow> {
		const body = {
			plan_id: log.plan_id,
			type: log.type,
			content: log.content,
			commit_hash: log.commit_hash || null,
		};
		const res = await fetch(`${this.baseUrl}/rest/v1/plan_logs`, {
			method: 'POST',
			headers: { ...this.headers, 'Accept': 'application/vnd.pgrst.object+json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`[supabase] appendPlanLog failed: ${res.status}`);
		}

		// Auto-transition: summary log → mark plan as done
		if (log.type === 'summary') {
			await this.updatePlan(log.plan_id, { ai_done: true, status: 'done' });
		}

		return res.json();
	}

	// ─── Ticket ID Generation ───────────────────────────

	private async generateTicketId(category: string): Promise<string> {
		const prefix = 'XL';
		const type = category === 'bug' ? 'fix' : 'feat';

		// Find max existing ticket number
		const url = `${this.baseUrl}/rest/v1/plans?select=ticket_id&user_id=eq.${this.userId}&ticket_id=not.is.null`;
		const res = await fetch(url, { headers: this.headers });

		let maxNum = 0;
		if (res.ok) {
			const rows: Array<{ ticket_id: string }> = await res.json();
			for (const row of rows) {
				const match = row.ticket_id?.match(/-(\d+)$/);
				if (match) {
					const num = parseInt(match[1], 10);
					if (num > maxNum) {
						maxNum = num;
					}
				}
			}
		}

		const nextNum = String(maxNum + 1).padStart(4, '0');
		return `${prefix}-${type}-${nextNum}`;
	}
}
