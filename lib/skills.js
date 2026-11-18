/**
 * wa2shell Skill Discovery & Prompt Augmentation Engine (v1.6.0)
 * Loads Markdown skills from /skills/<name>/SKILL.md and injects relevant
 * skill instructions into Antigravity Agent prompts automatically.
 */

const fs = require("fs");
const path = require("path");
const config = require("../config");

const SKILLS_DIR = path.join(config.paths.root, "skills");

const SKILL_KEYWORDS = {
  "remotion-video": [
    /\bremotion\b/i,
    /\b(buat|bikin|create|generate|render|produksi)\s+(video|reels|tiktok|shorts|motion\s*graphic)/i,
    /\bmotion\s*graphics?\b/i,
    /\bvideo\s+(explainer|promo|edukasi|intro|short)\b/i,
  ],
};

/**
 * Parses YAML-like frontmatter from SKILL.md.
 */
function parseSkillFile(filePath, dirName) {
  const raw = fs.readFileSync(filePath, "utf8");
  let name = dirName;
  let description = "";
  let body = raw;

  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = fmMatch[2].trim();
    const nameMatch = fm.match(/^name:\s*(.+)$/m);
    const descMatch = fm.match(/^description:\s*(.+)$/m);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  return {
    name,
    description,
    filePath,
    body,
  };
}

/**
 * Lists all installed skills in /root/wa2shell/skills/.
 */
function listSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      skills.push(parseSkillFile(skillFile, entry.name));
    } catch (_) {}
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Gets a single skill by name.
 */
function getSkill(name) {
  if (!name) return null;
  const normalized = String(name).trim().toLowerCase();
  return listSkills().find((s) => s.name.toLowerCase() === normalized) || null;
}

/**
 * Matches skills relevant to a user prompt.
 */
function matchSkillsForPrompt(prompt) {
  if (!prompt || typeof prompt !== "string") return [];
  const matched = [];

  for (const [skillName, patterns] of Object.entries(SKILL_KEYWORDS)) {
    if (patterns.some((rx) => rx.test(prompt))) {
      const skill = getSkill(skillName);
      if (skill) matched.push(skill);
    }
  }

  return matched;
}

/**
 * Augments a prompt with matched or forced skill context.
 */
function buildSkillAugmentedPrompt(prompt, forceSkillName = null) {
  let skillsToApply = [];
  if (forceSkillName) {
    const forced = getSkill(forceSkillName);
    if (forced) skillsToApply.push(forced);
  } else {
    skillsToApply = matchSkillsForPrompt(prompt);
  }

  if (skillsToApply.length === 0) return prompt;

  const skillBlocks = skillsToApply
    .map(
      (s) =>
        `[ACTIVE SKILL: ${s.name}]\n` +
        `Read and follow ${s.filePath}:\n` +
        `${s.body}`
    )
    .join("\n\n");

  return `${skillBlocks}\n\n[USER REQUEST]\n${prompt}`;
}

module.exports = {
  SKILLS_DIR,
  listSkills,
  getSkill,
  matchSkillsForPrompt,
  buildSkillAugmentedPrompt,
};
