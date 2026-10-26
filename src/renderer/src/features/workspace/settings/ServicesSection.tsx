import { OPTIONAL_TAB_KEYS, PINNED_TAB_KEYS, TAB_DESCRIPTIONS, type TabKey } from '@shared/schemas/tabs';
import { Icon } from '../../../components/Icon';
import { useAppStore } from '../../../stores/app.store';
import { tabIcon, tabLabel } from '../TabBar';

/**
 * Which services this project shows on its tab bar. Turning one off only takes it off the bar: its connections and
 * settings stay, and it comes back from the + menu or from here.
 */
export function ServicesSection(): React.JSX.Element {
  const tabs = useAppStore((state) => state.tabs);
  const busy = useAppStore((state) => state.busy);
  const moveService = useAppStore((state) => state.moveService);
  const setTabVisibility = useAppStore((state) => state.setTabVisibility);
  const restoreTabs = useAppStore((state) => state.restoreTabs);

  const optional = [...tabs].filter((tab) => OPTIONAL_TAB_KEYS.includes(tab.tabKey)).sort((a, b) => a.position - b.position);
  const visibleOnes = optional.filter((tab) => tab.visible);

  return (
    <div className="pset__stack">
      <section className="card">
        <h2 className="card__title">On the tab bar</h2>
        <p className="card__hint">Git and Terminal are always there. Add the services this project actually uses.</p>

        <ul className="pset__services">
          {PINNED_TAB_KEYS.map((key: TabKey) => (
            <li key={key} className="pset__service">
              <span className="pset__service-icon">
                <Icon name={tabIcon(key)} size={18} />
              </span>
              <span className="pset__service-text">
                <span className="pset__service-name">{tabLabel(key)}</span>
                <span className="card__hint">Always on the bar</span>
              </span>
            </li>
          ))}
          {optional.map((tab) => {
            const position = visibleOnes.findIndex((candidate) => candidate.tabKey === tab.tabKey);
            return (
              <li key={tab.id} className="pset__service">
                <span className="pset__service-icon">
                  <Icon name={tabIcon(tab.tabKey)} size={18} />
                </span>
                <span className="pset__service-text">
                  <span className="pset__service-name">{tabLabel(tab.tabKey)}</span>
                  <span className="card__hint">{TAB_DESCRIPTIONS[tab.tabKey]}</span>
                </span>
                {tab.visible && (
                  <span className="pset__service-order">
                    <button type="button" className="iconbutton" aria-label={`Move ${tabLabel(tab.tabKey)} earlier`} disabled={busy || position <= 0} onClick={() => void moveService(tab.tabKey, -1)}>
                      <Icon name="chevronUp" size={15} />
                    </button>
                    <button
                      type="button"
                      className="iconbutton"
                      aria-label={`Move ${tabLabel(tab.tabKey)} later`}
                      disabled={busy || position === visibleOnes.length - 1}
                      onClick={() => void moveService(tab.tabKey, 1)}
                    >
                      <Icon name="chevronDown" size={15} />
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={tab.visible}
                  aria-label={`Show ${tabLabel(tab.tabKey)} on the bar`}
                  className={`switch${tab.visible ? ' switch--on' : ''}`}
                  disabled={busy}
                  onClick={() => void setTabVisibility(tab.tabKey, !tab.visible)}
                >
                  <span className="switch__knob" />
                </button>
              </li>
            );
          })}
        </ul>

        <button type="button" className="button" onClick={() => void restoreTabs()} disabled={busy}>
          Reset the bar
        </button>
        <p className="card__hint">Resets to Git and Terminal only.</p>
      </section>
    </div>
  );
}
