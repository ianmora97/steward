import type { DeployTarget } from '@shared/schemas/deploy-targets';
import type { Deployment, DeploymentStartInput } from '@shared/schemas/deployments';
import type { DeploymentPatch, SettleOutcome } from '../db/deployment.repo';

/** What a runner gets to report progress and the outcome of one deployment. */
export interface DeploymentContext {
  deployment: Deployment;
  /** Progress only (running, the execution, the run found). Ignored once the deployment is settled. */
  update: (patch: DeploymentPatch) => void;
  /** Closes the deployment. The first call wins; later ones are ignored. */
  settle: (outcome: SettleOutcome) => void;
}

/**
 * A deployment that passed validation and is ready to run. `execute` holds the
 * validated data in its closure, so nothing the renderer sent is read again.
 */
export interface DeploymentLaunch {
  /** The branch or tag it will deploy; null when the kind has none. */
  ref: string | null;
  /** Never rejects on purpose: the service turns an unexpected throw into `unknown`. */
  execute: (context: DeploymentContext) => Promise<void>;
}

/** One per kind of target. Splitting by kind keeps the state machine and the evidence rule in the service. */
export interface DeploymentRunner {
  /** Validates and prepares. Throws `StewardServiceError` for anything the user can fix; nothing is recorded yet. */
  prepare: (target: DeployTarget, input: DeploymentStartInput) => Promise<DeploymentLaunch>;
  /** Picks up a deployment a previous run of the app left open. */
  resume?: (deployment: Deployment, context: DeploymentContext) => Promise<void>;
}
