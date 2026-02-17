const sharp = require('sharp');
const path = require('path');
const brand = require('../config/brand');

const { colors, fonts } = brand;

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Word-wrap text into lines that fit within maxWidth (rough char estimate)
function wrapText(text, maxChars) {
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

async function renderIntroCard(outputDir, width, height) {
  const fontSize = Math.round(width * 0.058);
  const smallFontSize = Math.round(width * 0.038);
  const lineWidth = Math.round(width * 0.55);
  const centerX = Math.round(width / 2);
  const centerY = Math.round(height * 0.47);
  const lineSpacing = Math.round(fontSize * 1.6);

  // Two-line layout: "AVAILABLE AT" (small) + "GAUNTLET GALLERY" (large)
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
          fill="${colors.gold}" letter-spacing="6">AVAILABLE AT</text>
    <text x="${centerX}" y="${line2Y}" text-anchor="middle"
          font-family="${fonts.heading}, serif" font-size="${fontSize}" font-weight="bold"
          fill="${colors.white}" letter-spacing="5">GAUNTLET GALLERY</text>
    <line x1="${centerX - lineWidth / 2}" y1="${goldLineBottom}" x2="${centerX + lineWidth / 2}" y2="${goldLineBottom}"
          stroke="${colors.gold}" stroke-width="3"/>
  </svg>`;

  const outputFile = path.join(outputDir, 'intro.png');
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return outputFile;
}

async function renderCallout(outputDir, index, text, width, height) {
  const fontSize = Math.round(width * 0.038);
  const padding = Math.round(width * 0.04);
  const barWidth = 5;
  const lineHeight = Math.round(fontSize * 1.4);

  // Wrap text for narrow vertical frame (~28 chars per line)
  const maxChars = 28;
  const lines = wrapText(text, maxChars);
  const numLines = lines.length;

  // Position callouts in the lower area, centered horizontally
  const boxWidth = Math.round(width * 0.88);
  const boxHeight = Math.round(padding * 2 + lineHeight * numLines);
  const boxX = Math.round((width - boxWidth) / 2);
  const boxY = Math.round(height * 0.78);

  const textLines = lines.map((line, i) => {
    const y = boxY + padding + lineHeight * (i + 0.8);
    return `<text x="${boxX + padding + barWidth + 10}" y="${y}" font-family="${fonts.body}, sans-serif"
          font-size="${fontSize}" fill="${colors.white}" letter-spacing="1">${escapeXml(line)}</text>`;
  }).join('\n    ');

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="2" dy="2" stdDeviation="4" flood-opacity="0.4"/>
      </filter>
    </defs>
    <rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="8"
          fill="rgba(10, 20, 50, 0.82)" filter="url(#shadow)"/>
    <rect x="${boxX}" y="${boxY}" width="${barWidth}" height="${boxHeight}" rx="2"
          fill="${colors.gold}"/>
    ${textLines}
  </svg>`;

  const outputFile = path.join(outputDir, `callout_${index}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return outputFile;
}

async function renderWatermark(outputDir, width, height) {
  const text = escapeXml(brand.watermark.text);
  const fontSize = Math.round(width * 0.028);
  const x = Math.round(width * 0.94);
  const y = Math.round(height * 0.04);

  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text x="${x}" y="${y}" text-anchor="end"
          font-family="${fonts.body}, sans-serif" font-size="${fontSize}"
          fill="rgba(255,255,255,0.6)" letter-spacing="2"
          font-weight="500">${text}</text>
  </svg>`;

  const outputFile = path.join(outputDir, 'watermark.png');
  await sharp(Buffer.from(svg)).png().toFile(outputFile);
  return outputFile;
}

async function renderAllOverlays(outputDir, timeline, width, height) {
  const results = {};

  results.intro = await renderIntroCard(outputDir, width, height);
  results.watermark = await renderWatermark(outputDir, width, height);

  results.callouts = [];
  for (let i = 0; i < timeline.callouts.length; i++) {
    const callout = timeline.callouts[i];
    const file = await renderCallout(outputDir, i, callout.text, width, height);
    results.callouts.push({ file, time: callout.time, duration: callout.duration });
  }

  return results;
}

module.exports = { renderAllOverlays, renderIntroCard, renderCallout, renderWatermark };
