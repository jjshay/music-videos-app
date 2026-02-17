const brand = require('../config/brand');

function generateTimeline(analysis, videoDuration) {
  const callouts = brand.calloutDefaults.map((def) => {
    let text;

    if (def.field && analysis[def.field]) {
      text = analysis[def.field];
    } else if (def.field === 'signature_detail' && analysis.is_signed) {
      text = analysis.signature_detail || def.fallback;
    } else if (def.field === 'edition_detail') {
      const parts = [];
      if (analysis.is_numbered && analysis.edition_detail) parts.push(analysis.edition_detail);
      if (analysis.has_coa) parts.push('Certificate of Authenticity');
      text = parts.length > 0 ? parts.join(' \u2022 ') : def.fallback;
    } else {
      text = def.fallback;
    }

    // Skip callouts that would extend past the max output duration
    const maxDur = brand.output.maxDuration || (videoDuration + brand.intro.duration);
    if (def.time + def.duration > maxDur) {
      return null;
    }

    return {
      time: def.time,
      duration: def.duration,
      text: text,
      field: def.field,
    };
  }).filter(Boolean);

  return {
    intro: {
      duration: brand.intro.duration,
      fadeDuration: brand.intro.fadeDuration,
      text: brand.intro.text,
    },
    callouts,
    watermark: { ...brand.watermark },
    totalDuration: brand.output.maxDuration
      ? Math.min(videoDuration + brand.intro.duration, brand.output.maxDuration)
      : videoDuration + brand.intro.duration,
  };
}

module.exports = { generateTimeline };
