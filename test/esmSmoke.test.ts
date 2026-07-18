import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

describe("ESM Smoke Test", () => {
  it("RELEASE_ASSERTION: R19-BUILT-CLI should execute dist/index.js --help without ESM errors", () => {
    const indexPath = resolve(process.cwd(), "dist/index.js");
    if (!existsSync(indexPath)) {
      throw new Error("dist/index.js does not exist. Please run build first.");
    }

    // Run the compiled CLI asking for help
    try {
      const output = execSync(`node "${indexPath}" --help`, { stdio: "pipe", encoding: "utf-8" });
      expect(output).toContain("Commands:");
      expect(output).not.toContain("ERR_REQUIRE_ESM");
      expect(output).not.toContain("require is not defined");
    } catch (err: any) {
      throw new Error(`Child process failed: ${err.message}`);
    }
  });

  it("RELEASE_ASSERTION: R02-ESM-NODE-20 should be able to import dist/integrations/obsidian.js and use normalizeObsidianVaultInput", async () => {
    const modulePath = resolve(process.cwd(), "dist/integrations/obsidian.js");
    if (!existsSync(modulePath)) {
      throw new Error("dist/integrations/obsidian.js does not exist.");
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
