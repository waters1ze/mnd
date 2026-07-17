// src/repl/registry.ts
import { COMMAND_REGISTRY, type CommandDefinition, type CommandHandler, type CommandAvailability, type CommandContext } from "./router.js";

export interface CommandRegistration {
  name: string;
  description: string;
  aliases?: string[];
  acceptsArgs?: boolean;
  sensitive?: boolean;
  execute: CommandHandler;
  getContextAvailability?: (ctx: CommandContext) => CommandAvailability | "enabled" | "hidden";
}

export function registerCommand(reg: CommandRegistration): void {
  const def: CommandDefinition = {
    name: reg.name,
    slash: `/${reg.name}`,
    icon: "⚙",
    description: reg.description,
    acceptsArgs: reg.acceptsArgs ?? false,
    ...(reg.aliases ? { aliases: reg.aliases } : {}),
    handler: reg.execute,
    ...(reg.sensitive !== undefined ? { sensitive: reg.sensitive } : {}),
  };

  if (reg.getContextAvailability) {
    def.availability = (ctx) => {
      const res = reg.getContextAvailability!(ctx);
      if (res === "enabled") return { enabled: true };
      if (res === "hidden") return { enabled: false, reason: "hidden" };
      return res as CommandAvailability;
    };
  }

  COMMAND_REGISTRY.push(def);
}
