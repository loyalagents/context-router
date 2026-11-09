/** Explicit, non-listening C1 synthetic composition. Never registered in the app's Nest roots. */
import {
  SyntheticExperiment,
  resetSyntheticStore,
  type ExperimentOptions,
} from "../infrastructure/hcp-experiment/store";
import type {
  ExperimentPaths,
  Fault,
} from "../infrastructure/hcp-experiment/ownership";

// Deliberately exposes only operator fixture inspection and close; no raw DB, mutation,
// credentials, consent, query/get disclosures, network, model or legacy service handles.
function handle(store: SyntheticExperiment) {
  return Object.freeze({
    storeId: store.storeId,
    inspectEntries: () => store.inspectEntries(),
    inspectEntry: (id: string, version?: number) =>
      store.inspectEntry(id, version),
    inspectAudit: () => store.inspectAudit(),
    settings: () => store.settings(),
    close: () => store.close(),
  });
}
export function createSyntheticExperiment(
  paths: ExperimentPaths,
  options: ExperimentOptions = {},
) {
  return handle(SyntheticExperiment.create(paths, options));
}
export function openSyntheticExperiment(
  paths: ExperimentPaths,
  options: Omit<ExperimentOptions, "fixtures"> = {},
) {
  return handle(SyntheticExperiment.open(paths, options));
}
export function resetSyntheticExperiment(
  paths: ExperimentPaths,
  options: { fault?: Fault } = {},
) {
  resetSyntheticStore(paths, options.fault);
}
