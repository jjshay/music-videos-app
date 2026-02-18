const sharp = require('sharp');
const path = require('path');
const brand = require('../config/brand');

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wrap text for vertical frame (~20 chars/line for TikTok style).
 */
function wrapText(text, maxChars = 20) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current.length + word.length + 1 > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Render a bold TikTok-style caption overlay PNG.
 *
 * Style: Large bold white text, centered horizontally,
 * black stroke (3px) + drop shadow for readability,
 * positioned at lower third (~72% down the frame).
 *
 * @param {string} outputDir - Directory to save PNG
 * @param {number} index - Caption index (for filename)
 * @param {string} text - Caption text
 * @param {number} width - Output width (1080)
 * @param {number} height - Output height (1920)
 * @returns {string} Path to generated PNG
 */
async function renderCaption(outputDir, index, text, width, height) {
  const mv = brand.musicVideo;
  const fontSize = mv.captionFontSize || 55;
  const strokeWidth = mv.captionStroke || 3;
  const posY = mv.captionPositionY || 0.72;
  const fontFamily = 'Futura, Trebuchet MS, Arial Black, sans-serif';
  const lineHeight = Math.round(fontSize * 1.35);

  const lines = wrapText(text.toUpperCase(), 20);
  const totalTextHeight = lineHeight * lines.length;
  const startY = Math.round(height * posY);
  const centerX = Math.round(width / 2);

  // Build SVG text elements — stroke layer (behind) + fill layer (front)
  const strokeLines = lines.map((line, i) => {
    const y = startY + lineHeight * i;
    return `<text x="${centerX}" y="${y}" text-anchor="middle"
          font-family="${fontFamily}" font-size="${fontSize}" font-weight="900"
          fill="none" stroke="#000000" stroke-width="${strokeWidth * 2}" stroke-linejoin="round"
          letter-spacing="2">${escapeXml(line)}</text>`;
  }).join('\n    ');

  const fillLines = lines.map((line, i) => {
    const y = startY + lineHeight * i;
    return `<text x="${centerX}" y="${y}" text-anchor="middle"
          font-family="${fontFamily}" font-size="${fontSize}" font-weight="900"
          fill="#FFFFFF" letter-spacing="2">${escapeXml(line)}</text>`;
  }).join('\n    ');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="dropshadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="3" dy="3" stdDeviation="5" flood-color="#000000" flood-opacity="0.7"/>
      </filter>
    </defs>
    <g filter="url(#dropshadow)">
      ${strokeLines}
      ${fillLines}
    </g>
  </svg>`;

  const outputFile = path.join(outputDir, `caption_${index}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return outputFile;
}

/**
 * Render all caption overlays for a music video.
 *
 * @param {string} outputDir - Directory for PNGs
 * @param {Array} segments - [{ caption, duration }]
 * @param {number} width - 1080
 * @param {number} height - 1920
 * @returns {Array} [{ file, segmentIndex }]
 */
async function renderAllCaptions(outputDir, segments, width, height) {
  const results = [];
  for (let i = 0; i < segments.length; i++) {
    const file = await renderCaption(outputDir, i, segments[i].caption, width, height);
    results.push({ file, segmentIndex: i });
  }
  return results;
}

/**
 * Render the "Brought to you by Gauntlet Gallery" intro card PNG.
 * Dark navy background, gold accent lines, centered text.
 * Same style as the overlay tool's intro card.
 */
