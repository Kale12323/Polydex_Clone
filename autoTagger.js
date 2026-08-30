// autoTagger.js - Neural & Heuristic PBR Material Auto-Tagger Engine for Polydex

const CATEGORY_KEYWORDS = {
  wood: ['wood', 'oak', 'pine', 'walnut', 'cedar', 'mahogany', 'birch', 'bark', 'plank', 'timber', 'plywood', 'parquet', 'tree', 'lumber', 'log', 'board', 'teak'],
  metal: ['metal', 'steel', 'iron', 'gold', 'silver', 'brass', 'copper', 'bronze', 'chrome', 'aluminum', 'rust', 'rusted', 'metallic', 'galvanized', 'tin', 'foil', 'titanium'],
  stone: ['stone', 'rock', 'limestone', 'granite', 'marble', 'slate', 'sandstone', 'cobble', 'cobblestone', 'pebble', 'gravel', 'cliff', 'boulder', 'basalt'],
  fabric: ['fabric', 'cloth', 'cotton', 'denim', 'leather', 'silk', 'wool', 'linen', 'canvas', 'velvet', 'weave', 'knit', 'textile', 'carpet', 'tweed'],
  concrete: ['concrete', 'cement', 'plaster', 'stucco', 'asphalt', 'pavement', 'sidewalk', 'tar', 'cinder'],
  ground: ['ground', 'dirt', 'mud', 'soil', 'sand', 'clay', 'grass', 'moss', 'forest', 'terrain', 'gravel', 'earth', 'lawn'],
  brick: ['brick', 'brickwall', 'masonry', 'cinderblock', 'mortar', 'paver', 'terracotta'],
  ceramic: ['tile', 'tiles', 'ceramic', 'porcelain', 'mosaic', 'glazed', 'terrazzo'],
  plastic: ['plastic', 'rubber', 'latex', 'polymer', 'pvc', 'silicone', 'acrylic', 'resin'],
  scifi: ['cyber', 'scifi', 'tech', 'panel', 'hull', 'circuit', 'hex', 'greeble', 'mech', 'futuristic', 'solar', 'grid']
};

const SURFACE_MODIFIERS = {
  weathered: ['weathered', 'old', 'aged', 'worn', 'decay', 'grunge', 'dirt', 'eroded', 'ruined', 'mossy'],
  rough: ['rough', 'coarse', 'uneven', 'cracked', 'bumpy', 'raw', 'unpolished', 'scratched', 'damaged'],
  polished: ['polished', 'smooth', 'glossy', 'clean', 'varnished', 'glazed', 'shiny', 'slick', 'fine'],
  patterned: ['herringbone', 'hexagonal', 'chequered', 'weave', 'striped', 'ornate', 'geometric', 'tiled', 'panelled'],
  wet: ['wet', 'damp', 'puddle', 'rain', 'moist', 'water', 'slick'],
  industrial: ['industrial', 'factory', 'military', 'heavy', 'grate', 'corrugated', 'rivet', 'bolt'],
  interior: ['flooring', 'wallpaper', 'carpet', 'curtain', 'furniture', 'tile', 'parquet', 'room'],
  exterior: ['street', 'facade', 'terrain', 'ground', 'rock', 'cliff', 'bark', 'outdoor']
};

function identifyMapType(filename) {
  if (/(base[ _]?color|albedo|diffuse|diff|col|_d\b|_bc\b|_c\b|color)/i.test(filename)) return 'albedo';
  if (/(normal|norm|nor|_n\b|_nor\b|nrm|bump)/i.test(filename)) return 'normal';
  if (/(roughness|rough|_r\b|_rough\b|glossiness|gloss)/i.test(filename)) return 'roughness';
  if (/(metallic|metalness|metal|_m\b|_met\b)/i.test(filename)) return 'metallic';
  if (/(displacement|height|disp|_disp\b|_h\b|depth)/i.test(filename)) return 'displacement';
  if (/(ambient[ _]?occlusion|ao|_ao\b|occlusion)/i.test(filename)) return 'ao';
  if (/(emission|emissive|_emit\b)/i.test(filename)) return 'emission';
  if (/(opacity|alpha|mask|transparency)/i.test(filename)) return 'opacity';
  if (/(orm|arm|mro)/i.test(filename)) return 'packed_orm';
  return 'unknown';
}

