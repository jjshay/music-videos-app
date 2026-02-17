const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '../../edit-history.json');

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveHistory(history) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// Record what Claude suggested vs what the user actually used
function recordEdits(originalTimeline, finalTimeline) {
  const history = loadHistory();

  originalTimeline.callouts.forEach((orig, i) => {
    const final = finalTimeline.callouts[i];
    if (!final) return;

    if (orig.text !== final.text) {
      history.push({
        field: orig.field || 'custom',
        original: orig.text,
        edited: final.text,
        date: new Date().toISOString(),
      });
    }
  });

  // Keep last 50 edits to avoid unbounded growth
  const trimmed = history.slice(-50);
  saveHistory(trimmed);
  return trimmed;
}

// Build a style guide from past edits for the Claude prompt
function getStyleGuide() {
  const history = loadHistory();
  if (history.length === 0) return null;

  // Group edits to find patterns
  const examples = history.slice(-20).map((h) =>
    `- Claude said: "${h.original}" → User changed to: "${h.edited}"`
  ).join('\n');

  return `IMPORTANT - The user has a specific style for callout text. Study these past edits carefully and match the user's preferred tone, length, and phrasing style:

${examples}

Key patterns to follow:
- Match the length and punchiness the user prefers
- Use similar vocabulary and capitalization style
- If the user consistently shortens text, keep suggestions concise
- If the user adds specific phrases or branding, include similar elements`;
}

module.exports = { loadHistory, recordEdits, getStyleGuide };
