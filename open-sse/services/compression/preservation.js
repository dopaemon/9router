// Extraction & restoration of preserved blocks (fenced code, inline code, URLs, math, errors)
// Matches https://github.com/cheaper-inference/OmniRoute

const SENTINEL_PREFIX = "\u0000OMNI_PRESERVE";

function randomSentinelSeed() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return `r${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  return `r${Math.random().toString(36).slice(2)}`;
}

function ensureGlobal(pattern) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  return new RegExp(pattern.source, flags);
}

function replacePattern(text, pattern, kind, addBlock) {
  pattern.lastIndex = 0;
  return text.replace(pattern, (match) => {
    if (!match) return match;
    if (match.includes(SENTINEL_PREFIX)) return match;
    return addBlock(match, kind);
  });
}

function extractFrontmatter(text, addBlock) {
  if (!text.startsWith("---\n")) return text;
  const close = text.indexOf("\n---", 4);
  if (close === -1) return text;
  const closeEnd = text.indexOf("\n", close + 4);
  const end = closeEnd === -1 ? text.length : closeEnd + 1;
  return `${addBlock(text.slice(0, end), "frontmatter")}${text.slice(end)}`;
}

function extractFencedCodeBlocks(text, addBlock) {
  const lines = text.match(/[^\n]*(?:\n|$)/g) ?? [text];
  let output = "";
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line === "" && i === lines.length - 1) break;
    const opening = line.match(/^([ \t]{0,3})(`{3,}|~{3,})[^\n]*(?:\n|$)/);
    if (!opening) {
      output += line;
      i++;
      continue;
    }

    const fence = opening[2];
    const fenceChar = fence[0];
    const minLen = fence.length;
    let block = line;
    let j = i + 1;
    let closed = false;

    while (j < lines.length) {
      const candidate = lines[j];
      block += candidate;
      const closeMatch = candidate.match(/^([ \t]{0,3})(`{3,}|~{3,})\s*(?:\n|$)/);
      if (closeMatch && closeMatch[2][0] === fenceChar && closeMatch[2].length >= minLen) {
        closed = true;
        break;
      }
      j++;
    }

    if (!closed) {
      output += line;
      i++;
      continue;
    }

    output += addBlock(block, "fenced_code");
    i = j + 1;
  }

  return output;
}

export function extractPreservedBlocks(text, options = {}) {
  const blocks = [];
  const seed = randomSentinelSeed();
  let counter = 0;

  const addBlock = (content, kind) => {
    const placeholder = `${SENTINEL_PREFIX}_${seed}_${counter}\u0000`;
    blocks.push({ placeholder, content, kind });
    counter++;
    return placeholder;
  };

  let result = text;
  result = extractFrontmatter(result, addBlock);

  // XML / system instruction envelopes
  const regionPatterns = [
    { pattern: /<system-reminder>[\s\S]*?<\/system-reminder>/g, kind: "system_instruction" },
    { pattern: /<instructions?>[\s\S]*?<\/instructions?>/g, kind: "system_instruction" },
    { pattern: /<project[- ]instructions?>[\s\S]*?<\/project[- ]instructions?>/g, kind: "system_instruction" },
  ];
  if (Array.isArray(options.preservePatterns)) {
    for (const pat of options.preservePatterns) {
      try {
        regionPatterns.unshift({
          pattern: typeof pat === "string" ? new RegExp(pat, "g") : ensureGlobal(pat),
          kind: "custom",
        });
      } catch {}
    }
  }

  for (const { pattern, kind } of regionPatterns) {
    result = replacePattern(result, ensureGlobal(pattern), kind, addBlock);
  }

  result = extractFencedCodeBlocks(result, addBlock);

  const builtIns = [
    { pattern: /\$\$[\s\S]*?\$\$/g, kind: "math_block" },
    { pattern: /\\\[[\s\S]*?\\\]/g, kind: "math_block" },
    { pattern: /(?<!\$)\$(?![\s$\d])(?:\\.|[^$\n\\]){1,160}?(?<!\s)\$(?!\$)/g, kind: "math_inline" },
    { pattern: /\\begin\{[A-Za-z*]+\}[\s\S]*?\\end\{[A-Za-z*]+\}/g, kind: "latex_block" },
    { pattern: /^#{1,6}\s+.+$/gm, kind: "markdown_heading" },
    { pattern: /^\s*\|.*\|\s*$/gm, kind: "markdown_table" },
    { pattern: /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, kind: "markdown_table" },
    { pattern: /`[^`\n]+`/g, kind: "inline_code" },
    { pattern: /\[[^\]\n]+\]\([^) \n]+(?:\s+"[^"]*")?\)/g, kind: "markdown_link" },
    { pattern: /\bhttps?:\/\/[^\s)\]"'>]+/gi, kind: "url" },
    { pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, kind: "const_case" },
    { pattern: /\bprocess\.env\.[A-Za-z_][A-Za-z0-9_]*\b/g, kind: "env_var" },
    { pattern: /\$[A-Z_][A-Z0-9_]*\b/g, kind: "env_var" },
    { pattern: /\b\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9.-]+)?\b/g, kind: "version" },
    { pattern: /\b[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)+\(\)?/g, kind: "dotted_identifier" },
    { pattern: /\b[A-Za-z_$][\w$]*\s*\([^()\n]*\)/g, kind: "function_call" },
    { pattern: /(?:^|\s)(?:\.{0,2}\/[A-Za-z0-9_@./-]+|[A-Za-z]:\\[A-Za-z0-9_.\\/-]+)/g, kind: "file_path" },
    { pattern: /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Error|Exception):[^\n]+/g, kind: "error_message" },
  ];

  for (const { pattern, kind } of builtIns) {
    result = replacePattern(result, ensureGlobal(pattern), kind, addBlock);
  }

  return { text: result, blocks };
}

export function restorePreservedBlocks(text, blocks) {
  let result = text;
  for (const block of blocks) {
    result = result.split(block.placeholder).join(block.content);
  }
  return result;
}

export function shouldPreserve(text, preservePatterns) {
  if (!Array.isArray(preservePatterns)) return false;
  return preservePatterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}
