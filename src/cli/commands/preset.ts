import type { Command } from "commander";
import { PRESET_IDS, validateCustomPreset } from "../../presets/index.ts";
import { readCustomPresets, readSettings, writeSettings } from "../../services/settings.ts";
import { type CliContext, exitFail, runAction } from "../shared.ts";

export function register(program: Command, _ctx: CliContext): void {
  const presetCommand = program
    .command("preset")
    .description(`Manage custom directory-layout presets (built-ins: ${PRESET_IDS.join(", ")}).`);

  presetCommand
    .command("list")
    .description("List built-in and custom presets.")
    .action(async () => {
      await runAction(async () => {
        for (const id of PRESET_IDS) {
          process.stdout.write(`${id} (built-in)\n`);
        }
        const customs = await readCustomPresets(process.env);
        if (customs.length === 0) {
          process.stdout.write(
            "(no custom presets — add one with: repotruck preset add <id> <segments...>)\n",
          );
          return;
        }
        for (const preset of customs) {
          process.stdout.write(`${preset.id} -> ${preset.segments.join("/")}\n`);
        }
      });
    });

  presetCommand
    .command("add")
    .description(
      'Define a custom preset from segment tokens: owner, category, language, name (name must come last). Example: repotruck preset add lang-owner "language" "owner" "name"',
    )
    .argument("<id>", "preset id (lowercase letters, digits, dashes; cannot shadow a built-in)")
    .argument("<segments...>", "ordered segment tokens from: owner, category, language, name")
    .action(async (id: string, segments: string[]) => {
      await runAction(async () => {
        const validated = validateCustomPreset({ id, segments });
        if (validated === null) {
          exitFail(
            `invalid preset: ${id} ${segments.join(" ")} (segments must be 1-4 distinct tokens from owner, category, language, name, ending with name; the id must not shadow a built-in preset)`,
          );
        }
        const settings = await readSettings(process.env);
        await writeSettings(process.env, {
          ...settings,
          presets: {
            ...(settings.presets ?? {}),
            [validated.id]: { segments: validated.segments },
          },
        });
        process.stdout.write(`✓ preset ${validated.id} -> ${validated.segments.join("/")}\n`);
      });
    });

  presetCommand
    .command("remove")
    .description("Remove a custom preset.")
    .argument("<id>", "preset id to remove")
    .action(async (id: string) => {
      await runAction(async () => {
        const settings = await readSettings(process.env);
        if (settings.presets?.[id] === undefined) {
          exitFail(`preset not found: ${id}`);
        }
        const presets = { ...settings.presets };
        delete presets[id];
        await writeSettings(process.env, { ...settings, presets });
        process.stdout.write(`✓ preset ${id} removed\n`);
      });
    });
}
