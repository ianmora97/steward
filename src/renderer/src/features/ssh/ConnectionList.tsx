import { useState } from 'react';
import type { SshHost } from '@shared/schemas/ssh';
import { Icon } from '../../components/Icon';
import { CONNECTION_LABEL, NO_ENVIRONMENT, groupByEnvironment, isProduction } from './ssh-meta';
import { Badge } from '../../components/Badge';

/** Saved connections, grouped by environment, with search and an environment filter. */
export function ConnectionList({
  hosts,
  activeHostIds,
  selection,
  onSelect
}: {
  hosts: SshHost[];
  /** Connections with a running shell. */
  activeHostIds: ReadonlySet<string>;
  selection: string | 'new' | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [environment, setEnvironment] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const environments = groupByEnvironment(hosts).flatMap((group) => (group.environment === null ? [] : [group.environment]));
  const needle = query.trim().toLowerCase();
  const visible = hosts.filter((host) => {
    if (environment !== '' && host.environment?.toLowerCase() !== environment.toLowerCase()) return false;
    if (needle === '') return true;
    return [host.name, host.vpcName, host.domain, host.ipAddress, host.host, host.region]
      .filter((part): part is string => part !== null)
      .some((part) => part.toLowerCase().includes(needle));
  });
  const groups = groupByEnvironment(visible);

  return (
    <aside className="sshlistpane" aria-label="Saved connections">
      <header className="sshlistpane__head">
        <h3 className="sshlistpane__title">Saved connections</h3>
        <span className="sshlistpane__count">{hosts.length}</span>
      </header>

      <div className="sshlistpane__tools">
        <label className="sshsearch">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a connection…"
            aria-label="Find a connection"
          />
        </label>
        <label className="sshfilter">
          <Icon name="filter" size={14} />
          <select value={environment} onChange={(event) => setEnvironment(event.target.value)} aria-label="Filter by environment">
            <option value="">All environments</option>
            {environments.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="sshgroups">
        {groups.length === 0 && (
          <p className="card__hint sshgroups__empty">
            {hosts.length === 0 ? 'No connections yet.' : 'No connection matches.'}
          </p>
        )}
        {groups.map((group) => {
          const key = group.environment ?? NO_ENVIRONMENT;
          const prod = isProduction(group.environment);
          const isCollapsed = collapsed[key] === true;
          return (
            <section key={key} className="sshgroup">
              <button
                type="button"
                className={`sshgroup__head${prod ? ' sshgroup__head--prod' : ''}`}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((current) => ({ ...current, [key]: !isCollapsed }))}
              >
                <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={13} />
                <span className="sshgroup__name">{key}</span>
                {prod && <Icon name="shield" size={14} />}
                <span className="sshgroup__count">{group.hosts.length}</span>
              </button>
              {!isCollapsed && (
                <ul className="sshitems">
                  {group.hosts.map((host) => {
                    const active = activeHostIds.has(host.id);
                    return (
                      <li key={host.id}>
                        <button
                          type="button"
                          className={`sshitem${host.id === selection ? ' sshitem--selected' : ''}`}
                          onClick={() => onSelect(host.id)}
                        >
                          <span className="sshitem__icon">
                            <Icon name="ssh" size={16} />
                          </span>
                          <span className="sshitem__body">
                            <span className="sshitem__name">{host.name}</span>
                            <span className="sshitem__vpc">{host.vpcName ?? host.domain ?? host.host}</span>
                            <span className="sshitem__foot">
                              <span className="sshitem__region">{host.region ?? ''}</span>
                              {active ? (
                                <Badge tone="info">SSH active</Badge>
                              ) : (
                                <span className={`sshitem__status sshitem__status--${host.connection.state}`}>
                                  {CONNECTION_LABEL[host.connection.state]}
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <footer className="sshlistpane__foot">
        <Icon name="lock" size={13} /> Stored locally in this project
      </footer>
    </aside>
  );
}
