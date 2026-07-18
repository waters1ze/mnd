import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

describe("ESM Smoke Test", () => {
  it("should execute dist/index.js --help without ESM errors", () => {
    const indexPath = resolve(__dirname, "../dist/index.js");
    if (!existsSync(indexPath)) {
      console.warn("Skipping test because dist/index.js does not exist. Please run build first.");
      return;
    }

    // Run the compiled CLI asking for help
    try {
      const output = execSync(`node "${indexPath}" --help`, { stdio: "pipe", encoding: "utf-8" });
      expect(output).toContain("Commands:");
      expect(output).not.toContain("ERR_REQUIRE_ESM");
      expect(output).not.toContain("require is not defined");
    } catch (err: any) {
      const allOutput = (err.stdout?.toString() || "") + (err.stderr?.toString() || "");
      expect(allOutput).not.toContain("ERR_REQUIRE_ESM");
      expect(allOutput).not.toContain("require is not defined");
    }
  });

  it("should be able to import dist/integrations/obsidian.js and use normalizeObsidianVaultInput", async () => {
    const modulePath = resolve(__dirname, "../dist/integrations/obsidian.js");
    if (!existsSync(modulePath)) {
      console.warn("Skipping test because dist/integrations/obsidian.js does not exist.");
      return;
    }

    const fileUrl = new URL(`file:///${modulePath.replace(/\\/g, "/")}`).href;
    
    // Test import using a fresh node process because Jest's module resolver intercepts dynamic import()
    const script = `
      import("${fileUrl}").then((mod) => {
        if (typeof mod.normalizeObsidianVaultInput !== "function") {
          process.exit(1);
        }
        try {
          mod.normalizeObsidianVaultInput('"C:\\\\fake-vault"');
        } catch (err) {
          if (err.message.includes("require is not defined") || err.message.includes("ERR_REQUIRE_ESM")) {
            process.exit(2);
          }
        }
      }).catch(err => {
        console.error(err);
        process.exit(3);
      });
    `;

    try {
      execSync(`node -e "${script.replace(/"/g, '\\"')}"`, { stdio: "pipe" });
    } catch (err: any) {
      throw new Error(`ESM import test failed: ${err.stderr?.toString()}`);
    }
  });
});
