export interface ReleaseItem {
  /** The milestone or area in bold at the start of the line (`M11.5`, `Tooling`), if any. */
  tag: string | null;
  text: string;
}

export interface ReleaseCategory {
  name: string;
  items: ReleaseItem[];
}

export interface Release {
  /** `Unreleased` or a version number. */
  title: string;
  date: string | null;
  categories: ReleaseCategory[];
}

/** Reads CHANGELOG.md (Keep a Changelog): `## [version] - date`, `### Category`, then `- **tag** text` lines. */
export function parseChangelog(source: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let category: ReleaseCategory | null = null;
  let item: ReleaseItem | null = null;

  for (const line of source.split(/\r?\n/)) {
    const heading = /^##\s+\[?([^\]\s]+)\]?(?:\s+[-–]\s+(.+))?\s*$/.exec(line);
    if (heading !== null && !line.startsWith('###')) {
      release = { title: heading[1] ?? '', date: heading[2]?.trim() ?? null, categories: [] };
      releases.push(release);
      category = null;
      item = null;
      continue;
    }
    const categoryHeading = /^###\s+(.+?)\s*$/.exec(line);
    if (categoryHeading !== null && release !== null) {
      category = { name: categoryHeading[1] ?? '', items: [] };
      release.categories.push(category);
      item = null;
      continue;
    }
    const bullet = /^-\s+(.*)$/.exec(line);
    if (bullet !== null && category !== null) {
      const body = bullet[1] ?? '';
      const tagged = /^\*\*([^*]{1,16})\*\*\s+(.*)$/.exec(body);
      item = tagged !== null ? { tag: tagged[1] ?? null, text: tagged[2] ?? '' } : { tag: null, text: body };
      category.items.push(item);
      continue;
    }
    // A wrapped line belongs to the bullet above it.
    if (item !== null && /^\s+\S/.test(line)) item.text += ` ${line.trim()}`;
    else if (line.trim() === '') item = null;
  }

  return releases.filter((entry) => entry.categories.some((entryCategory) => entryCategory.items.length > 0));
}
