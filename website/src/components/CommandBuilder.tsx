import { useEffect, useMemo, useRef, useState } from "react";
import { CopyButton } from "./CopyButton.tsx";
import { COMMAND_GROUPS, type CommandDoc, GLOBAL_FLAGS } from "./commandGroups.generated.ts";

/**
 * Command builder mini-app: browse every repotruck command with its
 * description, fill in arguments and options through inputs (choices become
 * dropdowns), and copy the assembled command line. The data comes straight
 * from the generated parity registry (commandGroups.generated.ts), so the
 * builder always covers the full CLI surface and stays in sync via
 * `bun run docs:check`.
 */

interface Positional {
  name: string;
  required: boolean;
  variadic: boolean;
}

interface UsageForm {
  subcommand: readonly string[];
  positionals: readonly Positional[];
  usage: string;
}

interface FlagSpec {
  raw: string;
  label: string;
  kind: "boolean" | "value" | "optional";
  placeholder: string;
  description: string;
  choices: readonly string[] | null;
  defaultValue: string | null;
}

interface FlagState {
  on: boolean;
  value: string;
}

/** "repotruck sync resolve [repo] [options]" → subcommand + positionals. */
function parseUsageForm(usage: string): UsageForm {
  const subcommand: string[] = [];
  const positionals: Positional[] = [];
  for (const token of usage.trim().split(/\s+/)) {
    if (token === "repotruck" || token === "[options]") continue;
    if (token.startsWith("<") || token.startsWith("[")) {
      const inner = token.replace(/^<|>$/g, "").replace(/^\[|\]$/g, "");
      positionals.push({
        name: inner.replace(/\.\.\.$/, ""),
        required: token.startsWith("<"),
        variadic: inner.endsWith("..."),
      });
    } else {
      subcommand.push(token);
    }
  }
  return { subcommand, positionals, usage: usage.trim() };
}

/** "-s, --scope <scope>" + description → structured flag with choices/default. */
function parseFlag(flag: string, description: string): FlagSpec {
  // Split the names off at the trailing value token ("<x>" / "[x]"), not at
  // the first space — aliases themselves contain one: "-s, --scope".
  const valueToken = / (<[^>]+>|\[[^\]]+\])$/.exec(flag);
  const names = valueToken ? flag.slice(0, valueToken.index) : flag;
  const rest = valueToken ? (valueToken[1] ?? "") : "";
  const label = names.split(/,\s*/).find((name) => name.startsWith("--")) ?? names;
  let kind: FlagSpec["kind"] = "boolean";
  let placeholder = "";
  const valueMatch = /^<(.+)>$/.exec(rest);
  const optionalMatch = /^\[(.+)\]$/.exec(rest);
  if (valueMatch) {
    kind = "value";
    placeholder = valueMatch[1] ?? "";
  } else if (optionalMatch) {
    kind = "optional";
    placeholder = optionalMatch[1] ?? "";
  }
  const choicesMatch = /\(choices: ([^)]+)\)/.exec(description);
  const defaultMatch = /\(default: ([^)]+)\)/.exec(description);
  return {
    raw: flag,
    label,
    kind,
    placeholder,
    description,
    choices: choicesMatch ? (choicesMatch[1]?.split(", ") ?? null) : null,
    defaultValue: defaultMatch ? (defaultMatch[1] ?? null) : null,
  };
}

function quoteValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '""';
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

function flagToParts(spec: FlagSpec, state: FlagState): string[] {
  if (spec.kind === "boolean") return [spec.label];
  if (spec.kind === "optional" && state.value.trim().length === 0) return [spec.label];
  return [spec.label, quoteValue(state.value)];
}

function buildCommand(
  form: UsageForm,
  args: readonly string[],
  commandFlags: readonly { spec: FlagSpec; state?: FlagState }[],
  globalFlags: readonly { spec: FlagSpec; state?: FlagState }[],
): string {
  const parts = ["npx", "repotruck", ...form.subcommand];
  form.positionals.forEach((positional, index) => {
    const value = args[index]?.trim() ?? "";
    if (value.length === 0) return;
    if (positional.variadic) {
      parts.push(...value.split(/\s+/).map(quoteValue));
    } else {
      parts.push(quoteValue(value));
    }
  });
  for (const { spec, state } of commandFlags) {
    if (state?.on) parts.push(...flagToParts(spec, state));
  }
  for (const { spec, state } of globalFlags) {
    if (state?.on) parts.push(...flagToParts(spec, state));
  }
  return parts.join(" ");
}

