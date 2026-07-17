// src/commands/config.ts
import { render } from "ink";
import React from "react";
import type { CommandHandler } from "../repl/router.js";

export const handleConfig: CommandHandler = async () => {
  const { ConfigScreen } = await import("../ui/configScreen.js");
  const { waitUntilExit } = render(React.createElement(ConfigScreen));
  await waitUntilExit();
};
