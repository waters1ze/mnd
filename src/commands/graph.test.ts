import { handleGraph } from './graph.js';
import { discoverGraphExecutable } from './graph-discovery.js';
import { execFile, spawn } from 'child_process';

jest.mock('./graph-discovery');
jest.mock('child_process');

describe('graph command', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    (discoverGraphExecutable as jest.Mock).mockReturnValue({ path: '/mock/path', mode: 'dev' });
    process.env.MND_VAULT_PATH = '/mock/vault';
    (spawn as jest.Mock).mockReturnValue({ unref: jest.fn() });
    (execFile as unknown as jest.Mock).mockImplementation((_command, args, _options, callback) => {
      const sub = args[2];
      callback(null, JSON.stringify(sub === 'rebuild'
        ? { status: 'completed', message: 'Rebuilt 3 files' }
        : sub === 'node'
          ? { id: '123', title: 'Node' }
          : { status: 'ready', nodes: 3, edges: 1 }), '');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.MND_VAULT_PATH;
  });

  it('current opens vault', async () => {
    await handleGraph('current');
    expect(spawn).toHaveBeenCalledWith('/mock/path', ['/mock/vault', '--cmd', 'current'], { shell: false, detached: true, stdio: 'ignore' });
  });

  it('all opens vault selector', async () => {
    await handleGraph('all');
    expect(spawn).toHaveBeenCalledWith('/mock/path', ['/mock/vault', '--cmd', 'all'], { shell: false, detached: true, stdio: 'ignore' });
  });

  it('node validates id', async () => {
    await handleGraph('node', []);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('invalid_node_id'));

    await handleGraph('node', ['123']);
    expect(execFile).toHaveBeenCalledWith('/mock/path', ['/mock/vault', '--cmd', 'node', '--node', '123'], expect.objectContaining({ shell: false }), expect.any(Function));
  });

  it('rebuild returns structured result', async () => {
    await handleGraph('rebuild');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Rebuilt 3 files'));
  });

  it('status returns metadata', async () => {
    await handleGraph('status');
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('status":"ready"'));
  });

  it('returns executable_not_found when missing', async () => {
    (discoverGraphExecutable as jest.Mock).mockReturnValue({ path: null });
    await handleGraph('current');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('executable_not_found'));
  });

  it('returns vault_not_configured when no vault', async () => {
    delete process.env.MND_VAULT_PATH;
    await handleGraph('current');
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('vault_not_configured'));
  });

  it('spawns without shell', async () => {
    await handleGraph('current');
    expect(spawn).toHaveBeenCalledWith(expect.any(String), expect.any(Array), expect.objectContaining({ shell: false }));
  });
});
