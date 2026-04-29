import { CommandAIFilterAdapter } from './ai/command-adapter';
import { buildHelpText, parseCliArgs } from './cli';
import { AIFileFilter } from './filters/ai-file-filter';
import { AISuggestionFilter } from './filters/ai-suggestion-filter';
import { PassthroughFileFilter } from './filters/passthrough-file-filter';
import { PassthroughSuggestionFilter } from './filters/passthrough-suggestion-filter';
import { writeManifest } from './reporting/manifest';
import { renderSummary } from './reporting/summary';
import { runImport } from './run-import';
import { AnalysisClient } from './server/analysis-client';
import { ApplyClient } from './server/apply-client';

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'CLI parse failed');
    console.error('');
    console.error(buildHelpText());
    process.exitCode = 1;
    return;
  }

  if (parsed.kind === 'help' || !parsed.options) {
    console.log(buildHelpText());
    return;
  }

  const options = parsed.options;
  const analysisClient = new AnalysisClient({
    backendUrl: options.backendUrl,
    token: options.token,
  });
  const applyClient = new ApplyClient({
    backendUrl: options.backendUrl,
    token: options.token,
  });
  const adapter =
    options.aiFilter && options.aiAdapter === 'command' && options.aiCommand
      ? new CommandAIFilterAdapter({
          command: options.aiCommand,
          timeoutMs: options.aiTimeoutMs,
        })
      : null;
  const fileFilter =
    adapter &&
    (options.aiFilterStage === 'file' || options.aiFilterStage === 'both') &&
    options.aiGoal
      ? new AIFileFilter({
          goal: options.aiGoal,
          adapter,
        })
      : new PassthroughFileFilter();
  const suggestionFilter =
    adapter &&
    (options.aiFilterStage === 'suggestion' ||
      options.aiFilterStage === 'both') &&
    options.aiGoal
      ? new AISuggestionFilter({
          goal: options.aiGoal,
          adapter,
        })
      : new PassthroughSuggestionFilter();

  const manifest = await runImport(options, {
    analysisClient,
    applyClient,
    fileFilter,
    suggestionFilter,
  });

  if (options.out) {
    await writeManifest(manifest, options.out);
    console.log(`Manifest written to ${options.out}`);
  }

  console.log(renderSummary(manifest));

  if (manifest.summary.hasFailures) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Fatal error');
  process.exitCode = 1;
});
