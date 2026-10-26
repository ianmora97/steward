import type { IconName } from './Icon';

/** What an environment can be marked with, in Settings and wherever environments are listed. */
export const ENVIRONMENT_ICONS: readonly IconName[] = [
  'shieldCheck',
  'shield',
  'deployments',
  'flame',
  'flask',
  'bug',
  'code',
  'laptop',
  'monitor',
  'home',
  'cloud',
  'globe',
  'ssh',
  'cpu',
  'database',
  'box',
  'layers',
  'hardDrive',
  'zap',
  'target',
  'flag',
  'star',
  'crown',
  'lifebuoy',
  'plane',
  'anchor',
  'users',
  'eye',
  'archive',
  'building',
  'smartphone',
  'sparkles'
];

type EnvironmentFamily = 'production' | 'staging' | 'testing' | 'development' | 'local' | 'demo' | 'other';

const FAMILIES: Array<{ family: EnvironmentFamily; names: string[] }> = [
  { family: 'production', names: ['prod', 'production', 'live'] },
  { family: 'staging', names: ['stage', 'staging', 'preprod', 'pre-prod'] },
  { family: 'testing', names: ['qa', 'test', 'testing', 'uat'] },
  { family: 'development', names: ['dev', 'development'] },
  { family: 'local', names: ['local', 'localhost', 'laptop'] },
  { family: 'demo', names: ['demo', 'sandbox', 'preview'] }
];

function familyOf(name: string | null): EnvironmentFamily {
  const lowered = name?.trim().toLowerCase() ?? '';
  return FAMILIES.find((entry) => entry.names.includes(lowered))?.family ?? 'other';
}

const GUESSED_ICON: Record<EnvironmentFamily, IconName> = {
  production: 'shieldCheck',
  staging: 'flask',
  testing: 'bug',
  development: 'code',
  local: 'laptop',
  demo: 'sparkles',
  other: 'layers'
};

const TONE: Record<EnvironmentFamily, string> = {
  production: 'var(--danger)',
  staging: 'var(--warn)',
  testing: 'var(--merged)',
  development: 'var(--ok)',
  local: 'var(--accent)',
  demo: '#38a8e8',
  other: 'var(--text-muted)'
};

/** The icon the user picked, or one guessed from the name (Production, Staging, Local…). */
export function environmentIcon(name: string | null, chosen: string | null): IconName {
  if (chosen !== null && (ENVIRONMENT_ICONS as readonly string[]).includes(chosen)) return chosen as IconName;
  return GUESSED_ICON[familyOf(name)];
}

/** The colour an environment is drawn in: production red, staging amber, development green, local blue… */
export function environmentTone(name: string | null): string {
  return TONE[familyOf(name)];
}
