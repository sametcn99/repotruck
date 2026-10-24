export function globToRegex(pattern: string): RegExp {
  let re = "^";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      re += ".*";
      i += 2;
      continue;
    }
    if (c === "*") {
      re += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      re += ".";
      i += 1;
      continue;
    }
    if (/[.+^$[\](){}|\\]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
    i += 1;
  }
  re += "$";
  return new RegExp(re, "i");
}

export function matchesGlob(pattern: string, text: string): boolean {
  return globToRegex(pattern).test(text);
}

export function parseFilterFlags(raw: string[] | string | undefined): string[] {
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const result: string[] = [];
  for (const item of list) {
    for (const part of item.split(",")) {
      const trimmed = part.trim();
      if (trimmed.length > 0) result.push(trimmed);
    }
  }
  return result;
}

export function filterReposByKey<T extends { owner: string; name: string }>(
  repos: readonly T[],
  includes?: readonly string[],
  excludes?: readonly string[],
): T[] {
  const inc = (includes ?? []).map((p) => globToRegex(p));
  const exc = (excludes ?? []).map((p) => globToRegex(p));

  return repos.filter((repo) => {
    const key = `${repo.owner}/${repo.name}`;
    if (inc.length > 0) {
      const matched = inc.some((re) => re.test(key));
      if (!matched) return false;
    }
    if (exc.length > 0) {
      const excluded = exc.some((re) => re.test(key));
      if (excluded) return false;
    }
    return true;
  });
}
