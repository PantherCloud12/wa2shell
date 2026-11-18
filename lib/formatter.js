/**
 * WhatsApp AI Response Formatter Engine (v1.4.0)
 * Upgrades raw LLM / Antigravity Markdown output into native, beautifully styled
 * WhatsApp typography, preventing messy ("berantakan") rendering on mobile chat screens.
 * 
 * Features:
 * - Code Block & Inline Code Preservation (Preserves syntax & prevents styling bleed)
 * - Auto-Closure for Unfinished Code Blocks
 * - Markdown Headings (#, ##, ###) -> WhatsApp Bold Accent Headers
 * - Markdown Bold (**text** / __text__) -> WhatsApp Bold (*text*)
 * - Strikethrough (~~text~~) -> WhatsApp Strikethrough (~text~)
 * - Hyperlink Reformatter (Replaces file:/// with backticks & formats URLs cleanly)
 * - Markdown Table Converter (Converts fractured tables into elegant mobile cards)
 * - List Normalizer (Converts -, +, * into clean unicode bullets '•' and '◦')
 * - Whitespace & Blank Line Collapser (Eliminates excessive multi-line gaps)
 * - AI Thought & Artifact Tag Stripper (<thought>, <thinking>, XML metadata)
 * - Action Tag Parser ([[SEND_FILE:...]], etc.)
 */

/**
 * Strips internal AI artifact wrappers, chain-of-thought blocks, and XML tags.
 */
function cleanAIArtifacts(text) {
  if (typeof text !== "string" || !text) return "";

  let cleaned = text;

  // Strip XML-style thinking / thought blocks
  cleaned = cleaned.replace(/<(thought|thinking|antigravity_output|turn_info)[\s\S]*?<\/\1>/gi, "");
  // Strip solitary closing/opening tags
  cleaned = cleaned.replace(/<\/?(thought|thinking|antigravity_output|turn_info)>/gi, "");

  // Strip Remotion or Carousel artifact wrapper blocks
  cleaned = cleaned.replace(/````carousel[\s\S]*?````/gi, "");

  // Strip whole-message markdown wrapper fences (e.g. ```markdown\n ... \n```)
  cleaned = cleaned.replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i, "$1");

  return cleaned.trim();
}

/**
 * Extracts action tags (SEND_FILE, SEND_IMAGE, SEND_AUDIO, SEND_VIDEO) from text.
 */
function parseActionTags(text) {
  if (typeof text !== "string") return { cleanText: "", actions: [] };

  const actions = [];
  const tagRegex = /\[\[(SEND_FILE|SEND_IMAGE|SEND_AUDIO|SEND_VIDEO):([^\]]+)\]\]/g;
  let match;

  while ((match = tagRegex.exec(text)) !== null) {
    actions.push({
      type: match[1],
      targetPath: match[2].trim(),
    });
  }

  const cleanText = text.replace(tagRegex, "").trim();
  return { cleanText, actions };
}

/**
 * Converts Markdown tables into mobile-friendly key-value card structures.
 */
function convertMarkdownTables(text) {
  // Regex to detect standard markdown tables with header, divider, and rows
  const tableRegex = /((?:^[ \t]*\|[^\n]+\|[ \t]*\r?\n)(?:^[ \t]*\|[-:\s|]+\|[ \t]*\r?\n)(?:^[ \t]*\|[^\n]+\|[ \t]*(?:\r?\n|$))+)/gm;

  return text.replace(tableRegex, (tableBlock) => {
    const lines = tableBlock.trim().split(/\r?\n/).map((l) => l.trim());
    if (lines.length < 3) return tableBlock;

    const parseRow = (rowStr) => {
      return rowStr
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
    };

    const headers = parseRow(lines[0]);
    // Skip divider at line 1
    const dataRows = lines.slice(2).map(parseRow);

    const formattedCards = dataRows.map((row) => {
      const parts = [];
      row.forEach((val, idx) => {
        const header = headers[idx] || `Col ${idx + 1}`;
        if (val) {
          parts.push(`*${header}:* ${val}`);
        }
      });
      return `• ${parts.join("  |  ")}`;
    });

    return "\n" + formattedCards.join("\n") + "\n";
  });
}

