// src/ui/theme.ts

export const theme = {
  accent: "#7C5CFF",    // mnd brand violet — chalk.hex()
  dim: "gray",
  success: "green",
  warning: "yellow",
  error: "red",
  icons: {
    done: "☑",
    pending: "☐",
    inProgress: "⣋",    // spinner frame, see thinkingIndicator
    focusMarker: "▸",   // active frame marker, see focusFrame
  },
} as const;

export type ThemeType = typeof theme;
