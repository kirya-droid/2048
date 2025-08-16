export const THEME = {
  bgGradient: { from: 0x0b1220, to: 0x131b2b, angle: 18 },

  glass: { fill: 0x101827, alpha: 0.55, stroke: 0x253247, strokeAlpha: 0.85, radius: 16 },

  shadow: { color: 0x000000, alpha: 0.35, blur: 12, offsetY: 6 },
  glow:   { color: 0x7fd2ff, alpha: 0.8 },

  fontFamily: 'Inter, SF Pro, Segoe UI, Roboto, Arial, sans-serif',
  title:  { size: 34, weight: '800', color: '#F5F7FF' },
  h2:     { size: 20, weight: '700', color: '#E6EEFF' },
  body:   { size: 16, weight: '600', color: '#C7D8FF' },
  subtle: { size: 13, weight: '500', color: '#9BB4FF' },

  tile: {
    2:{from:0x1a2538,to:0x24324a,text:'#EAF2FF',chip:'💧'},
    4:{from:0x1b2c3f,to:0x2d3c55,text:'#EAF2FF',chip:'💧'},
    8:{from:0x1c4c48,to:0x2f6a62,text:'#F0FBFF',chip:'🌱'},
    16:{from:0x1e6a5b,to:0x328a74,text:'#F0FBFF',chip:'🌱'},
    32:{from:0x2b7f58,to:0x49a06d,text:'#0b1a10',chip:'🔥'},
    64:{from:0x52b047,to:0x8ad65a,text:'#0b1a10',chip:'🔥'},
    128:{from:0xaac73b,to:0xdde66a,text:'#0b1a10',chip:'🌪'},
    256:{from:0xd3b23d,to:0xe8c961,text:'#0b1a10',chip:'⚡'},
    512:{from:0xd07d3e,to:0xeea363,text:'#0b1a10',chip:'⚡'},
    1024:{from:0xc45a63,to:0xe07e94,text:'#ffffff',chip:'💎'},
    2048:{from:0x9c4b88,to:0xc86fad,text:'#ffffff',chip:'💎'},
    4096:{from:0x6b57b2,to:0x8a7ad2,text:'#ffffff',chip:'🌈'},
    8192:{from:0x304058,to:0x516685,text:'#ffffff',chip:'🪐'},
    default:{from:0x1d2a3f,to:0x2a3a54,text:'#ffffff',chip:'✨'},
  },

  motion: { fast:160, move:100, merge:140, micro:90, easingInOut:'Sine.easeInOut', easingOut:'Cubic.easeOut' },

  button: { h:44, radius:12, fill:0x1a2a40, fillActive:0x24354f, stroke:0x3a4c6a, text:'#EAF2FF' }
};
