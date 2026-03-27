import { Logger } from '@nestjs/common';
import { WorkflowStep } from './workflow.interface';

export class WorkflowStepRecorder {
  private readonly steps: WorkflowStep[] = [];
  private readonly logger: Logger;

  constructor(workflowName: string) {
    this.logger = new Logger(workflowName);
  }

  async record<T>(
    name: string,
    kind: WorkflowStep['kind'],
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const durationMs = Date.now() - start;

    const step: WorkflowStep = { name, kind, durationMs };
    this.steps.push(step);

    this.logger.debug(
      `Step "${name}" (${kind}) completed in ${durationMs}ms`,
    );

    return result;
  }

  getSteps(): ReadonlyArray<WorkflowStep> {
    return this.steps;
  }

  logSummary(): void {
    const totalMs = this.steps.reduce((sum, s) => sum + s.durationMs, 0);
    this.logger.debug(
      `Completed ${this.steps.length} steps in ${totalMs}ms: ${this.steps.map((s) => s.name).join(' → ')}`,
    );
  }
}
