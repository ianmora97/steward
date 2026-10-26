import { useEffect, useState } from 'react';
import type { Execution } from '@shared/schemas/git';
import type { SshCommandResult, SshHost, SshScanResult } from '@shared/schemas/ssh';
import type { StewardError } from '@shared/types/result';
import { ErrorBanner } from '../../components/ErrorBanner';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { destinationOf } from './ssh-meta';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Loading } from '../../components/Loading';
import { EXECUTION_STATUS } from '../../components/execution-status';
import { toast } from '../../stores/toast.store';

/** The decision point for an unknown host key: nothing is trusted unless this dialog's Trust button is clicked. */
export function HostKeyReview({
  host,
  onDone,
  onDecline
}: {
  host: SshHost;
  onDone: (updated: SshHost) => void;
  onDecline: () => void;
}): React.JSX.Element {
  const [scan, setScan] = useState<SshScanResult | null>(null);
  const [error, setError] = useState<StewardError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.steward.ssh.scanHostKey({ id: host.id }).then((result) => {
      if (cancelled) return;
      if (result.success) setScan(result.data);
      else setError(result.error);
    });
    return () => {
      cancelled = true;
    };
  }, [host.id]);

  async function trust(): Promise<void> {
    if (scan === null) return;
    setBusy(true);
    const result = await window.steward.ssh.trustHostKey({
      id: host.id,
      fingerprints: scan.keys.map((key) => key.fingerprint)
    });
    setBusy(false);
    if (result.success) {
      toast.success('Host key trusted');
      onDone(result.data);
    } else setError(result.error);
  }

  return (
    <Modal title={`Trust ${host.name}?`} className="dialog--ssh" onClose={onDecline}>
      <div className="sshreview">
        {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
        {scan === null && error === null && <Loading variant="line" lines={4} label="Fetching the host key…" />}
        {scan !== null && (
          <>
            <p>
              Steward is about to remember the key of{' '}
              <strong>
                {scan.hostname}:{scan.port}
              </strong>
              . Compare these fingerprints with the ones from the server's owner or provider before you trust it.
            </p>
            <ul className="sshreview__keys">
              {scan.keys.map((key) => (
                <li key={`${key.type}-${key.fingerprint}`}>
                  <Badge tone="neutral">{key.type}</Badge> <code>{key.fingerprint}</code>
                </li>
              ))}
            </ul>
            <p className="card__hint">Declining closes this dialog and nothing is saved.</p>
          </>
        )}
        <div className="dialog__actions">
          <Button onClick={onDecline}>
            Decline
          </Button>
          <Button variant="primary" disabled={scan === null || busy} onClick={() => void trust()}>
            Trust this host
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function CommandRunner({ host, onRan }: { host: SshHost; onRan: () => void }): React.JSX.Element {
  const [command, setCommand] = useState('');
  const [timeout, setTimeoutSeconds] = useState(30);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SshCommandResult | null>(null);
  const [error, setError] = useState<StewardError | null>(null);

  async function run(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setRunning(true);
    setResult(null);
    const outcome = await window.steward.ssh.runCommand({ id: host.id, command, timeoutSeconds: timeout });
    setRunning(false);
    if (outcome.success) {
      setError(null);
      setResult(outcome.data);
    } else {
      setError(outcome.error);
    }
    onRan();
  }

  return (
    <section className="sshrun">
      <h3 className="card__title">Run a command on {host.name}</h3>
      <p className="termnotice termnotice--remote">
        <Icon name="ssh" size={13} /> This runs on <strong>{destinationOf(host)}</strong>, not on this machine.
      </p>
      <form className="sshrun__form" onSubmit={(event) => void run(event)}>
        <input
          className="field__input field__input--grow sshrun__input"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="uptime"
          aria-label="Remote command"
          spellCheck={false}
        />
        <select
          className="field__input"
          value={timeout}
          onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
          aria-label="Timeout"
        >
          <option value={10}>10 s</option>
          <option value={30}>30 s</option>
          <option value={120}>2 min</option>
          <option value={300}>5 min</option>
        </select>
        <Button variant="primary" loading={running} loadingLabel="Running…" disabled={command.trim() === ''} type="submit">Run</Button>
      </form>
      {error !== null && <ErrorBanner error={error} onDismiss={() => setError(null)} />}
      {result !== null && (
        <div className="sshrun__result">
          <p className="activity__meta">
            <Badge tone={EXECUTION_STATUS[result.status].tone}>exit {result.exitCode}</Badge> {result.durationMs} ms
            {result.truncated ? ' · output truncated' : ''}
          </p>
          <h4 className="sshrun__label">stdout</h4>
          <pre className="sshrun__out">{result.stdout === '' ? '(empty)' : result.stdout}</pre>
          <h4 className="sshrun__label">stderr</h4>
          <pre className="sshrun__out sshrun__out--err">{result.stderr === '' ? '(empty)' : result.stderr}</pre>
        </div>
      )}
    </section>
  );
}

export function RemoteHistory({ executions }: { executions: Execution[] }): React.JSX.Element {
  if (executions.length === 0) return <p className="card__hint">Nothing has run on this host from Steward yet.</p>;
  return (
    <ul className="activity">
      {executions.map((execution) => (
        <li key={execution.id} className={`activity__item activity__item--${execution.status}`}>
          <div className="activity__head">
            <code className="activity__command">
              {execution.kind === 'ssh_command' ? (execution.args[1] ?? '') : execution.kind.replace('ssh_', '')}
            </code>
            <Badge tone={EXECUTION_STATUS[execution.status].tone}>{EXECUTION_STATUS[execution.status].label}</Badge>
            <Badge tone="neutral">remote</Badge>
          </div>
          <p className="activity__meta">
            {new Date(execution.startedAt).toLocaleString()} · {execution.durationMs ?? '?'} ms · exit{' '}
            {execution.exitCode ?? '—'}
          </p>
          {execution.errorMessage !== null && <p className="activity__error">{execution.errorMessage}</p>}
        </li>
      ))}
    </ul>
  );
}
