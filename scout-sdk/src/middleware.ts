import type { Scout } from './client.js';
import { ScoutApiError } from './types.js';

export interface MonitorOptions {
  agentId: string;
  toolName: string;
  getPrompt: (...args: unknown[]) => string;
}

/**
 * Wraps an async tool call with kill-switch check, prompt filter, and event tracking.
 */
export function withScoutMonitoring<Args extends unknown[], Result>(
  scout: Scout,
  options: MonitorOptions,
  fn: (...args: Args) => Promise<Result>,
): (...args: Args) => Promise<Result> {
  return async (...args: Args): Promise<Result> => {
    await scout.assertAgentRunnable(options.agentId);

    const prompt = options.getPrompt(...args);
    const filterResult = await scout.filter({
      agentId: options.agentId,
      prompt,
      tools: [options.toolName],
    });

    if (filterResult.blocked) {
      throw new ScoutApiError(
        filterResult.reason ?? `Scout blocked the call to ${options.toolName}`,
        403,
        { error: 'blocked', ...filterResult },
      );
    }

    try {
      const result = await fn(...args);
      await scout
        .trackEvent({
          agentId: options.agentId,
          type: 'tool_call_completed',
          toolName: options.toolName,
          message: `Completed ${options.toolName}`,
          severity: 'low',
        })
        .catch(() => undefined);
      return result;
    } catch (err) {
      if (!(err instanceof ScoutApiError && err.code === 'kill_switch')) {
        await scout
          .trackEvent({
            agentId: options.agentId,
            type: 'tool_call_failed',
            toolName: options.toolName,
            message: `Failed ${options.toolName}: ${err instanceof Error ? err.message : String(err)}`,
            severity: 'medium',
          })
          .catch(() => undefined);
      }
      throw err;
    }
  };
}
