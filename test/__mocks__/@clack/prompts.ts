// test/__mocks__/@clack/prompts.ts
export const confirm = jest.fn().mockResolvedValue(true);
export const select = jest.fn().mockResolvedValue("assets");
export const text = jest.fn().mockResolvedValue("test-input");
export const password = jest.fn().mockResolvedValue("test-password");
export const intro = jest.fn();
export const outro = jest.fn();
export const note = jest.fn();
export const cancel = jest.fn();
export const isCancel = jest.fn().mockReturnValue(false);
export const spinner = jest.fn().mockReturnValue({
  start: jest.fn(),
  stop: jest.fn(),
  message: jest.fn(),
});
