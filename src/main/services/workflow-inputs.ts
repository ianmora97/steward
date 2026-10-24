import { parse } from 'yaml';
import {
  WORKFLOW_INPUT_MAX_CHARS,
  WORKFLOW_INPUT_MAX_COUNT,
  WORKFLOW_INPUT_NAME,
  type WorkflowInputSpec
} from '@shared/schemas/deployments';
import { StewardServiceError } from '@shared/types/result';

const MAX_DESCRIPTION_CHARS = 500;
const TYPES: readonly WorkflowInputSpec['type'][] = ['string', 'boolean', 'choice', 'number', 'environment'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Scalars only: a default or an option that is a nested structure is not something a form field can hold. */
function asText(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : null;
}

function notDispatchable(): StewardServiceError {
  return new StewardServiceError(
    'WORKFLOW_NOT_DISPATCHABLE',
    'this workflow cannot be started by hand',
    'Add `workflow_dispatch:` under `on:` in the workflow file.'
  );
}

/**
 * Reads `on.workflow_dispatch.inputs` out of a workflow file. The file comes
 * from the repository, so it is untrusted: it is only parsed, never executed,
 * and nothing from it is put into an error message.
 */
export function parseWorkflowInputs(yamlText: string): WorkflowInputSpec[] {
  let document: unknown;
  try {
    document = parse(yamlText, { maxAliasCount: 50 });
  } catch {
    throw new StewardServiceError('WORKFLOW_NOT_DISPATCHABLE', 'that workflow file is not valid YAML');
  }

  const root = asRecord(document);
  if (root === null) throw notDispatchable();
  // YAML 1.1 reads a bare `on` as the boolean true; the library follows 1.2, but a file can still end up under "true".
  const triggers = root.on ?? root.true;

  let dispatch: Record<string, unknown> | null;
  if (triggers === 'workflow_dispatch') {
    dispatch = {};
  } else if (Array.isArray(triggers) && triggers.includes('workflow_dispatch')) {
    dispatch = {};
  } else {
    const map = asRecord(triggers);
    if (map === null || !Object.hasOwn(map, 'workflow_dispatch')) throw notDispatchable();
    dispatch = asRecord(map.workflow_dispatch) ?? {};
  }

  const inputs = asRecord(dispatch.inputs) ?? {};
  const specs: WorkflowInputSpec[] = [];
  for (const [name, raw] of Object.entries(inputs)) {
    // A name GitHub would not accept back cannot be sent, so it is not offered.
    if (!WORKFLOW_INPUT_NAME.test(name)) continue;
    const input = asRecord(raw) ?? {};
    const declared = typeof input.type === 'string' ? input.type : 'string';
    const type = TYPES.find((candidate) => candidate === declared) ?? 'string';
    const options = Array.isArray(input.options)
      ? input.options.flatMap((option) => {
          const text = asText(option);
          return text === null ? [] : [text];
        })
      : [];
    specs.push({
      name,
      description: typeof input.description === 'string' ? input.description.slice(0, MAX_DESCRIPTION_CHARS) : null,
      required: input.required === true,
      type,
      default: asText(input.default),
      options
    });
    if (specs.length >= WORKFLOW_INPUT_MAX_COUNT) break;
  }
  return specs;
}

function invalid(name: string, why: string): StewardServiceError {
  return new StewardServiceError('INPUT_INVALID', `the input "${name}" ${why}`);
}

/**
 * Checks what the user typed against what the workflow declares and returns the
 * values to send. An empty value falls back to the workflow's own default; an
 * input the workflow does not declare is refused rather than passed along.
 */
export function validateWorkflowInputs(
  specs: readonly WorkflowInputSpec[],
  values: Record<string, string>
): Record<string, string> {
  const names = Object.keys(values);
  if (names.length > WORKFLOW_INPUT_MAX_COUNT) {
    throw new StewardServiceError('INPUT_INVALID', 'too many inputs');
  }
  const known = new Set(specs.map((spec) => spec.name));
  for (const name of names) {
    if (!known.has(name)) throw invalid(name, 'is not declared by this workflow');
  }

  const result: Record<string, string> = {};
  for (const spec of specs) {
    const given = values[spec.name];
    const value = given !== undefined && given !== '' ? given : spec.default;
    if (value === null || value === undefined) {
      if (spec.required) throw invalid(spec.name, 'is required');
      continue;
    }
    if (spec.type === 'boolean' && value !== 'true' && value !== 'false') {
      throw invalid(spec.name, 'must be true or false');
    }
    if (spec.type === 'number' && (value.trim() === '' || !Number.isFinite(Number(value)))) {
      throw invalid(spec.name, 'must be a number');
    }
    if (spec.type === 'choice' && spec.options.length > 0 && !spec.options.includes(value)) {
      throw invalid(spec.name, 'must be one of the listed options');
    }
    if (value.length > WORKFLOW_INPUT_MAX_CHARS) {
      throw invalid(spec.name, `is longer than ${WORKFLOW_INPUT_MAX_CHARS} characters`);
    }
    result[spec.name] = value;
  }
  return result;
}
