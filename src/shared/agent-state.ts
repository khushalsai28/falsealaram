import type { AgentResult } from './types';

/**
 * Runtime broadcasts are ephemeral: a side panel can finish mounting after a
 * quick agent run has already completed. Keep the latest per-tab run in
 * session storage so the panel can catch up without persisting history.
 */
export interface AgentRunState {
  status: 'running' | 'complete';
  query: string;
  updatedAt: number;
  result?: AgentResult;
}

const prefix = 'falsealarm:agent-run:';

export const agentRunKey = (tabId: number) => `${prefix}${tabId}`;

function storageArea(): typeof chrome.storage.local {
  const storage = chrome.storage as typeof chrome.storage & { session?: typeof chrome.storage.local };
  return storage.session ?? chrome.storage.local;
}

function isAgentRunState(value: unknown): value is AgentRunState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<AgentRunState>;
  if ((state.status !== 'running' && state.status !== 'complete') || typeof state.query !== 'string') return false;
  if (typeof state.updatedAt !== 'number') return false;
  return state.result === undefined || (typeof state.result === 'object' && state.result !== null);
}

export async function saveAgentRun(tabId: number, state: AgentRunState): Promise<void> {
  await storageArea().set({ [agentRunKey(tabId)]: state });
}

export async function getAgentRun(tabId: number): Promise<AgentRunState | undefined> {
  const key = agentRunKey(tabId);
  const stored = await storageArea().get(key);
  const value = stored[key];
  return isAgentRunState(value) ? value : undefined;
}
