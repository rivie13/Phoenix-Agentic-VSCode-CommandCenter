import { describe, expect, it } from "vitest";
import { formatCliInvocationForTerminal, parseCliInvocation } from "../src/utils/cliCommand";

describe("cliCommand", () => {
  it("parses quoted executable and preserves base args", () => {
    const invocation = parseCliInvocation('"C:\\Program Files\\Codex\\codex.exe" --profile default', "codex");
    expect(invocation).toEqual({
      command: "C:\\Program Files\\Codex\\codex.exe",
      baseArgs: ["--profile", "default"]
    });
  });

  it("normalizes wrapping quotes around simple command names", () => {
    const invocation = parseCliInvocation('"codex"', "codex");
    expect(invocation.command).toBe("codex");
    expect(invocation.baseArgs).toEqual([]);
  });

  it("falls back to provided default command when input is empty", () => {
    const invocation = parseCliInvocation("  ", "copilot --experimental");
    expect(invocation).toEqual({
      command: "copilot",
      baseArgs: ["--experimental"]
    });
  });

  it("formats command for terminal with quoting when needed", () => {
    const command = formatCliInvocationForTerminal({
      command: "C:\\Program Files\\Codex\\codex.exe",
      baseArgs: ["--profile", "default"]
    });
    expect(command).toBe('"C:\\Program Files\\Codex\\codex.exe" --profile default');
  });
});
