import Phaser from 'phaser';
import { THEME } from './theme.js';

function makeTextureKey(base, w, h, extra=''){
  return `${base}-${w}x${h}${extra}`;
}

export function drawGradientRect(scene, x, y, w, h, {from,to,angle}){
  const key = makeTextureKey('grad', w, h, `-${from}-${to}-${angle}`);
  if (!scene.textures.exists(key)){
    const g = scene.make.graphics({x:0,y:0,add:false});
    g.fillGradientStyle(from, from, to, to, 1);
    g.fillRect(0,0,w,h);
    g.generateTexture(key,w,h);
    g.destroy();
  }
  return scene.add.image(x,y,key).setOrigin(0.5);
}

export function makeSoftShadow(scene, target, sh=THEME.shadow){
  const w = target.displayWidth || target.width || target.width || 0;
  const h = target.displayHeight || target.height || target.height || 0;
  const shadow = scene.add.graphics();
  shadow.fillStyle(sh.color, sh.alpha);
  shadow.fillRoundedRect(-w/2, -h/2, w, h, THEME.glass.radius);
  return scene.add.container(target.x, target.y + sh.offsetY, [shadow]).setDepth((target.depth||0)-1);
}

export function makeGlassPanel(scene,x,y,w,h){
  const panel = scene.add.container(x,y);
  const shadow = makeSoftShadow(scene, {x:0,y:0,width:w,height:h,depth:-1}, THEME.shadow);
  panel.add(shadow);
  const g = scene.add.graphics();
  g.fillStyle(THEME.glass.fill, THEME.glass.alpha);
  g.lineStyle(2, THEME.glass.stroke, THEME.glass.strokeAlpha);
  g.fillRoundedRect(-w/2,-h/2,w,h,THEME.glass.radius);
  g.strokeRoundedRect(-w/2,-h/2,w,h,THEME.glass.radius);
  panel.add(g);
  panel.setSize(w,h);
  return panel;
}

export function makeText(scene,x,y,txt,key='body'){
  const s = THEME[key] || THEME.body;
  const t = scene.add.text(x,y,txt,{
    fontFamily:THEME.fontFamily,
    fontSize:s.size,
    color:s.color,
    fontStyle:s.weight
  });
  t.setShadow(0,0,'#000',4,false,true);
  return t;
}

export function addTitleWithShine(scene, x, y, text, { shiny = true } = {}) {
  const title = makeText(scene, x, y, text, 'title').setOrigin(0.5);
  if (!shiny) return scene.add.container(0, 0, [title]);
  const shine = makeText(scene, x, y, text, 'title')
    .setOrigin(0.5)
    .setBlendMode(Phaser.BlendModes.ADD)
    .setAlpha(0);
  const barH = Math.ceil(title.height + 8), barW = 64;
  const maskG = scene.add.graphics().fillStyle(0xffffff, 1);
  maskG.fillRect(0, 0, barW, barH);
  const geomMask = maskG.createGeometryMask();
  shine.setMask(geomMask);
  const startX = x - title.displayWidth / 2 - 60;
  const endX = x + title.displayWidth / 2 + 60;
  maskG.x = startX; maskG.y = y - barH / 2;
  scene.tweens.add({
    targets: maskG,
    x: endX,
    duration: 2000,
    ease: THEME.motion.easingInOut,
    repeat: -1,
    yoyo: false,
    repeatDelay: 1200,
    onRepeat: () => { maskG.x = startX; },
    onStart: () => shine.setAlpha(0.9),
    onUpdate: () => shine.setAlpha(0.9)
  });
  return scene.add.container(0, 0, [title, shine]);
}
