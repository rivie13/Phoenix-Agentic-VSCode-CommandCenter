export interface CliInvocation {
  command: string;
  baseArgs: string[];
}

function stripWrappingQuotes(value: string): string {
  let next = value.trim();
  while (next.length >= 2) {
    const first = next[0];
    const last = next[next.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      next = next.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return next;
}

function splitCommandSegments(raw: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (const ch of raw) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      if (current.length > 0) {
        segments.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function quoteIfNeeded(segment: string): string {
  if (!/\s/.test(segment)) {
    return segment;
  }
  return `"${segment.replaceAll('"', '\\"')}"`;
}

export function parseCliInvocation(raw: string, fallbackCommand: string): CliInvocation {
  const parsed = splitCommandSegments(raw.trim());
  const fallbackParsed = splitCommandSegments((fallbackCommand || "").trim());
  const fallbackExecutable = stripWrappingQuotes(fallbackParsed[0] ?? fallbackCommand.trim());
  const fallbackArgs = fallbackParsed.slice(1).map((entry) => stripWrappingQuotes(entry)).filter((entry) => entry.length > 0);

  if (parsed.length === 0) {
    return {
      command: fallbackExecutable,
      baseArgs: fallbackArgs
    };
  }

  const parsedCommand = stripWrappingQuotes(parsed[0] ?? "");
  const command = parsedCommand || fallbackExecutable;
  const baseArgs = parsed.slice(1).map((entry) => stripWrappingQuotes(entry)).filter((entry) => entry.length > 0);
  return {
    command,
    baseArgs
  };
}

export function formatCliInvocationForTerminal(invocation: CliInvocation): string {
  const parts = [invocation.command, ...invocation.baseArgs]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => quoteIfNeeded(entry));
  return parts.join(" ").trim();
}
