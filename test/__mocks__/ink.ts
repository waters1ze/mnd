// test/__mocks__/ink.ts
import React from "react";

export const render = jest.fn().mockReturnValue({
  unmount: jest.fn(),
  waitUntilExit: jest.fn().mockResolvedValue(undefined),
  rerender: jest.fn(),
  clear: jest.fn(),
});

export const Box = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
export const Text = ({ children }: { children?: React.ReactNode }) => React.createElement("span", null, children);

export const useInput = jest.fn((cb: (input: string, key: {
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  return: boolean;
  escape: boolean;
  backspace: boolean;
  delete: boolean;
  meta: boolean;
  ctrl: boolean;
}) => void) => {});

export const useApp = jest.fn().mockReturnValue({ exit: jest.fn() });
export const useStdin = jest.fn().mockReturnValue({ stdin: null, isRawModeSupported: false });
