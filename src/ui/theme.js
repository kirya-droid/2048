export const THEME = {
  // фон сцены: мягкий градиент
  bgGradient: { from: 0x0f1724, to: 0x1a2740, angle: 22 },
  // стеклянные панели
  glass: { fill: 0x162132, alpha: 0.55, stroke: 0x3a4c6a, strokeAlpha: 0.8, radius: 16 },
  // тени/свечения
  shadow: { color: 0x0a0f18, alpha: 0.45, blur: 12, offsetY: 6 },
  glow: { color: 0x77c0ff, alpha: 0.85 },
  // типографика
  fontFamily: 'Inter, SF Pro, Segoe UI, Roboto, Arial, sans-serif',
  title:   { size: 36, weight: '800', color: '#f5f8ff' },
  h2:      { size: 22, weight: '700', color: '#e8f0ff' },
  body:    { size: 16, weight: '600', color: '#cfe0ff' },
  subtle:  { size: 14, weight: '500', color: '#9bb4ff' },
  // цвета плиток 2048 (градиенты)
  tile: {
    2:   { from: 0x234a74, to: 0x2f5d8f, text: '#ffffff', chip: '💧' },
    4:   { from: 0x1f6a7b, to: 0x2c8a92, text: '#ffffff', chip: '💧' },
    8:   { from: 0x1f7b6b, to: 0x2ea684, text: '#ffffff', chip: '🌱' },
    16:  { from: 0x2a8f6a, to: 0x48b57f, text: '#ffffff', chip: '🌱' },
    32:  { from: 0x39a35e, to: 0x66c769, text: '#0b1a10', chip: '🔥' },
    64:  { from: 0x6aba46, to: 0xa3dd58, text: '#0b1a10', chip: '🔥' },
    128: { from: 0xb3c73c, to: 0xe4e66a, text: '#0b1a10', chip: '🌪' },
    256: { from: 0xe0b73d, to: 0xf0c85f, text: '#0b1a10', chip: '⚡' },
    512: { from: 0xe08a3d, to: 0xf3a864, text: '#0b1a10', chip: '⚡' },
    1024:{ from: 0xde5e4f, to: 0xf3857e, text: '#ffffff', chip: '💎' },
    2048:{ from: 0xcc4566, to: 0xf471a4, text: '#ffffff', chip: '💎' },
    4096:{ from: 0x8e44ad, to: 0xb77ed6, text: '#ffffff', chip: '🌈' },
    8192:{ from: 0x34495e, to: 0x5a6e89, text: '#ffffff', chip: '🪐' },
    default: { from: 0x243249, to: 0x2e3e58, text: '#ffffff', chip: '✨' }
  },
  // анимации
  motion: {
    fast: 160,
    move: 100,
    merge: 140,
    micro: 90,
    easingInOut: 'Sine.easeInOut',
    easingOut: 'Cubic.easeOut',
  },
  // кнопки
  button: {
    h: 44, radius: 12,
    fill: 0x223249, fillActive: 0x2b3b55, stroke: 0x3a4c6a,
    text: '#eaf2ff'
  }
};
