// src/scenes/GameScene.js
import Phaser from 'phaser';
import {
  showRewarded,
  showInterstitial,
  setAdHooks,
  setLeaderboardScore,
  saveData,
  loadData,
  getPlayerName
} from '../sdk/yandex.js';
import { THEME } from '../ui/theme.js';
import { drawGradientRect, makeGlassPanel, makeText, addTitleWithShine } from '../ui/fx.js';

const GRID = 4, TILE = 104, GAP = 10;
const BOARD_W = GRID * TILE + (GRID + 1) * GAP;
const BOARD_H = GRID * TILE + (GRID + 1) * GAP;

const START_TILES = 2;
const UNDO_PER_SCORE = 1000;
const MAX_HISTORY = 80;

const X2_SPAWN_EVERY_SEC = 120;
const X2_DURATION_SEC = 30;

const DEFAULT_MUSIC_ON = true;
const DEFAULT_SFX_ON = true;

export default class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.resetState();
  }

  resetState() {
    this.grid = [];
    this.tiles = new Set();

    this.score = 0;
    this.bestScore = 0;
    this.lastScore = 0;

    this.isMoving = false;
    this.allowInput = true;
    this.isMenuOpen = false;

    this.undoCount = 0;
    this.history = [];
    this.nextUndoThreshold = UNDO_PER_SCORE;

    this.hammerCount = 0;
    this.hammerMode = false;

    this.doubleActive = false;
    this.doubleUntil = 0;
    this.doubleTimerText = null;

    this.mergesThisRun = 0;
    this.maxTileThisRun = 2;

    this.musicOn = DEFAULT_MUSIC_ON;
    this.sfxOn = DEFAULT_SFX_ON;

    this.ac = null;
    this.musicNodes = [];

    this.buttons = {};
    this.buttonsGroup = null;

    this.menuLayer = null;
    this.nickname = null;

    // визуальные слои
    this.boardDepth = 50;
    this.fxDepth = 150;
    this.uiDepth = 200;
    this.menuDepth = 10000;
    this.overlayDepth = 9000;
  }

  async create() {
    // очистка старых обработчиков на всякий случай
    this.input.keyboard.removeAllListeners();
    this.input.removeAllListeners();

    setAdHooks({
      onOpen: () => {
        this.physics?.world?.pause?.();
        this.time?.pause?.();
        if (this.sound) this.sound.mute = true;
      },
      onClose: () => {
        this.physics?.world?.resume?.();
        this.time?.resume?.();
        if (this.sound) this.sound.mute = false;
      }
    });

    const W = this.scale.width, H = this.scale.height;
    this.centerX = W / 2;
    this.topY = Math.max(80, (H - BOARD_H) / 2 - 16);

    const bg = drawGradientRect(this, W / 2, H / 2, W, H, THEME.bgGradient);
    bg.setDepth(-1000);

    this.createSparkTexture();
    this.addHeader();
    this.drawBoard();
    this.initGrid();
    for (let i = 0; i < START_TILES; i++) this.spawnRandomTile();

    await this.loadProgress();
    await this.ensureNickname();
    this.updateUI();

    this.layoutButtonsUnderBoard();
    this.initInput();
    this.initAudio(); if (this.musicOn) this.deferStartMusic();

    // страховка ввода
    this.allowInput = true;
    if (this.input.keyboard) this.input.keyboard.enabled = true;

    // периодический спавн x2
    this.time.addEvent({
      delay: X2_SPAWN_EVERY_SEC * 1000,
      loop: true,
      callback: () => this.spawnX2Bonus()
    });
  }

  /* -------------------- Ник -------------------- */
  async ensureNickname() {
    let nick = localStorage.getItem('yag-2048-nick');
    if (!nick) {
      try { nick = await getPlayerName(); } catch (e) {}
      if (!nick) {
        nick = (prompt('Введите ваш ник (2–16 символов):', 'Игрок') || 'Игрок').trim().slice(0, 16);
      }
      if (nick.length < 2) nick = 'Игрок';
      localStorage.setItem('yag-2048-nick', nick);
    }
    this.nickname = nick;
    if (!this.nickText) {
      this.nickText = makeText(this, this.centerX, 14, '👤 ' + this.nickname, 'subtle')
        .setOrigin(0.5).setDepth(this.uiDepth);
    } else {
      this.nickText.setText('👤 ' + this.nickname);
    }
  }

  /* -------------------- UI -------------------- */
  addHeader(){
  this.title = addTitleWithShine(this, this.centerX, 42, '2048: Elements');
  this.title.setDepth(this.uiDepth);

  this.nickText = makeText(this, this.centerX, 14, '👤 ' + (this.nickname || ''), 'subtle')
      .setOrigin(0.5).setDepth(this.uiDepth);

  const panelY = 86, panelW = 460, panelH = 48;
  this.scorePanel = makeGlassPanel(this, this.centerX, panelY, panelW, panelH).setDepth(this.uiDepth);

  this.scoreText = makeText(this, this.centerX - panelW/2 + 12, panelY, 'Счёт: 0', 'h2')
      .setOrigin(0,0.5).setDepth(this.uiDepth);
  this.bestText = makeText(this, this.centerX + panelW/2 - 44, panelY, 'Рекорд: 0', 'body')
      .setOrigin(1,0.5).setDepth(this.uiDepth);

  const menuBtn = this.add.rectangle(this.centerX + panelW/2 - 16, panelY, 24, 24, THEME.button.fill)
      .setStrokeStyle(2, THEME.button.stroke).setInteractive({useHandCursor:true}).setDepth(this.uiDepth);
  makeText(this, menuBtn.x, menuBtn.y, '≡', 'body').setOrigin(0.5).setDepth(this.uiDepth);
  menuBtn.on('pointerdown',()=>menuBtn.fillColor=THEME.button.fillActive);
  menuBtn.on('pointerup',()=>{ menuBtn.fillColor=THEME.button.fill; this.playSfx('click'); this.openMenu(); });

  this.statusText = makeText(this, this.centerX, panelY + panelH/2 + 14, '', 'subtle')
      .setOrigin(0.5).setDepth(this.uiDepth);
}

  layoutButtonsUnderBoard() {
    const y = this.topY + BOARD_H + 48;
    this.buttonsGroup = this.add.container(this.centerX, y).setDepth(this.uiDepth);

    const bw = 132, bh = 44, space = 16;

    this.buttons.newGame = this.createButton(-bw - space / 2, 0, bw, bh, 'Новая', () => this.newGame());
    this.buttons.undo    = this.createButton(0, 0, bw, bh, 'Отмена (0)', () => this.useUndo());
    this.buttons.hammer  = this.createButton(+bw + space / 2, 0, bw, bh, 'Молоток (0)', () => this.toggleHammerMode());

    this.buttonsGroup.add([
      this.buttons.newGame.container,
      this.buttons.undo.container,
      this.buttons.hammer.container
    ]);
  }

  createButton(x, y, w, h, label, onClick) {
    const cont = this.add.container(x, y).setDepth(this.uiDepth);
    const key = `btn-${w}x${h}`;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillStyle(THEME.button.fill, 1);
      g.lineStyle(2, THEME.button.stroke, 1);
      g.fillRoundedRect(0, 0, w, h, THEME.button.radius);
      g.strokeRoundedRect(0, 0, w, h, THEME.button.radius);
      g.generateTexture(key, w, h);
      g.destroy();
    }
    const bg = this.add.image(0, 0, key).setInteractive({ useHandCursor: true }).setOrigin(0.5);
    const text = makeText(this, 0, 0, label, 'body').setOrigin(0.5).setColor(THEME.button.text);

    bg.on('pointerover', () => {
      this.tweens.add({ targets: cont, scale: 1.02, duration: THEME.motion.micro, ease: THEME.motion.easingInOut });
    });
    bg.on('pointerout', () => {
      this.tweens.add({ targets: cont, scale: 1, duration: THEME.motion.micro, ease: THEME.motion.easingInOut });
      bg.clearTint();
    });
    bg.on('pointerdown', () => {
      bg.setTint(THEME.button.fillActive);
      this.tweens.add({ targets: cont, scale: 0.98, duration: THEME.motion.micro });
    });
    bg.on('pointerup', () => {
      bg.clearTint();
      this.tweens.add({ targets: cont, scale: 1, duration: THEME.motion.micro });
      this.playSfx('click');
      onClick();
    });

    cont.add([bg, text]);
    cont.setSize(w, h);
    return { container: cont, rect: bg, text: text };
  }

  updateButtons(){
    // Отмена
    if (this.buttons.undo){
      this.buttons.undo.text.setText('Отмена (' + this.undoCount + ')');
      if (this.undoCount <= 0){
        this.buttons.undo.rect.setTint(0x2a2f3f);
        this.buttons.undo.rect.disableInteractive();
      } else {
        this.buttons.undo.rect.clearTint();
        this.buttons.undo.rect.setInteractive({ useHandCursor:true });
      }
    }
    // Молоток
    if (this.buttons.hammer){
      this.buttons.hammer.text.setText('Молоток (' + this.hammerCount + ')');
      if (this.hammerCount <= 0){
        this.buttons.hammer.rect.setTint(0x2a2f3f);
        this.buttons.hammer.rect.disableInteractive();
      } else {
        this.buttons.hammer.rect.clearTint();
        this.buttons.hammer.rect.setInteractive({ useHandCursor:true });
      }
    }
  }

  /* -------------------- Меню -------------------- */
  openMenu() {
    if (this.isMenuOpen) return;
    this.isMenuOpen = true;
    this.allowInput = false;
    if (this.input.keyboard) this.input.keyboard.enabled = false;

    // единый слой меню — одним destroy убираем всё
    this.menuLayer = this.add.container(0, 0).setDepth(this.menuDepth);

    const boxW = 440, boxH = 520;
    const overlay = this.add.rectangle(this.scale.width / 2, this.scale.height / 2,
      this.scale.width, this.scale.height, 0x000000).setAlpha(0.6).setInteractive();
    const box = this.add.rectangle(this.centerX, this.topY + 30, boxW, boxH, 0x1b2330)
      .setStrokeStyle(2, 0x2a3547).setOrigin(0.5, 0);
    const title = makeText(this, box.x, box.y + 16, 'Меню', 'h2').setOrigin(0.5, 0);
    const content = this.add.container(0, 0);

    this.menuLayer.add([overlay, box, title, content]);

    const tabs = ['Рейтинг', 'Задания', 'Настройки'];
    let active = 1; // по умолчанию «Задания»
    const tabW = 120, gap = 10, pad = 14, startX = box.x - boxW / 2 + pad + tabW / 2;

    const draw = () => {
      content.removeAll(true);
      for (let i = 0; i < tabs.length; i++) {
        const on = i === active;
        const cx = startX + i * (tabW + gap);
        const r = this.add.rectangle(cx, box.y + 56, tabW, 32, on ? 0x2b3a52 : 0x253145)
          .setStrokeStyle(2, 0x3a4c6a).setInteractive({ useHandCursor: true });
        const t = makeText(this, cx, r.y, tabs[i], 'body').setOrigin(0.5);
        r.on('pointerup', () => { this.playSfx('click'); active = i; draw(); });
        content.add([r, t]);
      }
      if (active === 0) this.fillLeaderboard(content, box);
      if (active === 1) this.fillQuests(content, box);
      if (active === 2) this.fillSettings(content, box);
    };
    draw();

    const closeBtn = this.createButton(box.x, box.y + boxH - 26, 170, 38, 'Закрыть', () => this.closeMenu());
    this.menuLayer.add(closeBtn.container);

    // ESC закрывает меню
    if (this.input.keyboard) {
      this.input.keyboard.once('keydown-ESC', () => this.closeMenu());
    }
  }

  closeMenu() {
    if (this.menuLayer) {
      try { this.menuLayer.destroy(true); } catch (e) {}
      this.menuLayer = null;
    }
    this.isMenuOpen = false;
    this.allowInput = true;
    if (this.input.keyboard) this.input.keyboard.enabled = true;

    // вернуть кнопки поверх
    if (this.buttonsGroup) this.children.bringToTop(this.buttonsGroup);
  }

  fillLeaderboard(cont, box) {
    cont.add(makeText(this, box.x, box.y + 96, 'Локальный рейтинг (топ‑10)', 'body').setOrigin(0.5,0));
    const scores = getLocalTopScores();
    if (!scores.length) {
      cont.add(makeText(this, box.x, box.y + 140, 'Пока пусто. Сыграйте партию!', 'subtle').setOrigin(0.5,0));
      return;
    }
    const xL = box.x - 180, y0 = box.y + 140;
    for (let i = 0; i < Math.min(10, scores.length); i++) {
      const s = scores[i];
      cont.add(makeText(this, xL, y0 + i * 28, (i + 1) + '. ' + s.score + '  —  ' + new Date(s.ts).toLocaleString() + ' — ' + (s.nick || 'Игрок'), 'body').setOrigin(0,0));
    }
  }

  fillQuests(cont, box) {
    const d = this.loadDaily();
    cont.add(makeText(this, box.x, box.y + 96, 'Ежедневные задания', 'body').setOrigin(0.5,0));

    const items = [
      { key: 'play1',  title: 'Сыграй 1 партию',   progress: d.played ? 1 : 0, total: 1,  reward: '+1 молоток',
        onClaim: () => { this.hammerCount += 1; this.updateButtons(); this.playSfx('claim'); } },
      { key: 'merge10',title: 'Сделай 10 слияний', progress: Math.min(d.merges, 10), total: 10, reward: '+3 отмены',
        onClaim: () => { this.undoCount += 3; this.updateButtons(); this.playSfx('claim'); } },
      { key: 'tile128',title: 'Собери плитку 128', progress: d.maxTile >= 128 ? 1 : 0, total: 1,  reward: '+500 очков',
        onClaim: () => { this.addScore(500); this.playSfx('claim'); } }
    ];

    const cardW = box.displayWidth - 60, cardH = 86, startY = box.y + 140, x = box.x - cardW / 2;
    let y = startY;

    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const p = it.progress / it.total;
      const complete = p >= 1;
      const claimed = d.claimed && d.claimed[it.key];

      const card = makeGlassPanel(this, box.x, y + cardH / 2, cardW, cardH);
      const title = makeText(this, x + 14, y + 12, it.title, 'body').setOrigin(0,0);
      const reward = makeText(this, x + 14, y + 36, 'Награда: ' + it.reward, 'subtle').setOrigin(0,0);

      const pbX = x + 14, pbY = y + 60, pbW = cardW - 14 - 140, pbH = 12;
      const pbBg = this.add.rectangle(pbX + pbW / 2, pbY, pbW, pbH, 0x233042);
      const pbFillW = Math.round(pbW * Math.min(1, p));
      const pbFill = this.add.rectangle(pbX + pbFillW / 2, pbY, pbFillW, pbH, 0x6aba46);

      const btn = this.createButton(x + cardW - 80, pbY, 120, 34,
        claimed ? 'Забрано' : (complete ? 'Забрать' : 'Недоступно'),
        () => {
          if (!complete || claimed) return;
          it.onClaim();
          if (!d.claimed) d.claimed = {};
          d.claimed[it.key] = true;
          this.saveDaily(d);
          cont.removeAll(true);
          this.fillQuests(cont, box);
        });
      if (!complete || claimed) {
        btn.rect.fillColor = 0x2a2f3f;
        btn.rect.disableInteractive();
      }

      cont.add([card, title, reward, pbBg, pbFill, btn.container]);
      y += cardH + 14;
    }

    cont.add(makeText(this, box.x, y + 4, 'Ежедневные задания обновляются раз в день', 'subtle').setOrigin(0.5,0));
  }

  // Настройки с «пилюльными» тумблерами
  fillSettings(cont, box){
  const xLabel = box.x - 140;     // колонка подписей
  const xToggle = box.x + 110;    // колонка тумблеров
  const y0 = box.y + 150, step = 60;

  // Локальный хелпер: «пилюля» с бегунком
  const makePillToggle = (cx, cy, state, onChange) => {
    const w=92, h=34, r=17;
    const contT = this.add.container(cx, cy);
    const g = this.add.graphics(); contT.add(g);

    const knob = this.add.circle(0, 0, r-3, 0xffffff).setStrokeStyle(2, 0x3a4c6a);
    contT.add(knob);

    const draw = () => {
      g.clear();
      g.lineStyle(2, 0x3a4c6a, 1);
      g.fillStyle(state ? 0x2c7e79 : 0x5a6374, 1);
      g.fillRoundedRect(-w/2, -h/2, w, h, r);
      g.strokeRoundedRect(-w/2, -h/2, w, h, r);
      knob.x = state ? (w/2 - r) : (-w/2 + r);
    };
    draw();

    const zone = this.add.zone(0,0,w,h).setInteractive({ useHandCursor:true });
    zone.on('pointerup', ()=>{ this.playSfx('click'); state=!state; onChange(state); draw(); });
    contT.add(zone);

    return contT;
  };

  // Ряды «Музыка» / «Звуки»
  const lblMusic = makeText(this, xLabel, y0, 'Музыка', 'body').setOrigin(1,0.5);
  const togMusic = makePillToggle(xToggle, y0, this.musicOn, (v)=>{ this.musicOn=v; if(v) this.startMusic(); else this.stopMusic(); this.saveSettings(); });

  const lblSfx = makeText(this, xLabel, y0+step, 'Звуки', 'body').setOrigin(1,0.5);
  const togSfx = makePillToggle(xToggle, y0+step, this.sfxOn, (v)=>{ this.sfxOn=v; this.saveSettings(); });

  // --- Кнопки вертикально по центру ---
  const btnW = Math.min(280, box.displayWidth - 160); // безопасная ширина
  const btnH = 36;
  const btnY1 = y0 + step*2 + 10;       // Сменить ник
  const btnY2 = btnY1 + btnH + 16;      // +10 отмен за рекламу

  const btnNick = this.createButton(box.x, btnY1, btnW, btnH, 'Сменить ник', ()=>{
    const n=(prompt('Введите новый ник (2–16):', this.nickname||'Игрок')||'').trim().slice(0,16);
    if(n.length>=2){ this.nickname=n; localStorage.setItem('yag-2048-nick',n); if (this.nickText) this.nickText.setText('👤 '+this.nickname); }
  });

  const btnAds  = this.createButton(box.x, btnY2, btnW, btnH, '+10 отмен за рекламу', async ()=>{
    const ok = await showRewarded();
    if (!ok) return;
    this.undoCount+=10; this.updateButtons(); this.flashStatus('+10 отмен получено'); this.playSfx('claim');
  });

  cont.add([lblMusic, togMusic, lblSfx, togSfx, btnNick.container, btnAds.container]);
}


  /* -------------------- Доска/логика -------------------- */
  drawBoard() {
    const x0 = this.centerX - BOARD_W / 2, y0 = this.topY;
    this.add.rectangle(this.centerX, y0 + BOARD_H / 2, BOARD_W, BOARD_H, 0x161d27)
      .setStrokeStyle(3, 0x2a3547).setDepth(this.boardDepth);
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const cx = x0 + GAP + c * (TILE + GAP) + TILE / 2;
      const cy = y0 + GAP + r * (TILE + GAP) + TILE / 2;
      this.add.rectangle(cx, cy, TILE, TILE, 0x1b2330).setAlpha(0.35).setDepth(this.boardDepth);
    }
  }

  initGrid() {
    this.grid = [];
    for (let r = 0; r < GRID; r++) this.grid[r] = new Array(GRID).fill(null);

    this.tiles.forEach(t => t.container.destroy());
    this.tiles.clear();

    this.score = 0;
    this.history = [];
    this.undoCount = 0;
    this.nextUndoThreshold = UNDO_PER_SCORE;

    this.hammerMode = false;
    this.doubleActive = false;
    this.doubleUntil = 0;

    if (this.doubleTimerText) { this.doubleTimerText.destroy(); this.doubleTimerText = null; }
  }

  xyToPixel(r, c) {
    const x0 = this.centerX - BOARD_W / 2, y0 = this.topY;
    return { x: x0 + GAP + c * (TILE + GAP) + TILE / 2, y: y0 + GAP + r * (TILE + GAP) + TILE / 2 };
  }

  createTile(r, c, value) {
    const p = this.xyToPixel(r, c);
    const cont = this.add.container(p.x, p.y).setDepth(120);
    cont.setSize(TILE, TILE); cont.setInteractive();

    const style = tileStyleFor(value);
    const key = `tile-${value}-${TILE}`;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillGradientStyle(style.from, style.from, style.to, style.to, 1);
      g.fillRoundedRect(-TILE/2,-TILE/2,TILE,TILE,THEME.glass.radius);
      g.generateTexture(key, TILE, TILE);
      g.destroy();
    }
    const rect = this.add.image(0, 0, key).setDisplaySize(TILE, TILE);
    const highlight = this.add.graphics();
    highlight.fillStyle(0xffffff,0.15);
    highlight.fillRoundedRect(-TILE/2,-TILE/2,TILE,TILE,THEME.glass.radius);

    const text = makeText(this, 0, -8, '' + value, 'title')
      .setOrigin(0.5).setColor(style.text)
      .setFontSize(value >= 1024 ? 32 : value >= 128 ? 38 : 44);
    const el = makeText(this, 0, TILE / 2 - 28, style.chip, 'body')
      .setOrigin(0.5).setFontSize(20).setColor(style.text);

    cont.add([rect, highlight, text, el]);
    cont.setScale(0);
    this.tweens.add({ targets: cont, scale: 1, duration: THEME.motion.fast, ease: THEME.motion.easingOut });

    const tile = { r: r, c: c, value: value, container: cont, rect: rect, text: text, el: el, destroyed: false };
    this.tiles.add(tile);

    cont.on('pointerup', () => {
      if (this.hammerMode && this.hammerCount > 0 && !this.isMoving && !this.isMenuOpen) this.useHammerOn(tile);
    });

    cont.on('pointerover', () => {
      if (this.hammerMode) {
        this.tweens.add({ targets: cont, scale: 1.03, duration: THEME.motion.micro, yoyo: true });
      }
    });

    return tile;
  }

  chooseSpawnValue() {
    const m = this.calcMaxTile();
    let w2 = 0.9, w4 = 0.1, w8 = 0.0;
    if (m >= 128)  { w2 = 0.3; w4 = 0.7; w8 = 0.0; }
    if (m >= 256)  { w2 = 0.1; w4 = 0.8; w8 = 0.1; }
    if (m >= 512)  { w2 = 0.0; w4 = 0.85; w8 = 0.15; }
    if (m >= 1024) { w2 = 0.0; w4 = 0.7;  w8 = 0.3; }
    const r = Math.random();
    if (r < w2) return 2;
    if (r < w2 + w4) return 4;
    return 8;
  }

  calcMaxTile() {
    let max = 2;
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const v = this.grid[r][c] ? this.grid[r][c].value : 0;
      if (v > max) max = v;
    }
    return Math.max(max, this.maxTileThisRun);
  }

  spawnRandomTile() {
    const empty = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (!this.grid[r][c]) empty.push({ r: r, c: c });
    if (!empty.length) return false;
    const pick = Phaser.Utils.Array.GetRandom(empty);
    const value = this.chooseSpawnValue();
    const t = this.createTile(pick.r, pick.c, value);
    this.grid[pick.r][pick.c] = t;
    this.playSfx('spawn');
    return true;
  }

  /* -------------------- Ввод -------------------- */
  initInput() {
    // Клавиатура
    if (this.input.keyboard) {
      this.input.keyboard.on('keydown', (e) => {
        if (!this.allowInput || this.isMenuOpen) return;
        const map = {
          ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
          a: 'left', d: 'right', w: 'up', s: 'down'
        };
        const dir = map[e.key];
        if (dir) this.handleMove(dir);
      });
      this.input.keyboard.enabled = true;
    }

    // Свайпы
    let sx = 0, sy = 0, down = false;
    this.input.on('pointerdown', (p) => { if (this.isMenuOpen) return; down = true; sx = p.x; sy = p.y; });
    this.input.on('pointerup', (p) => {
      if (!down || this.isMenuOpen) return;
      down = false;
      const dx = p.x - sx, dy = p.y - sy;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < 24) return;
      const dir = ax > ay ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (this.allowInput) this.handleMove(dir);
    });
  }

  async handleMove(dir) {
    if (this.isMoving) return;
    this.pushSnapshot();
    this.isMoving = true;
    this.allowInput = false;

    const moved = await this.slide(dir);
    if (moved) {
      this.playSfx('move');
      this.spawnRandomTile();
      if (this.isGameOver()) {
        await this.onGameOver();
        this.isMoving = false;
        this.allowInput = true;
        return;
      }
    } else {
      this.history.pop();
    }

    this.isMoving = false;
    this.allowInput = true;
  }

  async slide(dir) {
    let any = false;
    const tweens = [];

    const line = (li) => {
      if (dir === 'left' || dir === 'right') {
        const arr = [];
        for (let c = 0; c < GRID; c++) arr.push({ r: li, c: c });
        return dir === 'left' ? arr : arr.reverse();
      } else {
        const arr = [];
        for (let r = 0; r < GRID; r++) arr.push({ r: r, c: li });
        return dir === 'up' ? arr : arr.reverse();
      }
    };

    for (let li = 0; li < GRID; li++) {
      const idx = line(li);
      const tiles = [];
      for (let i = 0; i < idx.length; i++) {
        const t = this.grid[idx[i].r][idx[i].c];
        if (t) tiles.push(t);
      }
      const out = new Array(GRID).fill(null);
      let dst = 0;

      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        if (i < tiles.length - 1 && tiles[i + 1].value === t.value) {
          const keep = t, kill = tiles[i + 1];
          keep.value *= 2;
          this.addScore(keep.value);
          this.mergesThisRun++;
          this.maxTileThisRun = Math.max(this.maxTileThisRun, keep.value);

          const tp = idx[dst];
          out[dst] = keep;
          const pKeep = this.xyToPixel(tp.r, tp.c);

          if (Math.abs(keep.container.x - pKeep.x) > 1 || Math.abs(keep.container.y - pKeep.y) > 1) {
            tweens.push(this.tweenMoveTo(keep.container, pKeep.x, pKeep.y));
            any = true;
          }
          tweens.push(this.tweenMoveTo(kill.container, pKeep.x, pKeep.y, () => {
            kill.destroyed = true; kill.container.destroy(); this.tiles.delete(kill);
          }));
          any = true;

          if (keep.value >= 2048) { const pos = this.xyToPixel(tp.r, tp.c); this.emitFireworks(pos.x, pos.y); }
          this.playSfx('merge');
          this.tweens.add({ targets: keep.container, scale: 1.08, yoyo: true, duration: THEME.motion.merge });
          i++; dst++;
        } else {
          const tp = idx[dst];
          out[dst] = t;
          const p = this.xyToPixel(tp.r, tp.c);
          if (Math.abs(t.container.x - p.x) > 1 || Math.abs(t.container.y - p.y) > 1) {
            tweens.push(this.tweenMoveTo(t.container, p.x, p.y));
            any = true;
          }
          dst++;
        }
      }

      for (let j = 0; j < GRID; j++) {
        const cell = idx[j];
        const tile = out[j];
        if (tile) { tile.r = cell.r; tile.c = cell.c; }
        this.grid[cell.r][cell.c] = tile ? tile : null;
      }
    }

    await Promise.all(tweens);
    this.tiles.forEach(t => {
      if (!t.destroyed) {
        const style = tileStyleFor(t.value);
        const key = `tile-${t.value}-${TILE}`;
        if (!this.textures.exists(key)) {
          const g = this.add.graphics();
          g.fillGradientStyle(style.from, style.from, style.to, style.to, 1);
          g.fillRoundedRect(-TILE/2,-TILE/2,TILE,TILE,THEME.glass.radius);
          g.generateTexture(key, TILE, TILE);
          g.destroy();
        }
        t.rect.setTexture(key).setDisplaySize(TILE, TILE);
        t.text.setText('' + t.value);
        t.text.setFontSize(t.value >= 1024 ? 32 : t.value >= 128 ? 38 : 44).setColor(style.text);
        t.el.setText(style.chip).setColor(style.text);
      }
    });
    return any;
  }

  serializeGrid() {
    const arr = [];
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      arr.push(this.grid[r][c] ? this.grid[r][c].value : 0);
    }
    return arr;
  }

  pushSnapshot() {
    const snap = { grid: this.serializeGrid(), score: this.score, undoThreshold: this.nextUndoThreshold, undo: this.undoCount };
    this.history.push(snap);
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  useUndo() {
    if (this.isMoving || this.history.length === 0 || this.undoCount <= 0) return;
    const snap = this.history.pop();
    this.undoCount--;                 // уменьшаем ЗДЕСЬ
    this.restoreSnapshot(snap);       // и НЕ восстанавливаем его из снапшота
    this.flashStatus('Ход отменён');
    this.updateButtons();
    this.playSfx('undo');
  }

  restoreSnapshot(s){
    this.tiles.forEach(t=>t.container.destroy());
    this.tiles.clear();

    let i=0;
    for(let r=0;r<GRID;r++) for(let c=0;c<GRID;c++){
      const v=s.grid[i++];
      this.grid[r][c]=v?this.createTile(r,c,v):null;
    }

    this.score = s.score || 0;
    this.nextUndoThreshold = s.undoThreshold || UNDO_PER_SCORE;
    // this.undoCount НЕ восстанавливаем — он уже уменьшен в useUndo()
    this.updateUI();
  }

  useHammerOn(tile) {
    if (this.hammerCount <= 0) return;
    const r = tile.r, c = tile.c;
    tile.destroyed = true;
    this.tweens.add({ targets: tile.container, scale: 0, duration: 120, onComplete: () => tile.container.destroy() });
    this.tiles.delete(tile);
    this.grid[r][c] = null;
    this.hammerCount--;
    this.hammerMode = false;
    this.updateButtons();
    this.flashStatus('Плитка удалена');
    this.playSfx('hammer');
  }

  toggleHammerMode() {
    if (this.hammerCount <= 0) {
      this.flashStatus('Нет молотков'); this.playSfx('error'); return;
    }
    this.hammerMode = !this.hammerMode;
    this.flashStatus(this.hammerMode ? 'Молоток активен: тап по плитке' : 'Молоток выключен');
    this.playSfx('toggle');
  }

  async onGameOver() {
    try {
      if (typeof this.score === 'number') {
        await setLeaderboardScore('2048-elements-best', this.score|0);
      }
      if (this.bestScore == null || this.score > this.bestScore) {
        this.bestScore = this.score;
        await saveData('bestScore', this.bestScore);
      }
    } catch {}
    await showInterstitial().catch(()=>{});
    this.updateUI();
    pushLocalScore(this.score, this.nickname || 'Игрок');

    const d = this.loadDaily();
    d.played = true;
    d.merges += this.mergesThisRun;
    d.maxTile = Math.max(d.maxTile || 0, this.maxTileThisRun);
    this.saveDaily(d);

    this.showGameOverOverlay('Игра окончена');
    this.playSfx('gameover');
  }

  showGameOverOverlay(msg) {
    const overlay = this.add.rectangle(this.centerX, this.topY + BOARD_H / 2, BOARD_W, BOARD_H, 0x000000)
      .setAlpha(0.6).setInteractive().setDepth(this.overlayDepth);
    const box = makeGlassPanel(this, this.centerX, overlay.y, 320, 220).setDepth(this.overlayDepth + 1);
    const t = makeText(this, this.centerX, overlay.y - 50, msg || 'Игра окончена', 'h2')
      .setOrigin(0.5).setDepth(this.overlayDepth + 1);
    const s = makeText(this, this.centerX, overlay.y - 10, 'Счёт: ' + this.score, 'body')
      .setOrigin(0.5).setDepth(this.overlayDepth + 1);

    const b = this.createButton(this.centerX, overlay.y + 48, 200, 44, 'Сыграть ещё раз', () => {
      overlay.destroy(); box.destroy(); t.destroy(); s.destroy(); b.container.destroy();
      this.resetState(); this.scene.restart();
    });
    b.container.setDepth(this.overlayDepth + 1);
  }

  spawnX2Bonus() {
    const x = this.centerX + BOARD_W / 2 - 24, y = this.topY - 10;
    const r = this.add.circle(x, y, 18, 0xcc4566).setStrokeStyle(2, 0xffffff)
      .setInteractive({ useHandCursor: true }).setDepth(this.uiDepth);
    const t = makeText(this, x, y, 'x2', 'body').setOrigin(0.5).setDepth(this.uiDepth);
    this.tweens.add({ targets: [r, t], y: y + 8, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    const timeout = this.time.delayedCall(15000, () => { try { r.destroy(); t.destroy(); } catch (e) {} });
    r.on('pointerup', async () => {
      timeout.remove(); r.destroy(); t.destroy();
      const ok = await showRewarded();
      if (!ok) return;
      this.activateDouble(); this.playSfx('claim');
    });
  }

  activateDouble() {
    this.doubleActive = true;
    this.doubleUntil = this.time.now + X2_DURATION_SEC * 1000;
    if (this.doubleTimerText) this.doubleTimerText.destroy();
    this.doubleTimerText = makeText(this, this.centerX, 104, 'x2: ' + X2_DURATION_SEC + 's', 'body')
      .setOrigin(0.5).setColor('#ffd166');
    const timer = this.time.addEvent({
      delay: 1000, repeat: X2_DURATION_SEC,
      callback: () => {
        const left = Math.max(0, Math.ceil((this.doubleUntil - this.time.now) / 1000));
        if (this.doubleTimerText) this.doubleTimerText.setText('x2: ' + left + 's');
        if (left <= 0) { this.doubleActive = false; if (this.doubleTimerText) this.doubleTimerText.destroy(); this.doubleTimerText = null; timer.remove(); }
      }
    });
    this.flashStatus('Бонус x2 активен');
  }

  tweenMoveTo(target, x, y, onComplete) {
    return new Promise(res => this.tweens.add({
      targets: target, x: x, y: y, duration: 100, ease: 'Quad.Out',
      onComplete: () => { if (onComplete) onComplete(); res(true); }
    }));
  }

  addScore(v) {
    const add = this.doubleActive ? v * 2 : v;
    this.score += add;
    if (this.score > this.bestScore) this.bestScore = this.score;
    this.updateUI();

    if (this.score >= this.nextUndoThreshold) {
      const g = Math.floor((this.score - this.nextUndoThreshold) / UNDO_PER_SCORE) + 1;
      this.undoCount += g;
      this.nextUndoThreshold += g * UNDO_PER_SCORE;
      this.updateButtons();
      this.flashStatus('Отмена +' + g);
      this.playSfx('reward');
    }
    this.tweens.addCounter({
      from: 0, to: 1, duration: 180,
      onUpdate: (tw) => {
        const s = 1 + 0.06 * Math.sin(tw.progress * Math.PI);
        this.scoreText.setScale(s);
      },
      onComplete: () => this.scoreText.setScale(1)
    });
  }

  isGameOver() {
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (!this.grid[r][c]) return false;
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const t = this.grid[r][c];
      const same = (rr, cc) =>
        rr >= 0 && rr < GRID && cc >= 0 && cc < GRID &&
        this.grid[rr][cc] && this.grid[rr][cc].value === t.value;
      if (same(r + 1, c) || same(r - 1, c) || same(r, c + 1) || same(r, c - 1)) return false;
    }
    return true;
  }

  newGame() {
    this.isMoving = false;
    this.allowInput = true;
    this.isMenuOpen = false;
    if (this.input.keyboard) this.input.keyboard.enabled = true;

    this.initGrid();
    for (let i = 0; i < START_TILES; i++) this.spawnRandomTile();
    this.updateUI();
    this.flashStatus('Новая игра');
    this.playSfx('reset');

    if (this.buttonsGroup) this.children.bringToTop(this.buttonsGroup);
  }

  flashStatus(text) {
    this.statusText.setText(text);
    this.statusText.alpha = 1;
    this.tweens.add({ targets: this.statusText, alpha: 0, delay: 1200, duration: 800, ease: 'Quad.Out' });
  }

  /* -------------------- Daily -------------------- */
  loadDaily() {
    const k = 'yag-2048-daily';
    const today = new Date().toISOString().slice(0, 10);
    const raw = JSON.parse(localStorage.getItem(k) || '{}');
    if (raw.date !== today) {
      const fresh = { date: today, played: false, merges: 0, maxTile: 2, claimed: {} };
      localStorage.setItem(k, JSON.stringify(fresh));
      return fresh;
    }
    return raw;
  }
  saveDaily(d) { localStorage.setItem('yag-2048-daily', JSON.stringify(d)); }

  /* -------------------- Audio -------------------- */
  initAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      this.ac.suspend();
      const resume = () => {
        if (this.ac.state !== 'running') { this.ac.resume().catch(() => {}); }
        this.input.off('pointerdown', resume);
        if (this.input.keyboard) this.input.keyboard.off('keydown', resume);
      };
      this.input.on('pointerdown', resume);
      if (this.input.keyboard) this.input.keyboard.on('keydown', resume);
    } catch (e) { this.ac = null; }
  }
  deferStartMusic() { this.time.delayedCall(300, () => this.startMusic()); }
  startMusic() {
    if (!this.ac || !this.musicOn) return;
    this.stopMusic();
    const o1 = this.ac.createOscillator(); o1.type = 'sine'; o1.frequency.value = 196;
    const o2 = this.ac.createOscillator(); o2.type = 'sine'; o2.frequency.value = 246.94;
    const g = this.ac.createGain(); g.gain.value = 0.06;
    o1.connect(g); o2.connect(g); g.connect(this.ac.destination);
    o1.start(); o2.start();
    this.musicNodes = [o1, o2, g];
  }
  stopMusic() {
    try {
      for (let i = 0; i < this.musicNodes.length; i++) {
        const n = this.musicNodes[i];
        try { if (n.stop) n.stop(); if (n.disconnect) n.disconnect(); } catch (e) {}
      }
    } catch (e) {}
    this.musicNodes = [];
  }
  playSfx(type) {
    if (!this.ac || !this.sfxOn) return;
    const now = this.ac.currentTime;
    const osc = this.ac.createOscillator();
    const gain = this.ac.createGain();
    gain.gain.setValueAtTime(0, now);
    osc.type = 'sine';
    const vol = 0.06;
    const env = function(a, d) {
      gain.gain.linearRampToValueAtTime(vol, now + a);
      gain.gain.linearRampToValueAtTime(0.0, now + a + d);
    };
    switch (type) {
      case 'click':   osc.frequency.setValueAtTime(520, now); env(0.003, 0.07); break;
      case 'move':    osc.frequency.setValueAtTime(200, now); env(0.004, 0.06); break;
      case 'merge':   osc.frequency.setValueAtTime(300, now); osc.frequency.exponentialRampToValueAtTime(600, now + 0.1); env(0.004, 0.14); break;
      case 'spawn':   osc.frequency.setValueAtTime(700, now); env(0.003, 0.06); break;
      case 'undo':    osc.frequency.setValueAtTime(180, now); env(0.003, 0.10); break;
      case 'hammer':  osc.frequency.setValueAtTime(140, now); env(0.002, 0.10); break;
      case 'gameover':osc.frequency.setValueAtTime(240, now); osc.frequency.exponentialRampToValueAtTime(120, now + 0.25); env(0.004, 0.30); break;
      case 'reward':  osc.frequency.setValueAtTime(500, now); osc.frequency.exponentialRampToValueAtTime(900, now + 0.15); env(0.004, 0.18); break;
      case 'toggle':  osc.frequency.setValueAtTime(420, now); env(0.003, 0.08); break;
      case 'claim':   osc.frequency.setValueAtTime(600, now); osc.frequency.exponentialRampToValueAtTime(1000, now + 0.12); env(0.003, 0.16); break;
      case 'reset':   osc.frequency.setValueAtTime(260, now); env(0.003, 0.08); break;
      default:        osc.frequency.setValueAtTime(400, now); env(0.005, 0.10);
    }
    osc.connect(gain); gain.connect(this.ac.destination);
    osc.start(); osc.stop(now + 0.5);
  }
  saveSettings() { localStorage.setItem('yag-2048-settings', JSON.stringify({ musicOn: this.musicOn, sfxOn: this.sfxOn })); }

  /* -------------------- FX -------------------- */
  createSparkTexture() {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(4, 4, 4);
    g.generateTexture('spark', 8, 8);
    g.destroy();
  }
  emitFireworks(x, y) {
    const p = this.add.particles('spark');
    const em = p.createEmitter({
      speed: {min:150,max:300}, angle: {min:0,max:360}, gravityY: 200,
      lifespan: 900, scale: { start: 1.0, end: 0 }, blendMode: 'ADD', quantity: 0
    });
    em.explode(60, x, y);
    this.time.delayedCall(1000, () => p.destroy());
  }

  /* -------------------- Persistence -------------------- */
  async loadProgress() {
    try {
      const saved = await loadData('bestScore');
      if (typeof saved === 'number') this.bestScore = Math.max(this.bestScore, saved | 0);
      const local = JSON.parse(localStorage.getItem('yag-2048-save-v1') || '{}');
      if (local && typeof local.bestScore === 'number') this.bestScore = Math.max(this.bestScore, local.bestScore | 0);
      const stg = JSON.parse(localStorage.getItem('yag-2048-settings') || '{}');
      if (typeof stg.musicOn === 'boolean') this.musicOn = stg.musicOn;
      if (typeof stg.sfxOn === 'boolean') this.sfxOn = stg.sfxOn;
    } catch (e) {}
  }
  async saveProgress() {
    try { await saveData('bestScore', this.bestScore); } catch (e) {}
    localStorage.setItem('yag-2048-save-v1', JSON.stringify({ bestScore: this.bestScore }));
  }

  updateUI() {
    if (this.scoreText) {
      this.scoreText.setText('Счёт: ' + this.score);
      if (this.lastScore !== this.score) {
        this.tweens.add({ targets: this.scoreText, scale: 1.06, yoyo: true, duration: THEME.motion.micro });
        if (this.scorePanel) this.tweens.add({ targets: this.scorePanel, alpha: 0.8, yoyo: true, duration: 300 });
        this.lastScore = this.score;
      }
    }
    if (this.bestText)  this.bestText.setText('Рекорд: ' + this.bestScore);
    this.updateButtons();
  }
}

/* -------- helpers -------- */
function tileStyleFor(v){
  return THEME.tile[v] || THEME.tile.default;
}
function getLocalTopScores() { const k = 'yag-2048-top'; const a = JSON.parse(localStorage.getItem(k) || '[]'); a.sort((x, y) => y.score - x.score); return a.slice(0, 10); }
function pushLocalScore(score, nick) { const k = 'yag-2048-top'; const a = JSON.parse(localStorage.getItem(k) || '[]'); a.push({ score: score, ts: Date.now(), nick: nick }); a.sort((x, y) => y.score - x.score); while (a.length > 10) a.pop(); localStorage.setItem(k, JSON.stringify(a)); }
