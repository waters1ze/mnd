import { resolveNestedFolder } from '../src/integrations/googleDrive/layout.js';
import * as client from '../src/integrations/googleDrive/client.js';

describe('Sync Nested Layout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves root correctly', async () => {
    jest.spyOn(client, 'driveFetchJson').mockResolvedValue({ files: [{ id: "mock-id" }] });
    const id = await resolveNestedFolder("MyFolder/a.md", "root", {});
    expect(id).toBe("mock-id");
  });
});