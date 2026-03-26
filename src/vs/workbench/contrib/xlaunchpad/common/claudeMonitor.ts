/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IClaudeSession {
	readonly sessionId: string;
	readonly model: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheCreationTokens: number;
	readonly cost: number;
	readonly timestamp: string;
}

export interface IClaudeProjectUsage {
	readonly projectPath: string;
	readonly sessions: IClaudeSession[];
	readonly totalInputTokens: number;
	readonly totalOutputTokens: number;
	readonly totalCost: number;
}

// Pricing per million tokens
export const ClaudeModelPricing: Record<string, { input: number; output: number; cacheRead: number; cacheCreation: number }> = {
	'claude-opus-4-6': { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
	'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
	'claude-haiku-4-5': { input: 0.8, output: 4, cacheRead: 0.08, cacheCreation: 1 },
	// Older models
	'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
};

export function calculateCost(model: string, inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheCreationTokens: number): number {
	// Find pricing: exact match first, then prefix match
	const pricing = ClaudeModelPricing[model]
		?? Object.entries(ClaudeModelPricing).find(([key]) => model.startsWith(key))?.[1]
		?? ClaudeModelPricing['claude-sonnet-4-6']; // fallback
	if (!pricing) {
		return 0;
	}
	return (
		(inputTokens / 1_000_000) * pricing.input +
		(outputTokens / 1_000_000) * pricing.output +
		(cacheReadTokens / 1_000_000) * pricing.cacheRead +
		(cacheCreationTokens / 1_000_000) * pricing.cacheCreation
	);
}
