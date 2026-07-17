// test/setupWizard.logic.test.ts
import { SetupWizardLogic } from "../src/ui/setupWizard.js";

describe("Setup Wizard State Machine Logic", () => {
  const defaultVault = "/user/vault";

  test("runs through standard steps successfully with valid key", async () => {
    const logic = new SetupWizardLogic(defaultVault);
    expect(logic.step).toBe("welcome");

    // 1. Enter vault path
    logic.setVaultPath("/custom/vault");
    expect(logic.vaultPath).toBe("/custom/vault");
    logic.step = "groq_key"; // simulated step transition

    // 2. Submit valid key
    const mockValidator = jest.fn().mockResolvedValue(true);
    const keyOk = await logic.submitGroqKey("gsk_key", mockValidator);
    expect(keyOk).toBe(true);
    expect(logic.groqKey).toBe("gsk_key");
    expect(logic.step).toBe("profile");
    expect(mockValidator).toHaveBeenCalledWith("gsk_key");

    // 3. Choose profile
    logic.selectProfile("local");
    expect(logic.profile).toBe("local");
    expect(logic.step).toBe("bootstrap");

    // 4. Complete bootstrap & confirm
    logic.step = "confirm";
    logic.confirmSetup();
    expect(logic.step).toBe("done");
  });

  test("invalid key blocks step transition and sets error message", async () => {
    const logic = new SetupWizardLogic(defaultVault);
    logic.step = "groq_key";

    // 1. Submit empty key
    const mockValidator = jest.fn();
    const emptyOk = await logic.submitGroqKey("", mockValidator);
    expect(emptyOk).toBe(false);
    expect(logic.step).toBe("groq_key");
    expect(logic.errorMessage).toBe("API key cannot be empty.");
    expect(mockValidator).not.toHaveBeenCalled();

    // 2. Submit invalid key
    mockValidator.mockResolvedValue(false);
    const invalidOk = await logic.submitGroqKey("invalid_key", mockValidator);
    expect(invalidOk).toBe(false);
    expect(logic.step).toBe("groq_key");
    expect(logic.errorMessage).toBe("Invalid Groq API key. Please verify and try again.");
    expect(mockValidator).toHaveBeenCalledWith("invalid_key");
  });

  test("allows custom vault path fallback to default if empty is provided", () => {
    const logic = new SetupWizardLogic(defaultVault);
    logic.setVaultPath("  "); // spaces/empty
    expect(logic.vaultPath).toBe(defaultVault);
  });
});
