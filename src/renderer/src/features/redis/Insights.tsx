import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RedisClientEntry,
  RedisConfigEntry,
  RedisConnection,
  RedisInfoSnapshot,
  RedisMemoryReport,
  RedisSlowlogEntry
} from '@shared/schemas/redis';
import type { StewardError } from '@shared/types/result';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Badge } from '../../components/Badge';
import { useRedisStore } from '../../stores/redis.store';
import { formatBytes, formatCount, formatDuration, typeLabel } from './redis-meta';
import { Button } from '../../components/Button';
import { toast } from '../../stores/toast.store';
import { Loading } from '../../components/Loading';

type Section = 'dashboard' | 'slowlog' | 'clients' | 'memory' | 'config';

const SECTION_LABEL: Record<Section, string> = {
  dashboard: 'Dashboard',
  slowlog: 'Slow log',
  clients: 'Clients',
  memory: 'Memory analysis',
  config: 'Configuration'
};

const POLL_MS = 2000;
const POLL_MAX_MS = 30_000;
const NO_SNAPSHOTS: RedisInfoSnapshot[] = [];

function Sparkline({ values, label }: { values: number[]; label: string }): React.JSX.Element {
  if (values.length < 2) return <svg className="rdspark" viewBox="0 0 100 30" role="img" aria-label={`${label}: not enough samples yet`} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${((index / (values.length - 1)) * 100).toFixed(1)},${(28 - ((value - min) / span) * 26).toFixed(1)}`).join(' ');
  return (
    <svg className="rdspark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label={`${label}, last ${values.length} samples`}>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Tile({ title, value, hint, values }: { title: string; value: string; hint?: string; values?: number[] }): React.JSX.Element {
  return (
    <div className="rdtile">
      <span className="rdtile__title">{title}</span>
      <span className="rdtile__value">{value}</span>
      {hint !== undefined && <span className="card__hint">{hint}</span>}
      {values !== undefined && <Sparkline values={values} label={title} />}
    </div>
  );
}

function Dashboard({ connection, onError }: { connection: RedisConnection; onError: (error: StewardError) => void }): React.JSX.Element {
  const snapshots = useRedisStore((state) => state.info[connection.id]) ?? NO_SNAPSHOTS;
  const pushInfo = useRedisStore((state) => state.pushInfo);
  const clearInfo = useRedisStore((state) => state.clearInfo);
  const [failing, setFailing] = useState(false);
  const delay = useRef(POLL_MS);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
      // A hidden window does not need a sample every two seconds.
      if (document.visibilityState === 'visible') {
        const result = await window.steward.redis.info({ id: connection.id });
        if (stopped) return;
        if (result.success) {
          pushInfo(connection.id, result.data);
          delay.current = POLL_MS;
          setFailing(false);
        } else {
          delay.current = Math.min(delay.current * 2, POLL_MAX_MS);
          setFailing(true);
          if (delay.current === POLL_MS * 2) onError(result.error);
        }
      }
      if (!stopped) timer = setTimeout(() => void tick(), delay.current);
    }

    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [connection.id, pushInfo, onError]);

  const latest = snapshots[snapshots.length - 1];
  const series = useMemo(
    () => ({
      ops: snapshots.map((snapshot) => snapshot.opsPerSec),
      memory: snapshots.map((snapshot) => snapshot.usedMemory),
      clients: snapshots.map((snapshot) => snapshot.connectedClients)
    }),
    [snapshots]
  );

  if (latest === undefined) return <Loading lines={4} label="Reading the server…" />;

  const lookups = latest.keyspaceHits + latest.keyspaceMisses;
  const hitRate = lookups === 0 ? null : (latest.keyspaceHits / lookups) * 100;
  const keys = latest.keyspace.reduce((sum, db) => sum + db.keys, 0);

  return (
    <div className="rddash">
      <div className="rddash__bar">
        <Badge tone={latest.role === 'master' ? 'success' : 'warning'}>{latest.role}</Badge>
        <span className="card__hint">Redis {latest.version} · up {formatDuration(latest.uptimeSeconds)}</span>
        {failing && <Badge tone="failure" icon="alert">Not answering; trying again</Badge>}
        <span className="dpitem__spacer" />
        <Button size="sm" onClick={() => clearInfo(connection.id)}>
          Clear samples
        </Button>
      </div>

      <div className="rdtiles">
        <Tile title="Operations / s" value={formatCount(latest.opsPerSec)} values={series.ops} />
        <Tile title="Memory used" value={formatBytes(latest.usedMemory)} hint={`RSS ${formatBytes(latest.usedMemoryRss)} · max ${latest.maxMemory === 0 ? 'unlimited' : formatBytes(latest.maxMemory)}`} values={series.memory} />
        <Tile title="Clients" value={formatCount(latest.connectedClients)} hint={`${latest.blockedClients} blocked`} values={series.clients} />
        <Tile title="Hit rate" value={hitRate === null ? '—' : `${hitRate.toFixed(1)} %`} hint={`${formatCount(latest.keyspaceHits)} hits · ${formatCount(latest.keyspaceMisses)} misses`} />
        <Tile title="Keys" value={formatCount(keys)} hint={latest.keyspace.map((db) => `${db.db}: ${formatCount(db.keys)}`).join(' · ') || 'No keys'} />
        <Tile title="Expired / evicted" value={`${formatCount(latest.expiredKeys)} / ${formatCount(latest.evictedKeys)}`} hint="since the server started" />
        <Tile title="Replicas" value={formatCount(latest.connectedReplicas)} />
        <Tile
          title="Persistence"
          value={latest.persistence.aofEnabled ? 'AOF on' : 'AOF off'}
          hint={`RDB ${latest.persistence.rdbLastStatus}${latest.persistence.lastSaveTime > 0 ? ` · saved ${new Date(latest.persistence.lastSaveTime * 1000).toLocaleString()}` : ''}`}
        />
      </div>
      <p className="card__hint">Samples are taken every two seconds while this view is open and kept for about five minutes. Nothing is stored.</p>
    </div>
  );
}

function SlowLog({ connection, writable, onError }: { connection: RedisConnection; writable: boolean; onError: (error: StewardError) => void }): React.JSX.Element {
  const [entries, setEntries] = useState<RedisSlowlogEntry[] | null>(null);
  const [resetting, setResetting] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void window.steward.redis.slowlog({ id: connection.id }).then((result) => {
      if (cancelled) return;
      if (result.success) setEntries(result.data);
      else {
        setEntries([]);
        onError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, version, onError]);

  return (
    <div className="rdsection">
      <div className="rdsection__bar">
        <span className="card__hint">The 128 most recent commands that took longer than the server's slowlog-log-slower-than.</span>
        <span className="dpitem__spacer" />
        <Button size="sm" onClick={() => setVersion((value) => value + 1)}>
          <Icon name="refresh" size={14} /> Refresh
        </Button>
        <Button size="sm" dangerText disabled={!writable || entries === null || entries.length === 0} title={writable ? undefined : 'Read-only connection'} onClick={() => setResetting(true)}>
          Reset
        </Button>
      </div>
      {entries === null && <Loading variant="line" lines={4} label="Reading the slow log…" />}
      {entries !== null && entries.length === 0 && <p className="card__hint">The slow log is empty.</p>}
      {entries !== null && entries.length > 0 && (
        <table className="rdtable">
          <thead><tr><th>When</th><th>Duration</th><th>Command</th><th>Client</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="dpmono">{new Date(entry.at).toLocaleString()}</td>
                <td className="dpmono">{entry.durationMicros >= 1000 ? `${(entry.durationMicros / 1000).toFixed(1)} ms` : `${entry.durationMicros} µs`}</td>
                <td className="dpmono rdcell--wrap">{entry.command}</td>
                <td className="dpmono">{entry.client}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {resetting && (
        <ConfirmDialog
          title="Reset the slow log?"
          confirmLabel="Reset"
          onCancel={() => setResetting(false)}
          onConfirm={() => {
            setResetting(false);
            void window.steward.redis.resetSlowlog({ connectionId: connection.id, confirmed: true }).then((result) => {
              if (result.success) {
                toast.success('Slow log reset');
                setVersion((value) => value + 1);
              } else onError(result.error);
            });
          }}
        >
          <p>The server forgets every entry. This cannot be undone.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Clients({ connection, onError }: { connection: RedisConnection; onError: (error: StewardError) => void }): React.JSX.Element {
  const [clients, setClients] = useState<RedisClientEntry[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void window.steward.redis.clients({ id: connection.id }).then((result) => {
      if (cancelled) return;
      if (result.success) setClients(result.data);
      else {
        setClients([]);
        onError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, version, onError]);

  return (
    <div className="rdsection">
      <div className="rdsection__bar">
        <span className="card__hint">{clients === null ? 'Reading clients…' : `${clients.length} client${clients.length === 1 ? '' : 's'} connected`}</span>
        <span className="dpitem__spacer" />
        <Button size="sm" onClick={() => setVersion((value) => value + 1)}>
          <Icon name="refresh" size={14} /> Refresh
        </Button>
      </div>
      {clients !== null && clients.length > 0 && (
        <table className="rdtable">
          <thead><tr><th>ID</th><th>Address</th><th>Name</th><th>Age</th><th>Idle</th><th>DB</th><th>Last command</th><th>Flags</th></tr></thead>
          <tbody>
            {clients.map((client) => (
              <tr key={client.id}>
                <td className="dpmono">{client.id}</td>
                <td className="dpmono">{client.address}</td>
                <td>{client.name}</td>
                <td>{formatDuration(client.ageSeconds)}</td>
                <td>{formatDuration(client.idleSeconds)}</td>
                <td className="dpmono">{client.db}</td>
                <td className="dpmono">{client.command}</td>
                <td className="dpmono">{client.flags}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Config({ connection, onError }: { connection: RedisConnection; onError: (error: StewardError) => void }): React.JSX.Element {
  const [entries, setEntries] = useState<RedisConfigEntry[] | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    void window.steward.redis.config({ id: connection.id }).then((result) => {
      if (cancelled) return;
      if (result.success) setEntries(result.data);
      else {
        setEntries([]);
        onError(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection.id, onError]);

  const needle = filter.trim().toLowerCase();
  const visible = (entries ?? []).filter((entry) => needle === '' || entry.name.toLowerCase().includes(needle) || entry.value.toLowerCase().includes(needle));

  return (
    <div className="rdsection">
      <div className="rdsection__bar">
        <label className="dksearch">
          <Icon name="search" size={14} />
          <input className="field__input" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter settings" aria-label="Filter settings" />
        </label>
        <span className="card__hint">Read only. Passwords are hidden. Change a setting from the Workbench with CONFIG SET.</span>
      </div>
      {entries === null && <Loading variant="line" lines={5} label="Reading the configuration…" />}
      {entries !== null && visible.length === 0 && <p className="card__hint">{entries.length === 0 ? 'The server did not return its configuration (CONFIG may be disabled).' : 'No settings match.'}</p>}
      {visible.length > 0 && (
        <table className="rdtable">
          <thead><tr><th>Setting</th><th>Value</th></tr></thead>
          <tbody>
            {visible.map((entry) => (
              <tr key={entry.name}>
                <td className="dpmono">{entry.name}</td>
                <td className="dpmono rdcell--wrap">{entry.value === '' ? <span className="card__hint">empty</span> : entry.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Bars({ title, rows, total }: { title: string; rows: { name: string; keys: number; bytes: number }[]; total: number }): React.JSX.Element {
  return (
    <div className="rdbars">
      <h4 className="rdwork__side-title">{title}</h4>
      <table className="rdtable">
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="dpmono">{row.name}</td>
              <td className="rdbars__cell">
                <span className="rdbars__bar" style={{ width: `${total === 0 ? 0 : Math.max(2, (row.bytes / total) * 100)}%` }} />
              </td>
              <td>{formatBytes(row.bytes)}</td>
              <td className="card__hint">{formatCount(row.keys)} keys</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MemoryAnalysis({ connection, onError }: { connection: RedisConnection; onError: (error: StewardError) => void }): React.JSX.Element {
  const [report, setReport] = useState<RedisMemoryReport | null>(null);
  const [sample, setSample] = useState(1000);
  const [pattern, setPattern] = useState('');
  const [busy, setBusy] = useState(false);

  const analyze = useCallback(async (): Promise<void> => {
    setBusy(true);
    const result = await window.steward.redis.analyzeMemory({
      connectionId: connection.id,
      sample,
      ...(pattern.trim() === '' ? {} : { pattern: pattern.trim() })
    });
    setBusy(false);
    if (result.success) setReport(result.data);
    else onError(result.error);
  }, [connection.id, sample, pattern, onError]);

  return (
    <div className="rdsection">
      <div className="rdsection__bar">
        <label className="field rdsection__inline">
          <span className="field__label">Sample</span>
          <select className="field__input" value={sample} onChange={(event) => setSample(Number(event.target.value))}>
            {[500, 1000, 2500, 5000].map((value) => (
              <option key={value} value={value}>{formatCount(value)} keys</option>
            ))}
          </select>
        </label>
        <label className="field rdsection__inline">
          <span className="field__label">Pattern</span>
          <input className="field__input" value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder="*" spellCheck={false} />
        </label>
        <Button variant="primary" loading={busy} loadingLabel="Measuring…" onClick={() => void analyze()}>Analyze</Button>
      </div>
      {report === null ? (
        <EmptyState title="Where is the memory going?" description="Steward measures a sample of keys with MEMORY USAGE and groups them by prefix and type. It is an estimate of the sample, not an inventory." />
      ) : (
        <>
          <p className="card__hint">
            <Icon name="alert" size={12} /> A <strong>sample</strong>: {formatCount(report.sampled)} of ≈ {formatCount(report.dbSize)} keys, {formatBytes(report.totalBytes)} measured. Totals are not the size of the database.
          </p>
          <div className="rdbars__grid">
            <Bars title="By prefix" rows={report.byPrefix} total={report.totalBytes} />
            <Bars title="By type" rows={report.byType.map((row) => ({ ...row, name: typeLabel(row.name) }))} total={report.totalBytes} />
          </div>
          <h4 className="rdwork__side-title">Biggest keys in the sample</h4>
          <table className="rdtable">
            <thead><tr><th>Key</th><th>Type</th><th>Size</th></tr></thead>
            <tbody>
              {report.top.map((row) => (
                <tr key={row.key}>
                  <td className="dpmono rdcell--wrap">{row.key}</td>
                  <td>{typeLabel(row.type)}</td>
                  <td>{formatBytes(row.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function Insights({
  connection,
  writable,
  onError
}: {
  connection: RedisConnection;
  writable: boolean;
  onError: (error: StewardError) => void;
}): React.JSX.Element {
  const [section, setSection] = useState<Section>('dashboard');
  return (
    <div className="rdinsights">
      <nav className="subtabs" aria-label="Insights">
        {(Object.keys(SECTION_LABEL) as Section[]).map((value) => (
          <button key={value} type="button" className={`subtabs__tab${section === value ? ' subtabs__tab--active' : ''}`} onClick={() => setSection(value)}>
            {SECTION_LABEL[value]}
          </button>
        ))}
      </nav>
      <div className="rdinsights__body">
        {section === 'dashboard' && <Dashboard connection={connection} onError={onError} />}
        {section === 'slowlog' && <SlowLog connection={connection} writable={writable} onError={onError} />}
        {section === 'clients' && <Clients connection={connection} onError={onError} />}
        {section === 'memory' && <MemoryAnalysis connection={connection} onError={onError} />}
        {section === 'config' && <Config connection={connection} onError={onError} />}
      </div>
    </div>
  );
}
