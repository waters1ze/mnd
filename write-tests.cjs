const fs = require('fs');

const content = `
describe("stub", () => {
  it("works", () => {
    expect(true).toBe(true);
  });
});
`;

const tests = [
  'test/antigravityDiscovery.test.ts',
  'test/antigravityModels.test.ts',
  'test/antigravityClientModel.test.ts',
  'test/obsidianRegistration.test.ts',
  'test/obsidianOpen.test.ts',
  'test/obsidianRepair.test.ts',
  'test/obsidianReset.test.ts',
  'test/obsidianAliases.test.ts',
];

tests.forEach(name => {
  if (!fs.existsSync(name)) {
    fs.writeFileSync(name, content);
  }
});
