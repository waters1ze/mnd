import { discoverGraphExecutable } from './graph-discovery.js';
import fs from 'node:fs';

jest.mock('node:fs');

describe('graph discovery', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('prefers packaged path over dev path', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('mnd-graph.exe') || p.includes('mnd-graph')) return true;
      return false;
    });

    const res = discoverGraphExecutable(true);
    expect(res.mode).toBe('packaged');
  });

  it('dev path used only in dev mode', () => {
    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
      if (p.includes('target')) return true;
      return false;
    });

    let res = discoverGraphExecutable(false);
    expect(res.mode).toBe(null);

    res = discoverGraphExecutable(true);
    expect(res.mode).toBe('dev');
  });

  it('returns executable_not_found when all paths absent', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const res = discoverGraphExecutable(true);
    expect(res.mode).toBe(null);
  });
});