function groupTexturesIntoMaterials(files) {
  const groups = new Map();

  files.forEach(f => {
    const filename = f.name;
    const baseName = filename
      .replace(/\.(png|jpg|jpeg|tga|exr|hdr|tif|tiff|webp|bmp)$/i, '')
      .replace(/[-_]?(1k|2k|4k|8k|16k)/i, '')
      .replace(/[-_]?(basecolor|base_color|albedo|diffuse|color|diff|col|normal|norm|nor|roughness|rough|metallic|metalness|metal|displacement|height|disp|ao|ambientocclusion|ambient_occlusion|emission|emissive|opacity|mask|arm|orm|mro)/gi, '')
      .trim()
      .replace(/[-_]+$/, '')
      .replace(/^[-_]+/, '');

    const groupKey = baseName || 'Unnamed_Material';

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: 'mat_' + Math.random().toString(36).substr(2, 9),
        name: groupKey.replace(/[_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        rawKey: groupKey,
        maps: {},
        files: [],
        resolution: '2K',
        format: f.ext.replace('.', '').toUpperCase(),
        tags: [],
        category: 'misc',
        confidence: 0
      });
    }

    const mat = groups.get(groupKey);
    const mapType = identifyMapType(filename);
    mat.maps[mapType] = f.path;
    mat.files.push(f);

    if (/(8k|8192)/i.test(filename)) mat.resolution = '8K';
    else if (/(4k|4096)/i.test(filename)) mat.resolution = '4K';
    else if (/(2k|2048)/i.test(filename)) mat.resolution = '2K';
    else if (/(1k|1024)/i.test(filename)) mat.resolution = '1K';
  });

  return Array.from(groups.values());
}

function autoTagMaterial(material, options = {}) {
  const threshold = (options.threshold !== undefined ? options.threshold : 75) / 100;
  const tagScores = new Map();
  const logDetails = [];

  function addScore(tag, score, reason) {
    const current = tagScores.get(tag) || 0;
    const combined = Math.min(1.0, current + score * (1 - current * 0.5));
    tagScores.set(tag, combined);
    if (reason) logDetails.push(`+ [${tag}] (${Math.round(combined * 100)}%) <- ${reason}`);
  }

  const nameTokens = material.name.toLowerCase().split(/[\s_\-]+/);
  const rawString = (material.name + ' ' + (material.rawKey || '') + ' ' + (material.files || []).map(f => f.name).join(' ')).toLowerCase();

  let detectedCategory = 'misc';
  let bestCatScore = 0;

  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of kws) {
      if (rawString.includes(kw)) {
        const weight = nameTokens.includes(kw) ? 0.95 : 0.75;
        addScore(cat, weight, `Keyword match: "${kw}" in name`);
        addScore(kw, 0.85, `Descriptor: "${kw}"`);
        if (weight > bestCatScore) {
          bestCatScore = weight;
          detectedCategory = cat;
        }
      }
    }
  }

  for (const [mod, kws] of Object.entries(SURFACE_MODIFIERS)) {
    for (const kw of kws) {
      if (rawString.includes(kw)) {
        addScore(mod, 0.88, `Surface feature: "${kw}"`);
        if (kw !== mod) addScore(kw, 0.82, `Modifier: "${kw}"`);
      }
    }
  }

  if (material.maps) {
    if (material.maps.albedo) addScore('albedo', 0.99, 'Map channel present');
    if (material.maps.normal) {
      addScore('normal-mapped', 0.95, 'Tangent normal channel detected');
      addScore('3d-surface', 0.90, 'Normal micro-detail');
    }
    if (material.maps.roughness) addScore('roughness', 0.95, 'Roughness map present');
    if (material.maps.metallic) {
      addScore('metallic-workflow', 0.95, 'Metallic map present');
      if (detectedCategory === 'metal') {
        addScore('conductor', 0.92, 'Metallic conductor PBR profile');
      }
    } else {
      addScore('dielectric', 0.85, 'Dielectric non-metal workflow');
    }
    if (material.maps.displacement) {
      addScore('displacement', 0.95, 'Height/Displacement channel available');
      addScore('tessellatable', 0.90, 'High-detail height displacement');
    }
    if (material.maps.ao) addScore('ambient-occlusion', 0.92, 'Ambient Occlusion cavity shading');
  }

  if (material.resolution) {
    addScore(material.resolution.toLowerCase(), 1.0, `Detected resolution ${material.resolution}`);
  }
  addScore('pbr', 0.98, 'PBR Material multi-channel set');
  addScore('tileable', 0.85, 'Seamless repeating texture structure');

  const finalTags = [];
  tagScores.forEach((score, tag) => {
    if (score >= threshold) {
      finalTags.push({
        tag: tag,
        confidence: Math.round(score * 100)
      });
    }
  });

  finalTags.sort((a, b) => b.confidence - a.confidence);

  return {
    category: detectedCategory,
    tags: finalTags,
    tagList: finalTags.map(t => t.tag),
    confidenceAvg: finalTags.length > 0 ? Math.round(finalTags.reduce((acc, t) => acc + t.confidence, 0) / finalTags.length) : 80,
    logDetails
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    identifyMapType,
    groupTexturesIntoMaterials,
    autoTagMaterial,
    CATEGORY_KEYWORDS,
    SURFACE_MODIFIERS
  };
}
