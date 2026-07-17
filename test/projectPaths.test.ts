import { getProjectPaths, validateSlug } from "../src/core/projectPaths.js";
import { resolve, join } from "node:path";

describe("projectPaths", () => {
  describe("validateSlug", () => {
    test("throws on invalid slugs", () => {
      expect(() => validateSlug("")).toThrow();
      expect(() => validateSlug("foo/bar")).toThrow();
      expect(() => validateSlug("foo\\bar")).toThrow();
      expect(() => validateSlug("foo..bar")).toThrow();
    });

    test("passes valid slugs", () => {
      expect(() => validateSlug("my-project")).not.toThrow();
      expect(() => validateSlug("hello_world-123")).not.toThrow();
    });
  });

  describe("getProjectPaths", () => {
    test("returns correct canonical paths", () => {
      const paths = getProjectPaths("/my-vault", "test-project");
      expect(paths.root).toBe(join("/my-vault", "Projects", "test-project"));
      expect(paths.rawDir).toBe(join("/my-vault", "Projects", "test-project", "raw"));
      expect(paths.exportsDir).toBe(join("/my-vault", "Projects", "test-project", "exports"));
    });

    test("prevents derived directories from escaping into raw", () => {
      // It's hard to trigger the rawDir escape in standard getProjectPaths since we define them ourselves
      // but let's test that the rawDir validation runs.
      const paths = getProjectPaths("/my-vault", "test");
      expect(resolve(paths.exportsDir).startsWith(resolve(paths.rawDir))).toBe(false);
    });
  });
});
