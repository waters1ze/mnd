import { getModelCatalog, refreshCatalog } from "../src/models/modelCatalog.js";

// Mock the dependencies
jest.mock("../src/models/groqModelDiscovery.js", () => ({
  fetchGroqModels: jest.fn().mockResolvedValue([
    {
      id: "llama3-70b-8192",
      provider: "groq",
      capabilities: ["text"],
      availability: "available",
      local: false,
      installed: false,
      source: "live"
    }
  ])
}));

jest.mock("../src/models/ollamaModelDiscovery.js", () => ({
  fetchOllamaModels: jest.fn().mockResolvedValue([
    {
      id: "llama3:8b",
      provider: "ollama",
      capabilities: ["text"],
      availability: "available",
      local: true,
      installed: true,
      source: "live"
    }
  ])
}));

jest.mock("../src/models/modelCache.js", () => ({
  readModelCache: jest.fn().mockResolvedValue(null),
  writeModelCache: jest.fn().mockResolvedValue(undefined)
}));

jest.mock("../src/core/config.js", () => ({
  loadConfig: jest.fn().mockResolvedValue({
    connections: {
      groq_api_key_ref: "dummy_ref",
      ollama_host: "http://127.0.0.1:11434"
    },
    models: {
      hybrid: {
        text: { model: "llama3-70b-8192" },
        vision: { model: "llava:13b" }, // This one is not returned by the mock, so should be preserved as unavailable
        transcription: { model: "whisper" }
      },
      local: {
        text: { model: "llama3:8b" },
        vision: { model: "missing-local-vision" } // Should be marked not_installed
      }
    }
  })
}));

describe("modelCatalog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("fetches catalog and merges missing configured models", async () => {
    const catalog = await refreshCatalog();
    
    // groq model
    expect(catalog.find(m => m.id === "llama3-70b-8192")).toBeDefined();
    // ollama model
    expect(catalog.find(m => m.id === "llama3:8b")).toBeDefined();

    // missing groq vision model should be appended as unavailable
    const missingGroq = catalog.find(m => m.id === "llava:13b" && m.provider === "groq");
    expect(missingGroq).toBeDefined();
    expect(missingGroq?.availability).toBe("unavailable");

    // missing ollama vision model should be appended as not_installed
    const missingOllama = catalog.find(m => m.id === "missing-local-vision" && m.provider === "ollama");
    expect(missingOllama).toBeDefined();
    expect(missingOllama?.availability).toBe("not_installed");
  });
});
