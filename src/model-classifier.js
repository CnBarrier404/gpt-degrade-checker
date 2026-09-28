(() => {
  "use strict";

  // Retains the original extension's relative scores and fallback name rules.
  const scores = {
    "gpt-5-pro": 100,
    "gpt-5-thinking-pro": 98,
    "gpt-5-thinking": 90,
    "gpt-5-thinking-mini": 70,
    "gpt-5": 80,
    "gpt-5-auto": 78,
    "gpt-5-instant": 75,
    "gpt-5-mini": 60,
    "gpt-5-nano": 40,
    "gpt-4o": 72,
    "gpt-4o-mini": 50,
    "gpt-4-turbo": 68,
    "gpt-4": 65,
    "gpt-3.5-turbo": 30,
    "o3-pro": 95,
    "o3": 88,
    "o3-mini": 60,
    "o4-mini": 65,
    "o1-pro": 92,
    "o1": 85,
    "o1-mini": 58,
    "i-cot": 50,
    "text-davinci-002-render-sha": 65,
    "text-davinci-002-render": 65,
    "auto": 78
  };
  const small = new Set(["mini", "nano", "lite", "instant", "fast", "small"]);
  const strong = new Set(["thinking", "pro", "max", "reasoning", "opus", "plus", "ultra"]);

  function family(model) {
    const parts = [];
    for (const part of model.split("-")) {
      if (/^\d/.test(part)) break;
      parts.push(part);
    }
    return parts.length ? parts.join("-") : model.split("-")[0];
  }

  function qualifiers(model) {
    return new Set(model.split("-").map(part => part.replace(/^\d+/, ""))
      .filter(part => part && !/^\d+$/.test(part)));
  }

  function hasAny(parts, options) {
    for (const part of parts) if (options.has(part)) return true;
    return false;
  }

  function version(model) {
    const numbers = model.split("-").map(part => part.match(/^(\d+)/)?.[1])
      .filter(Boolean).map(Number);
    if (!numbers.length) return null;
    return numbers.reduce((value, number, index) => value + number / 100 ** index, 0);
  }

  function direction(selected, resolved) {
    if (!selected || !resolved) return "unknown";
    const a = selected.toLowerCase();
    const b = resolved.toLowerCase();
    if (a === b) return "none";
    if (a === "auto") return "lateral";
    if (scores[a] !== undefined && scores[b] !== undefined) {
      const difference = scores[b] - scores[a];
      return difference > 5 ? "upgrade" : difference < -5 ? "downgrade" : "lateral";
    }
    if (family(a) !== family(b)) return "unknown";
    const aParts = qualifiers(a);
    const bParts = qualifiers(b);
    const aStrong = hasAny(aParts, strong);
    const bStrong = hasAny(bParts, strong);
    const aSmall = hasAny(aParts, small);
    const bSmall = hasAny(bParts, small);
    if (aStrong && !bStrong) return "downgrade";
    if ((!aStrong && bStrong) || (aSmall && !bSmall)) return "upgrade";
    if (!aSmall && bSmall) return "downgrade";
    const aVersion = version(a);
    const bVersion = version(b);
    if (aVersion === null || bVersion === null) return "unknown";
    return bVersion > aVersion ? "upgrade" : bVersion < aVersion ? "downgrade" : "lateral";
  }

  globalThis.GptDegradeClassifier = Object.freeze({ direction });
})();
