interface PresetRow {
  preset: string;
  yours: string;
  community: string;
  note: string;
}

export const PRESET_ROWS: readonly PresetRow[] = [
  {
    preset: "categorized",
    yours: "monalisa/source/api",
    community: "community/acme/source/api",
    note: "category is source, forks, or archived (archived wins over fork)",
  },
  {
    preset: "flat-by-owner",
    yours: "monalisa/api",
    community: "community/acme/api",
    note: "one directory per owner, nothing else",
  },
  {
    preset: "topic-focused",
    yours: "monalisa/TypeScript/web",
    community: "community/acme/Go/service",
    note: "language segment, or other when the language is unknown",
  },
  {
    preset: "language-first",
    yours: "TypeScript/monalisa/api",
    community: "community/Go/acme/service",
    note: "language segment first, or other when the language is unknown",
  },
  {
    preset: "category-first",
    yours: "source/monalisa/api",
    community: "community/forks/acme/left-pad",
    note: "category is source, forks, or archived (archived wins over fork)",
  },
  {
    preset: "language-categorized",
    yours: "monalisa/source/TypeScript/api",
    community: "community/acme/forks/Go/cli",
    note: "category plus language segment in one layout",
  },
  {
    preset: "flat",
    yours: "api",
    community: "community/service",
    note: "flat layout with no subdirectories",
  },
  {
    preset: "category-flat",
    yours: "source/api",
    community: "community/forks/left-pad",
    note: "grouped purely by category",
  },
  {
    preset: "language-flat",
    yours: "TypeScript/api",
    community: "community/Go/service",
    note: "grouped purely by programming language",
  },
  {
    preset: "category-language",
    yours: "source/TypeScript/api",
    community: "community/forks/JavaScript/left-pad",
    note: "category first, then programming language",
  },
  {
    preset: "language-category",
    yours: "TypeScript/source/api",
    community: "community/Go/source/service",
    note: "programming language first, then category",
  },
  {
    preset: "owner-language-category",
    yours: "monalisa/TypeScript/source/api",
    community: "community/acme/Go/source/service",
    note: "owner first, then language, then category",
  },
  {
    preset: "category-owner-language",
    yours: "source/monalisa/TypeScript/api",
    community: "community/forks/acme/JavaScript/left-pad",
    note: "category first, then owner, then language",
  },
  {
    preset: "category-language-owner",
    yours: "source/TypeScript/monalisa/api",
    community: "community/source/Go/acme/service",
    note: "category first, then language, then owner",
  },
  {
    preset: "language-owner-category",
    yours: "TypeScript/monalisa/source/api",
    community: "community/Go/acme/source/service",
    note: "language first, then owner, then category",
  },
  {
    preset: "language-category-owner",
    yours: "TypeScript/source/monalisa/api",
    community: "community/Go/source/acme/service",
    note: "language first, then category, then owner",
  },
];

export function PresetTable() {
  return (
    <section className="section" id="presets" aria-label="Presets">
      <h2>Presets</h2>
      <p className="section-sub">
        Pick a layout per workspace. Repositories that are not yours always get a community/ prefix,
        in every preset.
      </p>
      <div className="panel">
        <span className="panel-label">Layouts</span>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Preset</th>
              <th scope="col">Your repository</th>
              <th scope="col">Community repository</th>
              <th scope="col">Segment</th>
            </tr>
          </thead>
          <tbody>
            {PRESET_ROWS.map((row) => (
              <tr key={row.preset}>
                <td data-label="Preset">{row.preset}</td>
                <td data-label="Your repository" className="path">
                  {row.yours}
                </td>
                <td data-label="Community repository" className="path">
                  {row.community}
                </td>
                <td data-label="Segment">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <span className="panel-label">Custom presets</span>
        <p className="section-sub">
          Define your own layout from the four segment tokens — <code>owner</code>,{" "}
          <code>category</code>, <code>language</code>, <code>name</code> (name must come last) —
          with <code>repotruck preset add lang-owner language owner name</code>. The preset is
          stored in <code>settings.json</code> and works everywhere a built-in id is accepted:
          <code> sync -p</code>, <code>clone -p</code>, <code>reorganize</code>, the dashboard and
          the MCP tools. <code>repotruck preset list</code> shows built-ins plus your customs;
          <code> repotruck preset remove &lt;id&gt;</code> deletes one.
        </p>
      </div>
    </section>
  );
}
