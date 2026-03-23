import { Logger } from '@nestjs/common';
import { AgentStep } from './agent.interface';

export class AgentStepRecorder {
  private readonly steps: AgentStep[] = [];
  private readonly logger: Logger;

  constructor(agentName: string) {
    this.logger = new Logger(agentName);
  }

  async record<T>(
    name: string,
    kind: AgentStep['kind'],
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const durationMs = Date.now() - start;

    const step: AgentStep = { name, kind, durationMs };
    this.steps.push(step);

    this.logger.debug(
      `Step "${name}" (${kind}) completed in ${durationMs}ms`,
    );

    return result;
  }

  getSteps(): ReadonlyArray<AgentStep> {
    return this.steps;
  }

  logSummary(): void {
    const totalMs = this.steps.reduce((sum, s) => sum + s.durationMs, 0);
    this.logger.debug(
      `Completed ${this.steps.length} steps in ${totalMs}ms: ${this.steps.map((s) => s.name).join(' → ')}`,
    );
  }
}
