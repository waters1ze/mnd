// test/slugify.test.ts
import { slugify } from "../src/core/vault.js";

describe("slugify()", () => {
  test("transliterates Cyrillic to Latin", () => {
    expect(slugify("Привет мир")).toBe("privet-mir");
  });

  test("spaces become dashes", () => {
    expect(slugify("my project name")).toBe("my-project-name");
  });

  test("mixed Cyrillic + Latin", () => {
    const result = slugify("Мой vlog 2024");
    expect(result).toBe("moy-vlog-2024");
  });

  test("special characters removed", () => {
    expect(slugify("Project (test) #1!")).toBe("project-test-1");
  });

  test("leading and trailing dashes stripped", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });

  test("multiple consecutive spaces collapse to single dash", () => {
    expect(slugify("a   b")).toBe("a-b");
  });

  test("lowercase output", () => {
    expect(slugify("HELLO WORLD")).toBe("hello-world");
  });

  test("long string truncated at 80 chars", () => {
    const long = "a".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  test("empty string returns empty string", () => {
    expect(slugify("")).toBe("");
  });

  test("numbers preserved", () => {
    expect(slugify("episode-42")).toBe("episode-42");
  });

  test("ё transliteration", () => {
    expect(slugify("ёж")).toBe("yozh");
  });

  test("щ transliteration", () => {
    expect(slugify("щи")).toBe("shchi");
  });
});
