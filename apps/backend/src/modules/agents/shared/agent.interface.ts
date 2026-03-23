export interface AgentInput {
  userId: string;
}

export interface AgentStep {
  name: string;
  kind: 'db' | 'ai' | 'validation' | 'subagent';
  durationMs: number;
  summary?: string;
}

export interface IAgent<TInput extends AgentInput, TOutput> {
  run(input: TInput): Promise<TOutput>;
}
