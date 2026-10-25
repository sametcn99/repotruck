type PresetId =
  | "categorized"
  | "flat-by-owner"
  | "topic-focused"
  | "language-first"
  | "category-first"
  | "language-categorized"
  | "flat"
  | "category-flat"
  | "language-flat"
  | "category-language"
  | "language-category"
  | "owner-language-category"
  | "category-owner-language"
  | "category-language-owner"
  | "language-owner-category"
  | "language-category-owner";

const PRESETS: readonly PresetId[] = [
  "categorized",
  "flat-by-owner",
  "topic-focused",
  "language-first",
  "category-first",
  "language-categorized",
  "flat",
  "category-flat",
  "language-flat",
  "category-language",
  "language-category",
  "owner-language-category",
  "category-owner-language",
  "category-language-owner",
  "language-owner-category",
  "language-category-owner",
];

type RepoCategory = "archived" | "forks" | "source";

interface ExampleRepo {
  owner: string;
  name: string;
  language: string | null;
  isFork: boolean;
  isArchived: boolean;
  internal: boolean;
}

const EXAMPLE_REPOS: readonly ExampleRepo[] = [
  {
    owner: "monalisa",
    name: "api",
    language: "TypeScript",
    isFork: false,
    isArchived: false,
    internal: true,
  },
  {
    owner: "monalisa",
    name: "legacy-tool",
    language: null,
    isFork: true,
    isArchived: true,
    internal: true,
  },
  {
    owner: "acme",
    name: "service",
    language: "Go",
    isFork: false,
    isArchived: false,
    internal: false,
  },
  {
    owner: "acme",
    name: "left-pad",
    language: "JavaScript",
    isFork: true,
    isArchived: false,
    internal: false,
  },
];

function repoCategory(repo: ExampleRepo): RepoCategory {
  if (repo.isArchived) return "archived";
  if (repo.isFork) return "forks";
  return "source";
}

function languageSegment(language: string | null): string {
  return language === null ? "other" : language;
}

function targetSegments(repo: ExampleRepo, preset: PresetId): string[] {
  const prefix = repo.internal ? [] : ["community"];
  const category = repoCategory(repo);
  const language = languageSegment(repo.language);
  switch (preset) {
    case "categorized":
      return [...prefix, repo.owner, category, repo.name];
    case "flat-by-owner":
      return [...prefix, repo.owner, repo.name];
    case "topic-focused":
      return [...prefix, repo.owner, language, repo.name];
    case "language-first":
      return [...prefix, language, repo.owner, repo.name];
    case "category-first":
      return [...prefix, category, repo.owner, repo.name];
    case "language-categorized":
      return [...prefix, repo.owner, category, language, repo.name];
    case "flat":
      return [...prefix, repo.name];
    case "category-flat":
      return [...prefix, category, repo.name];
    case "language-flat":
      return [...prefix, language, repo.name];
    case "category-language":
      return [...prefix, category, language, repo.name];
    case "language-category":
      return [...prefix, language, category, repo.name];
    case "owner-language-category":
      return [...prefix, repo.owner, language, category, repo.name];
    case "category-owner-language":
      return [...prefix, category, repo.owner, language, repo.name];
    case "category-language-owner":
      return [...prefix, category, language, repo.owner, repo.name];
    case "language-owner-category":
      return [...prefix, language, repo.owner, category, repo.name];
    case "language-category-owner":
      return [...prefix, language, category, repo.owner, repo.name];
  }
}

interface TreeNode {
  children: Map<string, TreeNode>;
}

interface TreeRow {
  key: string;
  indent: string;
  connector: string;
  name: string;
  leaf: boolean;
}

function compareNames(a: string, b: string): number {
  const caseInsensitive = a.toLowerCase().localeCompare(b.toLowerCase());
  if (caseInsensitive !== 0) return caseInsensitive;
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildTree(preset: PresetId): TreeRow[] {
  const root: TreeNode = { children: new Map() };
  for (const repo of EXAMPLE_REPOS) {
    let node = root;
    for (const segment of targetSegments(repo, preset)) {
      let child = node.children.get(segment);
      if (child === undefined) {
        child = { children: new Map() };
        node.children.set(segment, child);
      }
      node = child;
    }
  }
  const rows: TreeRow[] = [];
  const walk = (node: TreeNode, prefix: string, parentKey: string): void => {
    const names = [...node.children.keys()].sort(compareNames);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i]!;
      const child = node.children.get(name)!;
      const isLast = i === names.length - 1;
      const key = `${parentKey}/${name}`;
      rows.push({
        key,
        indent: prefix,
        connector: isLast ? "└── " : "├── ",
        name,
        leaf: child.children.size === 0,
      });
      walk(child, prefix + (isLast ? "    " : "│   "), key);
    }
  };
  walk(root, "", "");
  return rows;
}

export function PresetTrees() {
  return (
    <section className="section" id="trees" aria-label="Preset example trees">
      <h2>Example trees</h2>
      <p className="section-sub">
        The same four repositories — two of yours, two community — filed under every preset.
        Archived wins over fork, and repositories without a known language land in other/.
      </p>
      <div className="preset-tree-grid">
        {PRESETS.map((preset) => (
          <div className="panel terminal preset-tree" role="group" aria-label={preset} key={preset}>
            <span className="panel-label">{preset}</span>
            <pre className="tree-view">
              <code>
                {buildTree(preset).map((row) => (
                  <span className="tree-line" key={row.key}>
                    <span className="tree-guide" aria-hidden="true">
                      {row.indent + row.connector}
                    </span>
                    <span className={row.leaf ? "tree-repo" : "tree-dir"}>{row.name}</span>
                    {"\n"}
                  </span>
                ))}
              </code>
            </pre>
          </div>
        ))}
      </div>
    </section>
  );
}
