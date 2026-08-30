// pbrGenerator.js - Generates procedural PBR map sets (Albedo, Normal, Roughness, Metallic, AO)
const PBR_PRESETS = [
  {
    id: 'mat_oak_plank',
    name: 'Rustic Oak Plank',
    category: 'wood',
    resolution: '4K',
    format: 'PNG',
    tags: ['wood', 'oak', 'rustic', 'plank', 'timber', 'dielectric', 'pbr', '4k'],
    type: 'wood',
    baseColor: '#8a5229',
    secondaryColor: '#4a2c13',
    roughness: 0.65,
    metallic: 0.0
  },
  {
    id: 'mat_brushed_steel',
    name: 'Brushed Steel Plate',
    category: 'metal',
    resolution: '4K',
    format: 'PNG',
    tags: ['metal', 'steel', 'brushed', 'industrial', 'conductor', 'pbr', '4k'],
    type: 'brushed_metal',
    baseColor: '#c8ced4',
    secondaryColor: '#9ba4ac',
    roughness: 0.28,
    metallic: 0.95
  },
  {
    id: 'mat_rusted_iron',
    name: 'Rusted Iron Sheet',
    category: 'metal',
    resolution: '4K',
    format: 'PNG',
    tags: ['metal', 'iron', 'rust', 'weathered', 'industrial', 'decay', 'pbr', '4k'],
    type: 'rust',
    baseColor: '#5c2d1b',
    secondaryColor: '#303030',
    roughness: 0.78,
    metallic: 0.6
  },
  {
    id: 'mat_cyber_hex',
    name: 'Cyberpunk Hex Panel',
    category: 'scifi',
    resolution: '4K',
    format: 'PNG',
    tags: ['scifi', 'cyber', 'hex', 'panel', 'tech', 'futuristic', 'pbr', '4k'],
    type: 'hex_grid',
    baseColor: '#121820',
    secondaryColor: '#00f3ff',
    roughness: 0.35,
    metallic: 0.85
  },
  {
    id: 'mat_marble_tile',
    name: 'Carrara Marble Tile',
    category: 'stone',
    resolution: '4K',
    format: 'PNG',
    tags: ['stone', 'marble', 'tile', 'polished', 'interior', 'smooth', 'pbr', '4k'],
    type: 'marble',
    baseColor: '#f0f0f5',
    secondaryColor: '#63656d',
    roughness: 0.12,
    metallic: 0.0
  },
  {
    id: 'mat_cobblestone',
    name: 'Cobblestone Pavement',
    category: 'stone',
    resolution: '4K',
    format: 'PNG',
    tags: ['stone', 'cobble', 'pavement', 'exterior', 'rough', 'ground', 'pbr', '4k'],
    type: 'cobble',
    baseColor: '#78726e',
    secondaryColor: '#383634',
    roughness: 0.82,
    metallic: 0.0
  },
  {
    id: 'mat_denim_fabric',
    name: 'Denim Jean Weave',
    category: 'fabric',
    resolution: '2K',
    format: 'PNG',
    tags: ['fabric', 'denim', 'cotton', 'weave', 'cloth', 'dielectric', 'pbr', '2k'],
    type: 'fabric',
    baseColor: '#2b446a',
    secondaryColor: '#1a2940',
    roughness: 0.9,
    metallic: 0.0
  },
  {
    id: 'mat_gold_foil',
    name: 'Hammered Gold Foil',
    category: 'metal',
    resolution: '4K',
    format: 'PNG',
    tags: ['metal', 'gold', 'foil', 'conductor', 'shiny', 'polished', 'pbr', '4k'],
    type: 'gold',
    baseColor: '#ffd700',
    secondaryColor: '#d4af37',
    roughness: 0.22,
    metallic: 1.0
  },
  {
    id: 'mat_wet_asphalt',
    name: 'Wet Asphalt Pavement',
    category: 'concrete',
    resolution: '4K',
    format: 'PNG',
    tags: ['concrete', 'asphalt', 'wet', 'puddle', 'exterior', 'street', 'pbr', '4k'],
    type: 'asphalt',
    baseColor: '#222326',
    secondaryColor: '#111214',
    roughness: 0.3,
    metallic: 0.1
  },
  {
    id: 'mat_concrete_wall',
    name: 'Raw Concrete Wall',
    category: 'concrete',
    resolution: '4K',
    format: 'PNG',
    tags: ['concrete', 'cement', 'rough', 'industrial', 'grey', 'pbr', '4k'],
    type: 'concrete',
    baseColor: '#909294',
    secondaryColor: '#5c5e60',
    roughness: 0.85,
    metallic: 0.0
  }
];

if (typeof module !== 'undefined') {
  module.exports = { PBR_PRESETS };
}
