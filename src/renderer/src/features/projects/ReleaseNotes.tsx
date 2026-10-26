import { useMemo } from 'react';
import changelog from '@root/CHANGELOG.md?raw';
import { Badge, type BadgeTone } from '../../components/Badge';
import { Modal } from '../../components/Modal';
import { parseChangelog, type Release } from './release-notes';
import './release-notes.css';

const CATEGORY_TONE: Record<string, BadgeTone> = {
  Added: 'success',
  Changed: 'info',
  Fixed: 'warning',
  Removed: 'failure',
  Security: 'merged'
};

/** `**bold**`, `*italic*`, `code` and `[text](link)` inside a changelog line. Links show their text only: nothing here navigates. */
function Inline({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={index}>{part.slice(1, -1)}</code>;
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>;
        const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(part);
        return <span key={index}>{link !== null ? link[1] : part}</span>;
      })}
    </>
  );
}

function ReleaseBlock({ release }: { release: Release }): React.JSX.Element {
  return (
    <section className="relnotes__release">
      <h4 className="relnotes__title">
        {release.title}
        {release.date !== null && <span className="relnotes__date">{release.date}</span>}
      </h4>
      {release.categories
        .filter((category) => category.items.length > 0)
        .map((category) => (
          <div key={category.name} className="relnotes__category">
            <Badge tone={CATEGORY_TONE[category.name] ?? 'neutral'}>{category.name}</Badge>
            <ul className="relnotes__list">
              {category.items.map((item, index) => (
                <li key={index} className="relnotes__item">
                  {item.tag !== null && <span className="relnotes__tag">{item.tag}</span>}
                  <span>
                    <Inline text={item.text} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

/** What changed, read from CHANGELOG.md when Steward was built. */
export function ReleaseNotes({ version, onClose }: { version: string | null; onClose: () => void }): React.JSX.Element {
  const releases = useMemo(() => parseChangelog(changelog), []);

  return (
    <Modal title="Release notes" className="relnotes" onClose={onClose}>
      {version !== null && <p className="relnotes__current">You are on Steward {version}.</p>}
      <div className="relnotes__scroll">
        {releases.length === 0 ? <p className="card__hint">No release notes yet.</p> : releases.map((release) => <ReleaseBlock key={release.title} release={release} />)}
      </div>
    </Modal>
  );
}