/**
 * Main typography transformer from Markdown to clean WhatsApp-native format.
 */
function formatWhatsApp(rawText) {
  if (typeof rawText !== "string" || !rawText) return "";

  // 1. Clean AI thoughts and artifacts
  let text = cleanAIArtifacts(rawText);

  // 2. Ensure code blocks are closed
  const tripleBacktickCount = (text.match(/```/g) || []).length;
  if (tripleBacktickCount % 2 !== 0) {
    text += "\n```";
  }

  // 3. Stash code blocks and inline code to preserve them from formatting transforms
  const codeBlocks = [];
  text = text.replace(/```([\w-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `__WA2SHELL_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`\`\`\`\n${code}\`\`\``);
    return placeholder;
  });

  // Also catch generic code blocks without newline
  text = text.replace(/```([\s\S]*?)```/g, (match, code) => {
    const placeholder = `__WA2SHELL_CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`\`\`\`\n${code.trim()}\n\`\`\``);
    return placeholder;
  });

  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `__WA2SHELL_INLINE_${inlineCodes.length}__`;
    inlineCodes.push(`\`${code}\``);
    return placeholder;
  });

  // 4. Convert Markdown Tables before header/bold processing
  text = convertMarkdownTables(text);

  // 5. Convert Markdown Headings (#, ##, ###, ####)
  text = text.replace(/^#\s+(.+)$/gm, "*📌 $1*");
  text = text.replace(/^##\s+(.+)$/gm, "*▶️ $1*");
  text = text.replace(/^###\s+(.+)$/gm, "*• $1*");
  text = text.replace(/^####+\s+(.+)$/gm, "*$1*");

  // 6. Convert Double Asterisk Bold (**text**) and Double Underscore Bold (__text__)
  // In WhatsApp, **text** is broken / literal asterisks; it must be *text*
  text = text.replace(/\*\*([^\s*](?:[^*]*?[^\s*])?)\*\*/g, "*$1*");
  text = text.replace(/__([^\s_](?:[^_]*?[^\s_])?)__/g, "*$1*");

  // 7. Convert Strikethrough (~~text~~ -> ~text~)
  text = text.replace(/~~([^\s~](?:[^~]*?[^\s~])?)~~/g, "~$1~");

  // 8. Convert Hyperlinks
  // file:/// links -> clean backticks without scheme
  text = text.replace(/\[([^\]]+)\]\(file:\/\/[^\)]+\)/g, "`$1`");
  // Web URLs
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, title, url) => {
    if (title.trim() === url.trim()) return url;
    return `*${title.trim()}* (${url.trim()})`;
  });

  // 9. Normalize List Bullets
  // Sub-bullets (2+ spaces indentation)
  text = text.replace(/^[ \t]{2,4}[-*+]\s+(.+)$/gm, "  ◦ $1");
  // Primary bullets
  text = text.replace(/^[ \t]*[-*+]\s+(.+)$/gm, "• $1");

  // 10. Horizontal Rules (---, ***, ___) -> Clean unicode line
  text = text.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, "────────────────────────────");

  // 11. Normalize Whitespace and Consecutive Blank Lines
  // Collapse 3 or more newlines into double newlines
  text = text.replace(/\n{3,}/g, "\n\n");
  // Trim trailing spaces on each line
  text = text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();

  // 12. Restore inline code
  inlineCodes.forEach((code, idx) => {
    text = text.replace(`__WA2SHELL_INLINE_${idx}__`, code);
  });

  // 13. Restore code blocks
  codeBlocks.forEach((block, idx) => {
    text = text.replace(`__WA2SHELL_CODE_BLOCK_${idx}__`, block);
  });

  return text;
}

/**
 * High-level processor for outgoing AI text.
 * Performs artifact cleaning, action tag extraction, and typography formatting.
 */
function formatAIResponse(rawResponse) {
  const { cleanText, actions } = parseActionTags(rawResponse);
  const formatted = formatWhatsApp(cleanText);
  return {
    formattedText: formatted,
    actions,
  };
}

module.exports = {
  cleanAIArtifacts,
  parseActionTags,
  convertMarkdownTables,
  formatWhatsApp,
  formatAIResponse,
};