function formLabel(form: UsageForm): string {
  const tail = form.positionals.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`));
  return [...form.subcommand, ...tail].join(" ");
}

function domId(prefix: string, spec: FlagSpec): string {
  return `${prefix}-${spec.label.replace(/[^a-z0-9-]/gi, "")}`;
}

const EMPTY_FLAG: FlagState = { on: false, value: "" };

function FlagRow({
  spec,
  state,
  idPrefix,
  onChange,
}: {
  spec: FlagSpec;
  state: FlagState;
  idPrefix: string;
  onChange: (next: FlagState) => void;
}) {
  const id = domId(idPrefix, spec);
  const enableWith = (on: boolean): FlagState => {
    if (!on) return { ...state, on: false };
    // A required value with fixed choices always has a sensible pick: the
    // documented default, else the first choice.
    if (spec.kind === "value" && spec.choices && state.value.length === 0) {
      return { on: true, value: spec.defaultValue ?? spec.choices[0] ?? "" };
    }
    return { ...state, on: true };
  };
  return (
    <div className={`builder-flag${state.on ? " is-on" : ""}`}>
      <div className="flag-head">
        <input
          id={id}
          type="checkbox"
          checked={state.on}
          onChange={(event) => onChange(enableWith(event.target.checked))}
        />
        <label htmlFor={id}>
          <code>{spec.raw}</code>
        </label>
        {spec.defaultValue !== null && (
          <span className="flag-note">default: {spec.defaultValue}</span>
        )}
      </div>
      <p className="flag-desc">{spec.description}</p>
      {state.on && spec.kind !== "boolean" && (
        <div className="flag-input">
          {spec.choices ? (
            <select
              aria-label={`Value for ${spec.label}`}
              value={state.value}
              onChange={(event) => onChange({ on: true, value: event.target.value })}
            >
              {spec.choices.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              aria-label={`Value for ${spec.label}`}
              placeholder={spec.placeholder || "value"}
              value={state.value}
              onChange={(event) => onChange({ on: true, value: event.target.value })}
            />
          )}
          {spec.kind === "optional" && <span className="flag-note">empty = bare flag</span>}
        </div>
      )}
    </div>
  );
}

export function CommandBuilder({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => ({
    group: COMMAND_GROUPS[0]?.id ?? "",
    name: COMMAND_GROUPS[0]?.commands[0]?.name ?? "",
  }));
  const [formIdx, setFormIdx] = useState(0);
  const [flags, setFlags] = useState<Record<string, FlagState>>({});
  const [globals, setGlobals] = useState<Record<string, FlagState>>({});
  const [args, setArgs] = useState<string[]>([]);

  const group = COMMAND_GROUPS.find((g) => g.id === selected.group);
  const command: CommandDoc | undefined = group?.commands.find((c) => c.name === selected.name);

  const forms = useMemo(
    () => (command ? command.usage.split(" | ").map(parseUsageForm) : []),
    [command],
  );
  const form = forms[Math.min(formIdx, forms.length - 1)] ?? {
    subcommand: [],
    positionals: [],
    usage: "",
  };
  const commandFlags = useMemo(
    () => (command?.flags ?? []).map((f) => parseFlag(f.flag, f.description)),
    [command],
  );
  const globalFlags = useMemo(() => GLOBAL_FLAGS.map((f) => parseFlag(f.flag, f.description)), []);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
      searchRef.current?.focus();
    }
    if (!open && dlg.open) dlg.close();
  }, [open]);

  // Chrome swallows Escape inside <input type="search"> (clears the query
  // without firing the dialog's cancel), so close explicitly on Escape.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>): void => {
    if (event.key === "Escape") dialogRef.current?.close();
  };

  const selectCommand = (groupId: string, name: string): void => {
    setSelected({ group: groupId, name });
    setFormIdx(0);
    setFlags({});
    setArgs([]);
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
  };

  const built = useMemo(
    () =>
      command
        ? buildCommand(
            form,
            args,
            commandFlags.map((spec) => ({ spec, state: flags[spec.raw] })),
            globalFlags.map((spec) => ({ spec, state: globals[spec.raw] })),
          )
        : "",
    [command, form, args, commandFlags, globalFlags, flags, globals],
  );

  const q = query.trim().toLowerCase();
  const filteredGroups = COMMAND_GROUPS.map((g) => ({
    ...g,
    commands: g.commands.filter(
      (c) =>
        q.length === 0 || c.name.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q),
    ),
  })).filter((g) => g.commands.length > 0);
  const totalCommands = COMMAND_GROUPS.reduce((sum, g) => sum + g.commands.length, 0);

  return (
    <dialog
      ref={dialogRef}
      className="builder"
      aria-label="Command builder"
      onClose={onClose}
      onKeyDown={onKeyDown}
    >
      {open ? (
        <>
          <div className="builder-head">
            <div>
              <h2>Command builder</h2>
              <p className="builder-sub">
                Browse all {totalCommands} commands, toggle options with their docs, copy the
                assembled line.
              </p>
            </div>
            <button
              type="button"
              className="builder-close"
              aria-label="Close command builder"
              onClick={() => dialogRef.current?.close()}
            >
              ✕
            </button>
          </div>
          <div className="builder-body">
            <aside className="builder-list" aria-label="Command list">
              <input
                ref={searchRef}
                type="search"
                className="builder-search"
                placeholder="Search commands…"
                aria-label="Search commands"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {filteredGroups.map((g) => (
                <div key={g.id} className="builder-group">
                  <span className="builder-group-title">{g.title}</span>
                  {g.commands.map((c) => {
                    const isActive = c.name === selected.name && g.id === selected.group;
                    return (
                      <button
                        type="button"
                        key={`${g.id}/${c.name}`}
                        className={`builder-command${isActive ? " is-selected" : ""}`}
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => selectCommand(g.id, c.name)}
                      >
                        <span className="bc-name">{c.name}</span>
                        <span className="bc-summary">{c.summary}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {filteredGroups.length === 0 && <p className="builder-empty">No command matches.</p>}
            </aside>
            <div ref={detailsRef} className="builder-main">
              {command ? (
                <>
                  <header className="builder-intro">
                    <h3>
                      <code className="bc-cmd">repotruck {command.name}</code>
                    </h3>
                    <p>{command.summary}</p>
                    <code className="builder-usage">{command.usage}</code>
                  </header>

                  <section className="builder-section builder-preview" aria-label="Built command">
                    <h4>Built command</h4>
                    <div className="preview-row">
                      <code className="preview-line">{built}</code>
                      <CopyButton command={built} />
                    </div>
                  </section>

                  {command.examples.length > 0 && (
                    <section className="builder-section" aria-label="Examples">
                      <h4>Examples</h4>
                      {command.examples.map((example) => (
                        <div key={example} className="copy-row">
                          <span className="copy-command">
                            <span className="prompt">$ </span>
                            {example}
                          </span>
                          <CopyButton command={example} />
                        </div>
                      ))}
                    </section>
                  )}

                  {forms.length > 1 && (
                    <fieldset className="builder-forms">
                      <legend>Form</legend>
                      {forms.map((f, index) => (
                        <label key={f.usage} className="form-choice">
                          <input
                            type="radio"
                            name="builder-form"
                            checked={index === formIdx}
                            onChange={() => {
                              setFormIdx(index);
                              setArgs([]);
                            }}
                          />
                          <code>{formLabel(f)}</code>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {form.positionals.length > 0 && (
                    <section className="builder-section" aria-label="Arguments">
                      <h4>Arguments</h4>
                      {form.positionals.map((positional, index) => (
                        <div key={positional.name} className="builder-arg">
                          <label htmlFor={`arg-${positional.name}`}>
                            <code>
                              {positional.required
                                ? `<${positional.name}>`
                                : `[${positional.name}]`}
                            </code>
                            <span className="flag-note">
                              {positional.required
                                ? positional.variadic
                                  ? "required · space separated"
                                  : "required"
                                : positional.variadic
                                  ? "optional · space separated"
                                  : "optional"}
                            </span>
                          </label>
                          <input
                            id={`arg-${positional.name}`}
                            type="text"
                            value={args[index] ?? ""}
                            onChange={(event) =>
                              setArgs((prev) => {
                                const next = [...prev];
                                next[index] = event.target.value;
                                return next;
                              })
                            }
                          />
                        </div>
                      ))}
                    </section>
                  )}

                  {commandFlags.length > 0 && (
                    <section className="builder-section" aria-label="Options">
                      <h4>Options</h4>
                      {commandFlags.map((spec) => (
                        <FlagRow
                          key={spec.raw}
                          spec={spec}
                          state={flags[spec.raw] ?? EMPTY_FLAG}
                          idPrefix="cf"
                          onChange={(next) => setFlags((prev) => ({ ...prev, [spec.raw]: next }))}
                        />
                      ))}
                    </section>
                  )}

                  <section className="builder-section" aria-label="Global options">
                    <h4>Global options</h4>
                    {globalFlags.map((spec) => (
                      <FlagRow
                        key={spec.raw}
                        spec={spec}
                        state={globals[spec.raw] ?? EMPTY_FLAG}
                        idPrefix="gf"
                        onChange={(next) => setGlobals((prev) => ({ ...prev, [spec.raw]: next }))}
                      />
                    ))}
                  </section>
                </>
              ) : (
                <p className="builder-empty">Pick a command from the list.</p>
              )}
            </div>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
