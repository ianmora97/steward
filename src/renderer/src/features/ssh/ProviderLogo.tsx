import type { SshProvider } from '@shared/schemas/ssh';
import { Icon, type IconName } from '../../components/Icon';
import { PROVIDER_LABELS } from './ssh-meta';

/**
 * AWS's lowercase wordmark with the orange smile, drawn here in AWS's own palette (squid ink, orange).
 * It is a drawing of the mark, not a downloaded asset, so it scales cleanly and needs no file.
 */
function AwsMark({ height }: { height: number }): React.JSX.Element {
  return (
    <svg className="provider__aws" viewBox="0 0 52 30" height={height} width={(height * 52) / 30} role="img" aria-label="AWS">
      <rect width="52" height="30" rx="6" fill="#232f3e" />
      <text
        x="26"
        y="15.5"
        textAnchor="middle"
        fill="#ffffff"
        fontFamily="'Amazon Ember', 'Segoe UI', Arial, sans-serif"
        fontSize="15.5"
        fontWeight="800"
        letterSpacing="-0.6"
      >
        aws
      </text>
      <path d="M9 20.2c10.5 5.1 23.5 5 34-.4" fill="none" stroke="#ff9900" strokeWidth="2.3" strokeLinecap="round" />
      <path d="M38.6 16.6 43.4 19.8 39.2 23.4" fill="none" stroke="#ff9900" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const OTHER: Record<Exclude<SshProvider, 'aws'>, { color: string; icon: IconName }> = {
  digitalocean: { color: '#0080ff', icon: 'droplet' },
  gcp: { color: '#4285f4', icon: 'cloud' },
  azure: { color: '#0078d4', icon: 'cloud' },
  hetzner: { color: '#d50c2d', icon: 'hardDrive' },
  linode: { color: '#02b159', icon: 'ssh' },
  vultr: { color: '#007bfc', icon: 'zap' },
  on_prem: { color: '#8d9ab3', icon: 'building' },
  other: { color: '#8d9ab3', icon: 'cloud' }
};

/** A provider's mark: AWS gets its logo, the rest a coloured chip with their name. */
export function ProviderLogo({ provider, height = 22 }: { provider: SshProvider; height?: number }): React.JSX.Element {
  if (provider === 'aws') return <AwsMark height={height} />;
  const { color, icon } = OTHER[provider];
  return (
    <span
      className="provider__chip"
      style={{ ['--provider' as string]: color, height }}
      title={PROVIDER_LABELS[provider]}
    >
      <Icon name={icon} size={Math.round(height * 0.55)} />
      {PROVIDER_LABELS[provider]}
    </span>
  );
}
