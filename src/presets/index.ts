export type PresetId =
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

/**
 * Accepts user-defined preset ids anywhere a built-in preset id is expected,
 * while editors still autocomplete the built-in union.
 */
export type PresetRef = PresetId | (string & {});

export const PRESET_IDS: readonly PresetId[] = [
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

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && (PRESET_IDS as readonly string[]).includes(value);
}

export const CUSTOM_PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** True for any preset reference repotruck can store (built-in or custom id). */
export function isPresetRef(value: unknown): value is PresetRef {
  if (isPresetId(value)) return true;
  return typeof value === "string" && CUSTOM_PRESET_ID_PATTERN.test(value) && value.length <= 40;
}

export type SegmentToken = "owner" | "category" | "language" | "name";

export const SEGMENT_TOKENS: readonly SegmentToken[] = ["owner", "category", "language", "name"];

export interface CustomPreset {
  id: string;
  segments: SegmentToken[];
}

/** Validates a user-defined preset: sane id and a segment list ending in `name`. */
export function validateCustomPreset(value: unknown): CustomPreset | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Partial<CustomPreset>;
  if (typeof raw.id !== "string") return null;
  if (!CUSTOM_PRESET_ID_PATTERN.test(raw.id) || raw.id.length > 40) return null;
  if (isPresetId(raw.id)) return null; // cannot shadow a built-in preset
  if (!Array.isArray(raw.segments) || raw.segments.length === 0 || raw.segments.length > 4) {
    return null;
  }
  const seen = new Set<string>();
  const segments: SegmentToken[] = [];
  for (const token of raw.segments) {
    if (typeof token !== "string" || !(SEGMENT_TOKENS as readonly string[]).includes(token)) {
      return null;
    }
    if (seen.has(token)) return null;
    seen.add(token);
    segments.push(token as SegmentToken);
  }
  if (segments[segments.length - 1] !== "name") return null;
  return { id: raw.id, segments };
}

export type RepoCategory = "archived" | "forks" | "source";

export interface CategoryInput {
  isArchived: boolean;
  isFork: boolean;
}

export function repoCategory(repo: CategoryInput): RepoCategory {
  if (repo.isArchived) return "archived";
  if (repo.isFork) return "forks";
  return "source";
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ASCII control characters for path sanitization
const ILLEGAL_SEGMENT_CHARS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;

export function sanitizeSegment(segment: string): string {
  const replaced = segment.replace(ILLEGAL_SEGMENT_CHARS, "-");
  const stripped = replaced.replace(/[. ]+$/u, "");
  if (stripped.length === 0) return "other";
  return stripped;
}

export function languageSegment(language: string | null): string {
  if (language === null) return "other";
  return sanitizeSegment(language);
}

export interface TargetSegmentsInput extends CategoryInput {
  owner: string;
  name: string;
  language?: string | null;
}

export function targetSegments(
  repo: TargetSegmentsInput,
  preset: PresetId,
  internal: boolean,
): string[] {
  const owner = sanitizeSegment(repo.owner);
  const name = sanitizeSegment(repo.name);
  const category = repoCategory(repo);
  const language = languageSegment(repo.language ?? null);
  const prefix = internal ? [] : (["community"] as string[]);
  switch (preset) {
    case "categorized":
      return [...prefix, owner, category, name];
    case "flat-by-owner":
      return [...prefix, owner, name];
    case "topic-focused":
      return [...prefix, owner, language, name];
    case "language-first":
      return [...prefix, language, owner, name];
    case "category-first":
      return [...prefix, category, owner, name];
    case "language-categorized":
      return [...prefix, owner, category, language, name];
    case "flat":
      return [...prefix, name];
    case "category-flat":
      return [...prefix, category, name];
    case "language-flat":
      return [...prefix, language, name];
    case "category-language":
      return [...prefix, category, language, name];
    case "language-category":
      return [...prefix, language, category, name];
    case "owner-language-category":
      return [...prefix, owner, language, category, name];
    case "category-owner-language":
      return [...prefix, category, owner, language, name];
    case "category-language-owner":
      return [...prefix, category, language, owner, name];
    case "language-owner-category":
      return [...prefix, language, owner, category, name];
    case "language-category-owner":
      return [...prefix, language, category, owner, name];
  }
}

/**
 * Resolves segments for any preset reference: built-ins via their fixed
 * layouts, user-defined presets via their segment-token list. Unknown preset
 * ids throw, so a typo can never silently fall back to a default layout.
 */
export function targetSegmentsForPreset(
  repo: TargetSegmentsInput,
  preset: PresetRef,
  internal: boolean,
  customPresets: readonly CustomPreset[] = [],
): string[] {
  if (isPresetId(preset)) return targetSegments(repo, preset, internal);
  const custom = customPresets.find((item) => item.id === preset);
  if (custom === undefined) {
    throw new Error(
      `unknown preset: ${preset} (expected one of ${PRESET_IDS.join(", ")} or a preset defined with 'repotruck preset add')`,
    );
  }
  const values: Record<SegmentToken, string> = {
    owner: sanitizeSegment(repo.owner),
    category: repoCategory(repo),
    language: languageSegment(repo.language ?? null),
    name: sanitizeSegment(repo.name),
  };
  const prefix = internal ? [] : (["community"] as string[]);
  return [...prefix, ...custom.segments.map((token) => values[token])];
}

export function isInternalOwner(
  owner: string,
  userLogin: string,
  orgs: readonly string[],
): boolean {
  const normalized = owner.toLowerCase();
  if (normalized === userLogin.toLowerCase()) return true;
  return orgs.some((org) => org.toLowerCase() === normalized);
}

export function nextPreset(preset: PresetId): PresetId {
  const index = PRESET_IDS.indexOf(preset);
  return PRESET_IDS[(index + 1) % PRESET_IDS.length]!;
}
