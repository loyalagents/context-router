export interface WorkflowInput {
  userId: string;
}

export interface WorkflowStep {
  name: string;
  kind: 'db' | 'ai' | 'validation' | 'subworkflow';
  durationMs: number;
  summary?: string;
}

export interface IWorkflow<TInput extends WorkflowInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}
