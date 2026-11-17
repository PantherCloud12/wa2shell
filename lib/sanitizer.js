/**
 * Security & Privacy Sanitizer
 * Masks sensitive credentials, API keys, tokens, and secrets from terminal outputs
 * before they are transmitted over WhatsApp.
 */

const fs = require("fs");
const path = require("path");

// Common patterns for high-entropy secrets and API keys
const SECRET_PATTERNS = [
  // Generic API Keys & Tokens
  /(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9_\-]{16,})["']?/gi,
  // Google / Gemini API Keys (AIzaSy...)
  /\b(AIzaSy[A-Za-z0-9_\-]{33})\b/g,
  // OpenAI & Anthropic Keys
  /\b(sk-[A-Za-z0-9_\-]{20,})\b/g,
  // GitHub Personal Access Tokens
  /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/g,
  // Private Key Headers
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
  // Bearer Authorization Headers
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  // Generic Password Assignments in shell output
  /(?:password|passwd|pwd)\s*[:=]\s*["']?([^\s"']{4,})["']?/gi,
];

/**
 * Sanitizes a string by replacing identified sensitive patterns with redacted masks.
 * @param {string} text - Raw input string
 * @returns {string} Sanitized string safe for transport
 */
function sanitizeOutput(text) {
  if (typeof text !== "string" || !text) return "";

  let sanitized = text;

  // Mask known secret regex patterns
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, captured) => {
      if (captured) {
        return match.replace(captured, "[REDACTED_SECRET]");
      }
      return "[REDACTED_SECRET]";
    });
  }

  return sanitized;
}

module.exports = {
  sanitizeOutput,
};