async function renderIntroCard(outputDir, width, height) {
  const { colors, fonts } = brand;
  const fontSize = Math.round(width * 0.058);
  const smallFontSize = Math.round(width * 0.038);
  const lineWidth = Math.round(width * 0.55);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height * 0.47);
  const lineSpacing = Math.round(fontSize * 1.6);

  const line1Y = centerY - Math.round(fontSize * 0.3);
  const line2Y = centerY + lineSpacing;
  const goldLineTop = line1Y - Math.round(fontSize * 1.2);
  const goldLineBottom = line2Y + Math.round(fontSize * 0.8);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${colors.darkNavy}"/>
    <line x1="${centerX - lineWidth / 2}" y1="${goldLineTop}" x2="${centerX + lineWidth / 2}" y2="${goldLineTop}"
          stroke="${colors.gold}" stroke-width="3"/>
    <text x="${centerX}" y="${line1Y}" text-anchor="middle"
          font-family="${fonts.body}, sans-serif" font-size="${smallFontSize}"
          fill="${colors.gold}" letter-spacing="6">BROUGHT TO YOU BY</text>
    <text x="${centerX}" y="${line2Y}" text-anchor="middle"
          font-family="${fonts.heading}, serif" font-size="${fontSize}" font-weight="bold"
          fill="${colors.white}" letter-spacing="5">GAUNTLET GALLERY</text>
    <line x1="${centerX - lineWidth / 2}" y1="${goldLineBottom}" x2="${centerX + lineWidth / 2}" y2="${goldLineBottom}"
          stroke="${colors.gold}" stroke-width="3"/>
  </svg>`;

  const outputFile = path.join(outputDir, 'intro_card.png');
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return outputFile;
}

/**
 * Render the outro CTA card PNG.
 * AI-customized text (acoustic vs electric), or fallback default.
 *
 * Layout:
 * - Line 1 (small gold): CTA line ("BROWSE THE FULL COLLECTION")
 * - Line 2 (small gold): Guitar type line ("SIGNED & AUTHENTICATED ACOUSTICS")
 * - Gold divider
 * - Line 3 (large white): "GAUNTLET GALLERY"
 * - Line 4 (small gold): website or tagline
 */
async function renderOutroCard(outputDir, width, height, outroText) {
  const { colors, fonts } = brand;

  // Parse outroText lines — AI provides these or we use defaults
  const lines = (outroText || brand.musicVideo.outroDefaultText).split('\n');
  const ctaLine = lines[0] || 'BROWSE THE FULL COLLECTION';
  const typeLine = lines[1] || 'AUTHENTICATED GUITARS';
  const brandLine = lines[2] || 'GAUNTLET GALLERY';
  const tagLine = lines[3] || '';

  const largeFontSize = Math.round(width * 0.055);
  const smallFontSize = Math.round(width * 0.032);
  const tinyFontSize = Math.round(width * 0.025);
  const lineWidth = Math.round(width * 0.55);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height * 0.45);

  const ctaY = centerY - Math.round(largeFontSize * 1.8);
  const typeY = centerY - Math.round(largeFontSize * 0.6);
  const dividerY = centerY + Math.round(largeFontSize * 0.2);
  const brandY = centerY + Math.round(largeFontSize * 1.4);
  const tagY = brandY + Math.round(largeFontSize * 1.0);

  let tagEl = '';
  if (tagLine) {
    tagEl = `<text x="${centerX}" y="${tagY}" text-anchor="middle"
          font-family="${fonts.body}, sans-serif" font-size="${tinyFontSize}"
          fill="${colors.gold}" letter-spacing="4">${escapeXml(tagLine)}</text>`;
  }

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${colors.darkNavy}"/>
    <text x="${centerX}" y="${ctaY}" text-anchor="middle"
          font-family="${fonts.body}, sans-serif" font-size="${smallFontSize}"
          fill="${colors.gold}" letter-spacing="4">${escapeXml(ctaLine)}</text>
    <text x="${centerX}" y="${typeY}" text-anchor="middle"
          font-family="${fonts.body}, sans-serif" font-size="${smallFontSize}"
          fill="${colors.gold}" letter-spacing="3">${escapeXml(typeLine)}</text>
    <line x1="${centerX - lineWidth / 2}" y1="${dividerY}" x2="${centerX + lineWidth / 2}" y2="${dividerY}"
          stroke="${colors.gold}" stroke-width="2"/>
    <text x="${centerX}" y="${brandY}" text-anchor="middle"
          font-family="${fonts.heading}, serif" font-size="${largeFontSize}" font-weight="bold"
          fill="${colors.white}" letter-spacing="5">${escapeXml(brandLine)}</text>
    ${tagEl}
  </svg>`;

  const outputFile = path.join(outputDir, 'outro_card.png');
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return outputFile;
}

module.exports = { renderCaption, renderAllCaptions, renderIntroCard, renderOutroCard };
