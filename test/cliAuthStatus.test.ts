import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { extractCopilotLoginFromConfig, resolveCopilotConfigDir } from "../src/utils/cliAuthStatus";

describe("cliAuthStatus", () => {
  it("resolves config dir from --config-dir flag", () => {
    const args = ["--config-dir", "C:/custom/copilot", "--model", "gpt-5.3-codex"];
    const resolved = resolveCopilotConfigDir(args, {}, "C:/Users/tester");
    expect(resolved).toBe("C:/custom/copilot");
  });

  it("resolves config dir from --config-dir=<value> flag", () => {
    const args = ["--config-dir=C:/copilot-config", "--continue"];
    const resolved = resolveCopilotConfigDir(args, {}, "C:/Users/tester");
    expect(resolved).toBe("C:/copilot-config");
  });

  it("uses XDG_CONFIG_HOME when config-dir is not provided", () => {
    const env = { XDG_CONFIG_HOME: "/tmp/xdg-home" };
    const resolved = resolveCopilotConfigDir([], env, "/home/tester");
    expect(resolved).toBe(path.join("/tmp/xdg-home", "copilot"));
  });

  it("falls back to ~/.copilot when no overrides are present", () => {
    const resolved = resolveCopilotConfigDir([], {}, "C:/Users/tester");
    expect(resolved).toBe(path.join("C:/Users/tester", ".copilot"));
  });

  it("extracts login from last_logged_in_user first", () => {
    const login = extractCopilotLoginFromConfig({
      last_logged_in_user: { login: "rivie13" },
      logged_in_users: [{ login: "other-user" }]
    });
    expect(login).toBe("rivie13");
  });

  it("falls back to logged_in_users when last_logged_in_user is absent", () => {
    const login = extractCopilotLoginFromConfig({
      logged_in_users: [{ login: "phoenix" }]
    });
    expect(login).toBe("phoenix");
  });

  it("returns null when no login entries exist", () => {
    const login = extractCopilotLoginFromConfig({ logged_in_users: [] });
    expect(login).toBeNull();
  });

  it("extracts login when logged_in_users is an object map", () => {
    const login = extractCopilotLoginFromConfig({
      logged_in_users: {
        primary: { login: "mapped-user" }
      }
    });
    expect(login).toBe("mapped-user");
  });

  it("extracts username fallback fields", () => {
    const login = extractCopilotLoginFromConfig({
      last_logged_in_user: { username: "fallback-user" }
    });
    expect(login).toBe("fallback-user");
  });
});