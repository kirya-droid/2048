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
import { GAME_W, GAME_H } from '../config.js';

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

const BONUS_CONFIG = { hintEvery: 30, rerollEvery: 20, freezeEvery: 20, doubleEvery: 50 };
const DAILY_TEMPLATES = [
  { type:'tile256', title:'Собери 256', target:1 },
  { type:'merge10', title:'Сделай 10 слияний за игру', target:10 },
  { type:'score2000', title:'Набери 2000 очков', target:2000 }
];

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

    this.freezeCount = 0;

    this.doubleCount = 0;
    this.doubleTurns = 0;

    this.swapCount = 0;
    this.swapMode = false;
    this.swapFirst = null;

    this.moveCount = 0;

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

    this.cameras.main.setBackgroundColor('#0b1220');

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

    await showInterstitial({ force: true }).catch(()=>{});

    this.centerX = GAME_W / 2;

    const bg = drawGradientRect(this, GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, THEME.bgGradient);
    bg.setDepth(-1000);

    this.hud = this.add.container(0,0).setDepth(this.uiDepth).setScrollFactor(0);
    this.boardContainer = this.add.container(0,0).setDepth(this.boardDepth);
    this.bottomUI = this.add.container(0,0).setDepth(this.uiDepth).setScrollFactor(0);

    this.createSparkTexture();
    this.buildHUD();
    this.drawBoard();
    this.initGrid();
    for (let i = 0; i < START_TILES; i++) this.spawnRandomTile();

    await this.loadProgress();
    await this.ensureNickname();
    this.updateUI();

    await (document.fonts?.ready ?? Promise.resolve());
    this.layoutVirtual();
    this.scale.on('resize', this.onResize, this);
    this.onResize({ width: this.scale.gameSize.width, height: this.scale.gameSize.height });
    this.time.addEvent({
      delay: 300,
      loop: true,
      callback: () => {
        const vw = this.scale.gameSize.width, vh = this.scale.gameSize.height;
        const b = this.titleText.getBounds();
        if (b.right < 8 || b.left > vw - 8 || b.bottom < 8 || b.top > vh - 8)
          this.onResize({ width: vw, height: vh });
      }
    });

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

    this.events.once('shutdown', () => {
      try{ this.hud.destroy(true); }catch{}
      try{ this.boardContainer.destroy(true); }catch{}
      try{ this.bottomUI.destroy(true); }catch{}
      this.tiles.forEach(t=>{ try{ t.container.destroy(true); }catch{} });
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
        .setOrigin(0.5);
      this.hud.add(this.nickText);
    } else {
      this.nickText.setText('👤 ' + this.nickname);
    }
  }

  /* -------------------- UI -------------------- */
  buildHUD(){
    this.title = addTitleWithShine(this, 0, 0, '2048: Elements', { shiny: false });
    this.titleText = this.title.list ? this.title.list[0] : this.title;
    this.hud.add(this.title);

    this.scoreBarBg = makeGlassPanel(this,0,0,460,48);
    this.hud.add(this.scoreBarBg);
    this.scoreLeftText = makeText(this,0,0,'Счёт: 0','h2').setOrigin(0,0.5);
    this.scoreRightText = makeText(this,0,0,'Рекорд: 0','body').setOrigin(1,0.5);
    this.hud.add([this.scoreLeftText,this.scoreRightText]);

    this.statusText = makeText(this,0,0,'','subtle').setOrigin(0.5);
    this.hud.add(this.statusText);

    this.bonusPanel = this.add.container(0,0);
    this.hud.add(this.bonusPanel);
    this.bonusButtons = {};
    const items = [
      {icon:'🛠', label:'Молоток', key:'hammer'},
      {icon:'❄', label:'Заморозка', key:'freeze'},
      {icon:'⏩', label:'Двойной ход', key:'double'},
      {icon:'↔', label:'Swap', key:'swap'}
    ];
    items.forEach(it=>{
      const btn = this.makeBonusButton(it);
      this.bonusPanel.add(btn.container);
      this.bonusButtons[it.key] = btn;
    });
    this.updateBonusUI();
  }

  makeBonusButton({icon,label,key}){
    const cont = this.add.container(0,0).setSize(180,38).setInteractive({useHandCursor:true});
    const bg = this.add.rectangle(0,0,180,38,THEME.button.fill)
      .setStrokeStyle(2,THEME.button.stroke);
    const iconT = makeText(this,0,0,icon,'body').setOrigin(0.5,0.5);
    const labelT = makeText(this,0,0,label,'body').setOrigin(0,0.5);
    const countBg = this.add.graphics();
    countBg.fillStyle(THEME.button.fillActive,1);
    countBg.lineStyle(1,THEME.button.stroke,1);
    countBg.fillRoundedRect(-14,-11,28,22,11);
    const countT = makeText(this,0,0,'0','subtle').setOrigin(0.5).setColor('#fff');
    cont.add([bg,iconT,labelT,countBg,countT]);
    cont.on('pointerover',()=>{
      this.tweens.add({targets:cont,scale:1.03,duration:THEME.motion.micro});
      bg.setFillStyle(THEME.button.fillActive);
    });
    cont.on('pointerout',()=>{
      this.tweens.add({targets:cont,scale:1,duration:THEME.motion.micro});
      bg.setFillStyle(THEME.button.fill);
    });
    cont.on('pointerup',()=>{ this.playSfx('click'); this.activateBonus(key); });
    return {container:cont,rect:bg,bg:bg,icon:iconT,label:labelT,countBg:countBg,countText:countT};
  }

  layoutVirtual(){
    const pad = 12;
    const vw = GAME_W;
    const vh = GAME_H;
    const compact = vw < 520;

    this.hud.setPosition(0,0);
    this.boardContainer.setPosition(0,0);
    this.bottomUI.setPosition(0,0);

    this.titleText.setFontSize(compact ? 26 : 34);
    this.titleText.setOrigin(0.5,0.5);
    this.titleText.setPosition(Math.round(vw/2), 40);

    const bonusW = compact ? 44 : 180;
    const btnH   = compact ? 44 : 38;
    const gap    = compact ? 10 : 8;
    this.bonusPanel.setSize(bonusW, btnH*3 + gap*2);
    this.bonusPanel.setPosition(vw - pad - Math.round(bonusW/2), 40 + Math.round(btnH/2));

    const sbH = compact ? 46 : 54;
    const sbW = Math.min(880, vw - pad*2);
    const sbY = 40 + 34 + (compact ? 6 : 10) + sbH/2;
    this.scoreBarBg.setPosition(Math.round(vw/2), Math.round(sbY));
    this.scoreBarBg.setScale(sbW/460, sbH/48);
    this.scoreLeftText.setPosition(Math.round(this.scoreBarBg.x - sbW/2 + 20), this.scoreBarBg.y);
    this.scoreRightText.setPosition(Math.round(this.scoreBarBg.x + sbW/2 - 20), this.scoreBarBg.y);

    const boardTop = this.scoreBarBg.y + sbH/2 + pad;
    const bottomReserve = 86;
    const boardSize = Math.min(vw - pad*2, vh - boardTop - bottomReserve);
    const boardX = Math.round((vw - boardSize)/2);
    const boardY = Math.round(boardTop);
    this.boardContainer.setPosition(boardX, boardY);
    this.setBoardViewport(boardSize);

    const by = Math.round(boardY + boardSize + pad);
    this.bottomUI.setPosition(0, by);
    this.layoutButtonsUnderBoard(vw);

    const keys = ['hammer','freeze','double','swap'];
    let idx = 0;
    keys.forEach(k => {
      const btn = this.bonusButtons[k];
      if(!btn) return;
      const show = compact ? (k !== 'swap') : true;
      btn.container.setVisible(show);
      if(show){
        const w = bonusW, h = btnH;
        btn.container.setPosition(0, Math.round(idx*(btnH+gap)));
        btn.bg.width = w; btn.bg.height = h; btn.bg.setSize(w,h);
        btn.container.setSize(w,h);
        if(compact){
          btn.icon.setPosition(0, h/2);
          btn.label.setVisible(false);
          btn.countBg.setPosition(w/2 - 14, h/2);
          btn.countText.setPosition(w/2 - 14, h/2);
        } else {
          btn.icon.setPosition(-w/2 + 20, h/2);
          btn.label.setVisible(true);
          btn.label.setPosition(-w/2 + 40, h/2);
          btn.label.setWordWrapWidth(w - 54);
          btn.countBg.setPosition(w/2 - 20, h/2);
          btn.countText.setPosition(w/2 - 20, h/2);
        }
        idx++;
      }
    });

    if (this.nickText) this.nickText.setPosition(Math.round(vw/2), 14);
    if (this.statusText) this.statusText.setPosition(Math.round(vw/2), this.scoreBarBg.y + sbH/2 + 20);
  }

  onResize({ width, height }) {
    const vw = Math.floor(width);
    const vh = Math.floor(height);
    this.cameras.main.setViewport(0,0,vw,vh);
    this.cameras.main.setScroll(0,0);
    const z = Math.min(vw / GAME_W, vh / GAME_H);
    this.cameras.main.setZoom(z);
    this.cameras.main.centerOn(GAME_W/2, GAME_H/2);
  }

  updateBonusUI(){
    const map={hammer:this.hammerCount, freeze:this.freezeCount, double:this.doubleCount, swap:this.swapCount};
    for(const k in map){
      const b=this.bonusButtons[k];
      if(!b) continue;
      b.countText.setText(map[k]);
      if(map[k]<=0) b.rect.setTint(0x2a2f3f); else b.rect.clearTint();
    }
  }

  async getBonusViaAd(type,amount=1){
    const ok=await showRewarded();
    if(!ok) return false;
    if(type==='hammer') this.hammerCount+=amount;
    if(type==='freeze') this.freezeCount+=amount;
    if(type==='double') this.doubleCount+=amount;
    if(type==='swap') this.swapCount+=amount;
    await saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount});
    this.updateBonusUI();
    const iconMap = {hammer:'🛠',freeze:'❄',double:'⏩',swap:'↔'};
    this.flashStatus('+'+amount+' '+iconMap[type]);
    return true;
  }

  async activateBonus(key){
    if(key==='hammer'){
      if(this.hammerCount>0){ this.toggleHammerMode(); this.updateBonusUI(); }
      else await this.getBonusViaAd('hammer');
      return;
    }
    if(key==='freeze'){
      if(this.freezeCount>0){ this.freezeCount--; this.applyFreeze(); this.updateBonusUI(); try{await saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount});}catch{} }
      else await this.getBonusViaAd('freeze');
      return;
    }
    if(key==='double'){
      if(this.doubleCount>0 && this.doubleTurns===0){ this.doubleCount--; this.doubleTurns=2; this.updateBonusUI(); try{await saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount});}catch{} this.flashStatus('Двойной ход активен'); }
      else if(this.doubleCount<=0){ await this.getBonusViaAd('double'); }
      return;
    }
    if(key==='swap'){
      if(this.swapCount>0){
        this.swapMode=true; this.swapFirst=null;
        this.tiles.forEach(t=> t.highlight.setFillStyle(THEME.glow.color, THEME.glow.alpha*0.5));
        this.flashStatus('Swap: выбери две плитки');
      }
      else await this.getBonusViaAd('swap');
      this.updateBonusUI();
      return;
    }
  }

  layoutButtonsUnderBoard(vw) {
    const bw = 132, bh = 44, space = 16;
    if (!this.buttonsGroup) {
      this.buttonsGroup = this.add.container(0, 0).setDepth(this.uiDepth);
      this.bottomUI.add(this.buttonsGroup);

      this.buttons.newGame = this.createButton(-bw - space, 0, bw, bh, '⟲ Новая', () => this.newGame());
      this.buttons.undo    = this.createButton(0, 0, bw, bh, '↩ Отмена (0)', () => this.useUndo());
      this.buttons.menu    = this.createButton(bw + space, 0, bw, bh, '☰ Меню', () => this.openMenu());

      this.buttonsGroup.add([
        this.buttons.newGame.container,
        this.buttons.undo.container,
        this.buttons.menu.container
      ]);
    }
    this.buttonsGroup.setPosition(Math.round(vw/2), 0);
  }

  setBoardViewport(size){
    const scale = size / BOARD_W;
    this.boardContainer.setScale(scale);
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
      this.buttons.undo.text.setText('↩ Отмена (' + this.undoCount + ')');
      if (this.undoCount <= 0){
        this.buttons.undo.rect.setTint(0x2a2f3f);
        this.buttons.undo.rect.disableInteractive();
      } else {
        this.buttons.undo.rect.clearTint();
        this.buttons.undo.rect.setInteractive({ useHandCursor:true });
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
    const overlay = this.add.rectangle(GAME_W / 2, GAME_H / 2,
      GAME_W, GAME_H, 0x000000).setAlpha(0.6).setInteractive();
    const box = this.add.rectangle(this.centerX, this.boardContainer.y + 30, boxW, boxH, 0x1b2330)
      .setStrokeStyle(2, 0x2a3547).setOrigin(0.5, 0);
    const title = makeText(this, box.x, box.y + 16, 'Меню', 'h2').setOrigin(0.5, 0);
    const content = this.add.container(0, 0);

    this.menuLayer.add([overlay, box, title, content]);

    const tabs = ['Рейтинг', 'Задача', 'Настройки'];
    let active = 1;
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
      if (active === 1) this.fillDailyQuest(content, box);
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

  fillDailyQuest(cont, box){
    const d = this.loadDaily();
    const tpl = DAILY_TEMPLATES.find(t=>t.type===d.type);
    cont.add(makeText(this, box.x, box.y + 96, 'Задача дня', 'body').setOrigin(0.5,0));

    const cardW = box.displayWidth - 60, cardH = 86, x = box.x - cardW/2, y = box.y + 140;
    const card = makeGlassPanel(this, box.x, y + cardH/2, cardW, cardH);
    const title = makeText(this, x + 14, y + 12, tpl.title, 'body').setOrigin(0,0);
    const rewardTxt = d.reward === 'hammer' ? '+1 🛠' : '+1 ❄';
    const reward = makeText(this, x + 14, y + 36, 'Награда: ' + rewardTxt, 'subtle').setOrigin(0,0);

    const target = tpl.target;
    const prog = Math.min(d.progress, target);
    const p = prog / target;
    const pbX = x + 14, pbY = y + 60, pbW = cardW - 14 - 140, pbH = 12;
    const pbBg = this.add.rectangle(pbX + pbW/2, pbY, pbW, pbH, 0x233042);
    const pbFill = this.add.rectangle(pbX + pbW*p/2, pbY, pbW*p, pbH, 0x6aba46);

    const btn = this.createButton(x + cardW - 80, pbY, 120,34,
      d.claimed ? 'Забрано' : (d.done ? 'Забрать' : 'Недоступно'), async () => {
        if(!d.done || d.claimed) return;
        if(d.reward === 'hammer') this.hammerCount++; else this.freezeCount++;
        this.updateBonusUI();
        d.claimed = true; this.saveDaily(d);
        await saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount});
        cont.removeAll(true); this.fillDailyQuest(cont, box);
      });
    if(!d.done || d.claimed){ btn.rect.fillColor = 0x2a2f3f; btn.rect.disableInteractive(); }

    cont.add([card,title,reward,pbBg,pbFill,btn.container]);
    cont.add(makeText(this, box.x, y + cardH + 4, 'Новая задача каждый день', 'subtle').setOrigin(0.5,0));
  }

  // Настройки с «пилюльными» тумблерами
  fillSettings(cont, box){
    const tabs=['Игра','Справка'];
    let active=0; const tabW=120,gap=10,startX=box.x - tabW - gap;
    const inner=this.add.container(0,0); cont.add(inner);

    const drawTabs=()=>{
      cont.removeAll(true); cont.add(inner);
      for(let i=0;i<tabs.length;i++){
        const on=i===active; const cx=startX + i*(tabW+gap);
        const r=this.add.rectangle(cx, box.y+96, tabW,32,on?0x2b3a52:0x253145)
          .setStrokeStyle(2,0x3a4c6a).setInteractive({useHandCursor:true});
        const t=makeText(this,cx,box.y+96,tabs[i],'body').setOrigin(0.5);
        r.on('pointerup',()=>{this.playSfx('click');active=i;drawTabs();});
        cont.add([r,t]);
      }
      inner.removeAll(true);
      if(active===0) drawGame(); else drawHelp();
    };

    const drawGame=()=>{
      const xLabel = box.x - 140;
      const xToggle = box.x + 110;
      const y0 = box.y + 150, step = 60;
      const makePillToggle = (cx, cy, state, onChange) => {
        const w=92, h=34, r=17; const contT=this.add.container(cx,cy); const g=this.add.graphics(); contT.add(g);
        const knob=this.add.circle(0,0,r-3,0xffffff).setStrokeStyle(2,0x3a4c6a); contT.add(knob);
        const draw=()=>{ g.clear(); g.lineStyle(2,0x3a4c6a,1); g.fillStyle(state?0x2c7e79:0x5a6374,1); g.fillRoundedRect(-w/2,-h/2,w,h,r); g.strokeRoundedRect(-w/2,-h/2,w,h,r); knob.x=state?(w/2-r):(-w/2+r); };
        draw(); const zone=this.add.zone(0,0,w,h).setInteractive({useHandCursor:true});
        zone.on('pointerup',()=>{this.playSfx('click');state=!state;onChange(state);draw();}); contT.add(zone); return contT;
      };
      const lblMusic = makeText(this, xLabel, y0, 'Музыка', 'body').setOrigin(1,0.5);
      const togMusic = makePillToggle(xToggle, y0, this.musicOn, (v)=>{ this.musicOn=v; if(v) this.startMusic(); else this.stopMusic(); this.saveSettings(); });
      const lblSfx = makeText(this, xLabel, y0+step, 'Звуки', 'body').setOrigin(1,0.5);
      const togSfx = makePillToggle(xToggle, y0+step, this.sfxOn, (v)=>{ this.sfxOn=v; this.saveSettings(); });
      inner.add([lblMusic,togMusic,lblSfx,togSfx]);
    };

    const drawHelp=()=>{
      const txt = `Бонусы\n— Молоток (🛠). Удаляет выбранную плитку. Очки не начисляются. Можно получить за рекламу или в редких событиях.\n— Заморозка (❄). Блокирует одну плитку на 3 хода — она не двигается и не сливается.\n— Двойной ход (⏩). Позволяет сделать два хода подряд: после первого хода новые плитки не появляются.\n— Swap (↔). Поменять местами две плитки. Не вызывает моментальных слияний.\n\nГеймплей\n— Комбо-множитель: ходы со слиянием повышают множитель очков до ×1.5; ход без слияния или применение бонуса — сброс.\n— Жёсткий режим: чаще появляется плитка «4» (30%).\n— Ежедневная задача: выполняйте цель дня и получайте бонус.`;
      const t = makeText(this, box.x - box.displayWidth/2 + 20, box.y + 140, txt, 'body')
        .setOrigin(0,0).setWordWrapWidth(box.displayWidth-40);
      inner.add(t);
    };

    drawTabs();
  }


  /* -------------------- Доска/логика -------------------- */
  drawBoard() {
    this.boardContainer.removeAll(true);
    const bg = this.add.rectangle(BOARD_W / 2, BOARD_H / 2, BOARD_W, BOARD_H, 0x161d27)
      .setStrokeStyle(3, 0x2a3547);
    this.boardContainer.add(bg);
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
      const cx = GAP + c * (TILE + GAP) + TILE / 2;
      const cy = GAP + r * (TILE + GAP) + TILE / 2;
      const cell = this.add.rectangle(cx, cy, TILE, TILE, 0x1b2330).setAlpha(0.35);
      this.boardContainer.add(cell);
    }
  }

  initGrid() {
    this.grid = [];
    for (let r = 0; r < GRID; r++) this.grid[r] = new Array(GRID).fill(null);

    this.tiles.forEach(t => t.container.destroy(true));
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
    const x0 = this.boardContainer.x, y0 = this.boardContainer.y;
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
    highlight.fillStyle(0xffffff, 0.15);
    highlight.fillRoundedRect(-TILE / 2, -TILE / 2, TILE, TILE, THEME.glass.radius);

    const text = makeText(this, 0, -8, '' + value, 'title')
      .setOrigin(0.5).setColor(style.text)
      .setFontSize(value >= 1024 ? 32 : value >= 128 ? 38 : 44).setDepth(10);
    const el = makeText(this, 0, TILE / 2 - 28, style.chip, 'body')
      .setOrigin(0.5).setFontSize(20).setColor(style.text);

    cont.add([rect, highlight, text, el]);
    cont.setScale(0);
    this.tweens.add({ targets: cont, scale: 1, duration: THEME.motion.fast, ease: THEME.motion.easingOut });

    const tile = { r: r, c: c, value: value, container: cont, rect: rect, text: text, el: el, highlight: highlight, destroyed: false };
    this.tiles.add(tile);

    cont.on('pointerup', () => {
      if (this.hammerMode && this.hammerCount > 0 && !this.isMoving && !this.isMenuOpen) this.useHammerOn(tile);
      else if (this.swapMode && !this.isMoving && !this.isMenuOpen) this.useSwapOn(tile);
    });

    cont.on('pointerover', () => {
      if (this.hammerMode || this.swapMode) {
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
      const skipSpawn = this.doubleTurns > 1;
      if (!skipSpawn) this.spawnRandomTile();
      this.afterMove();
      if (this.doubleTurns > 0) this.doubleTurns--; 
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
      const movable = [];
      const frozen = {};
      for (let i = 0; i < idx.length; i++) {
        const t = this.grid[idx[i].r][idx[i].c];
        if (!t) continue;
        if (t.freezeTurns > 0) frozen[i] = t; else movable.push({ tile: t, pos: i });
      }
      const out = new Array(GRID).fill(null);
      Object.keys(frozen).forEach(p => { out[p] = frozen[p]; });
      let dst = 0;
      for (let i = 0; i < movable.length; i++) {
        while (frozen.hasOwnProperty(dst)) dst++;
        const curr = movable[i];
        let merged = false;
        if (i < movable.length - 1) {
          const next = movable[i + 1];
          let barrier = false;
          for (let b = curr.pos + 1; b <= next.pos; b++) if (frozen.hasOwnProperty(b)) { barrier = true; break; }
          if (!barrier && next.tile.value === curr.tile.value) {
            const keep = curr.tile, kill = next.tile;
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
              kill.destroyed = true; kill.container.destroy(true); this.tiles.delete(kill);
            }));
            any = true;
            if (keep.value >= 2048) { const pos = this.xyToPixel(tp.r, tp.c); this.emitFireworks(pos.x, pos.y); }
            this.playSfx('merge');
            this.tweens.add({ targets: keep.container, scale: 1.08, yoyo: true, duration: THEME.motion.merge });
            i++; merged = true;
          }
        }
        if (!merged) {
          const tp = idx[dst];
          out[dst] = curr.tile;
          const p = this.xyToPixel(tp.r, tp.c);
          if (Math.abs(curr.tile.container.x - p.x) > 1 || Math.abs(curr.tile.container.y - p.y) > 1) {
            tweens.push(this.tweenMoveTo(curr.tile.container, p.x, p.y));
            any = true;
          }
        }
        dst++;
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
    this.tiles.forEach(t=>t.container.destroy(true));
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
    this.tweens.add({ targets: tile.container, scale: 0, duration: 120, onComplete: () => tile.container.destroy(true) });
    this.tiles.delete(tile);
    this.grid[r][c] = null;
    this.hammerCount--;
    this.hammerMode = false;
    this.updateBonusUI();
    try { saveData('bonuses', {hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount}); } catch {}
    this.tiles.forEach(t=>t.highlight.setFillStyle(0xffffff,0.15));
    this.flashStatus('Плитка удалена');
    this.cameras.main.shake(80,0.01);
    const p=this.add.particles('spark');
    p.createEmitter({x:tile.container.x,y:tile.container.y,speed:{min:40,max:120},lifespan:300,quantity:8,scale:{start:1,end:0},blendMode:'ADD'});
    this.time.delayedCall(300,()=>p.destroy());
    this.playSfx('hammer');
  }

  toggleHammerMode() {
    this.hammerMode = !this.hammerMode;
    this.tiles.forEach(t=>{
      t.highlight.setFillStyle(this.hammerMode ? THEME.glow.color : 0xffffff,
        this.hammerMode ? THEME.glow.alpha * 0.5 : 0.15);
    });
    this.flashStatus(this.hammerMode ? 'Молоток активен: тап по плитке' : 'Молоток выключен');
    this.playSfx('toggle');
  }

  useSwapOn(tile){
    if(!this.swapMode) return;
    if(!this.swapFirst){
      this.swapFirst = tile;
      tile.highlight.setFillStyle(THEME.glow.color, THEME.glow.alpha * 0.5);
      this.flashStatus('Выберите вторую плитку');
      return;
    }
    if(tile === this.swapFirst) return;
    const a = this.swapFirst, b = tile;
    const posA = { x: a.container.x, y: a.container.y, r: a.r, c: a.c };
    const posB = { x: b.container.x, y: b.container.y, r: b.r, c: b.c };
    this.grid[posA.r][posA.c] = b; b.r = posA.r; b.c = posA.c;
    this.grid[posB.r][posB.c] = a; a.r = posB.r; a.c = posB.c;
    this.tweenMoveTo(a.container, posB.x, posB.y);
    this.tweenMoveTo(b.container, posA.x, posA.y);
    this.tiles.forEach(t=>t.highlight.setFillStyle(0xffffff,0.15));
    this.swapCount--; this.swapMode=false; this.swapFirst=null;
    this.updateBonusUI();
    try{ saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount}); }catch{}
    this.flashStatus('Плитки обменены');
  }

  applyFreeze(){
    const arr=Array.from(this.tiles).filter(t=>!t.destroyed && !t.freezeTurns);
    if(!arr.length) return;
    const tile=Phaser.Utils.Array.GetRandom(arr);
    tile.freezeTurns=3;
    tile.freezeOverlay=this.add.graphics();
    tile.freezeOverlay.lineStyle(3,0x99dfff,0.8);
    tile.freezeOverlay.strokeRoundedRect(-TILE/2,-TILE/2,TILE,TILE,THEME.glass.radius);
    tile.freezeOverlay.fillStyle(0x99dfff,0.2);
    tile.freezeOverlay.fillRoundedRect(-TILE/2,-TILE/2,TILE,TILE,THEME.glass.radius);
    tile.container.add(tile.freezeOverlay);
    this.flashStatus('Плитка заморожена');
  }

  afterMove() {
    this.moveCount++;
    if (BONUS_CONFIG.rerollEvery && this.moveCount % BONUS_CONFIG.rerollEvery === 0) {
      this.rerollRandomTile();
    }
    if (BONUS_CONFIG.hintEvery && this.moveCount % BONUS_CONFIG.hintEvery === 0) {
      this.showHint();
    }
    if (BONUS_CONFIG.freezeEvery && this.moveCount % BONUS_CONFIG.freezeEvery === 0) {
      this.freezeCount++; this.updateBonusUI(); this.flashStatus('Бонус ❄');
      saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount}).catch(()=>{});
    }
    if (BONUS_CONFIG.doubleEvery && this.moveCount % BONUS_CONFIG.doubleEvery === 0) {
      this.doubleCount++; this.updateBonusUI(); this.flashStatus('Бонус ⏩');
      saveData('bonuses',{hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount}).catch(()=>{});
    }
    this.tiles.forEach(t=>{
      if(t.freezeTurns){
        t.freezeTurns--; if(t.freezeTurns<=0){ t.freezeOverlay?.destroy(); delete t.freezeOverlay; }
      }
    });
    this.updateDailyProgress();
  }

  rerollRandomTile() {
    const arr = Array.from(this.tiles);
    if (!arr.length) return;
    const tile = Phaser.Utils.Array.GetRandom(arr);
    const vals = [2, 4, 8];
    tile.value = Phaser.Utils.Array.GetRandom(vals);
    const style = tileStyleFor(tile.value);
    const key = `tile-${tile.value}-${TILE}`;
    if (!this.textures.exists(key)) {
      const g = this.add.graphics();
      g.fillGradientStyle(style.from, style.from, style.to, style.to, 1);
      g.fillRoundedRect(-TILE / 2, -TILE / 2, TILE, TILE, THEME.glass.radius);
      g.generateTexture(key, TILE, TILE);
      g.destroy();
    }
    tile.rect.setTexture(key).setDisplaySize(TILE, TILE);
    tile.text.setText('' + tile.value);
    tile.text.setFontSize(tile.value >= 1024 ? 32 : tile.value >= 128 ? 38 : 44).setColor(style.text);
    tile.el.setText(style.chip).setColor(style.text);
    this.flashStatus('Реролл плитки');
  }

  showHint() {
    const dir = this.findBestMove();
    if (!dir) return;
    const map = { left: '←', right: '→', up: '↑', down: '↓' };
    this.flashStatus('Лучший ход: ' + map[dir]);
  }

  findBestMove() {
    const dirs = ['up', 'left', 'right', 'down'];
    let best = null, bestScore = -1;
    for (const d of dirs) {
      const s = this.estimateMove(d);
      if (s.moved) {
        const score = s.merges * 10 + s.empty;
        if (score > bestScore) { bestScore = score; best = d; }
      }
    }
    return best;
  }

  estimateMove(dir) {
    const temp = this.grid.map(row => row.map(t => (t ? t.value : 0)));
    let moved = false, merges = 0;
    const line = (li) => {
      if (dir === 'left' || dir === 'right') {
        const arr = [];
        for (let c = 0; c < GRID; c++) arr.push({ r: li, c });
        return dir === 'left' ? arr : arr.reverse();
      } else {
        const arr = [];
        for (let r = 0; r < GRID; r++) arr.push({ r, c: li });
        return dir === 'up' ? arr : arr.reverse();
      }
    };
    for (let li = 0; li < GRID; li++) {
      const idx = line(li);
      const arr = idx.map(p => temp[p.r][p.c]).filter(v => v > 0);
      const out = new Array(GRID).fill(0);
      let dst = 0;
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (i < arr.length - 1 && arr[i + 1] === v) {
          out[dst] = v * 2; merges++; i++;
        } else {
          out[dst] = v;
        }
        if (out[dst] !== temp[idx[dst].r][idx[dst].c]) moved = true;
        dst++;
      }
      for (let j = 0; j < GRID; j++) {
        const p = idx[j];
        temp[p.r][p.c] = out[j];
      }
    }
    const empty = temp.flat().filter(v => v === 0).length;
    return { moved, merges, empty };
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
    const overlay = this.add.rectangle(this.centerX, this.boardContainer.y + BOARD_H / 2, BOARD_W, BOARD_H, 0x000000)
      .setAlpha(0.6).setInteractive().setDepth(this.overlayDepth);
    const box = makeGlassPanel(this, this.centerX, overlay.y, 320, 220).setDepth(this.overlayDepth + 1);
    const t = makeText(this, this.centerX, overlay.y - 50, msg || 'Игра окончена', 'h2')
      .setOrigin(0.5).setDepth(this.overlayDepth + 1);
    const s = makeText(this, this.centerX, overlay.y - 10, 'Счёт: ' + this.score, 'body')
      .setOrigin(0.5).setDepth(this.overlayDepth + 1);

    const b = this.createButton(this.centerX, overlay.y + 48, 200, 44, 'Сыграть ещё раз', () => {
      overlay.destroy(); box.destroy(); t.destroy(); s.destroy(); b.container.destroy(true);
      this.resetState(); this.scene.restart();
    });
    b.container.setDepth(this.overlayDepth + 1);
  }

  spawnX2Bonus() {
    const x = this.centerX + BOARD_W / 2 - 24, y = this.boardContainer.y - 10;
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
        this.scoreLeftText.setScale(s);
      },
      onComplete: () => this.scoreLeftText.setScale(1)
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
    const today = new Date().toISOString().slice(0,10);
    const raw = JSON.parse(localStorage.getItem(k) || '{}');
    if(raw.date !== today){
      const tpl = Phaser.Utils.Array.GetRandom(DAILY_TEMPLATES);
      const reward = Math.random()<0.5 ? 'hammer' : 'freeze';
      const fresh = {date:today,type:tpl.type,progress:0,done:false,claimed:false,reward};
      localStorage.setItem(k, JSON.stringify(fresh));
      return fresh;
    }
    return raw;
  }
  saveDaily(d){ localStorage.setItem('yag-2048-daily', JSON.stringify(d)); }

  updateDailyProgress(){
    const d = this.loadDaily();
    if(d.done) return;
    if(d.type==='tile256') d.progress = this.maxTileThisRun >= 256 ? 1 : 0;
    if(d.type==='merge10') d.progress = Math.min(10, this.mergesThisRun);
    if(d.type==='score2000') d.progress = this.score;
    d.done = (d.type==='tile256'? d.progress>=1 : d.type==='merge10'? d.progress>=10 : d.progress>=2000);
    this.saveDaily(d);
  }

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
  saveSettings() {
    const st = { musicOn: this.musicOn, sfxOn: this.sfxOn };
    localStorage.setItem('yag-2048-settings', JSON.stringify(st));
    try { saveData('settings', st); } catch {}
  }

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
      const bonuses = await loadData('bonuses');
      if (bonuses){
        if (typeof bonuses.hammers === 'number') this.hammerCount = bonuses.hammers|0;
        if (typeof bonuses.freezes === 'number') this.freezeCount = bonuses.freezes|0;
        if (typeof bonuses.doubles === 'number') this.doubleCount = bonuses.doubles|0;
        if (typeof bonuses.swaps === 'number') this.swapCount = bonuses.swaps|0;
      } else {
        const h = await loadData('hammers');
        if (typeof h === 'number') this.hammerCount = h | 0;
      }
      const stgCloud = await loadData('settings');
      if (stgCloud && typeof stgCloud.musicOn === 'boolean') this.musicOn = stgCloud.musicOn;
      if (stgCloud && typeof stgCloud.sfxOn === 'boolean') this.sfxOn = stgCloud.sfxOn;
      const local = JSON.parse(localStorage.getItem('yag-2048-save-v1') || '{}');
      if (local && typeof local.bestScore === 'number') this.bestScore = Math.max(this.bestScore, local.bestScore | 0);
      if (local && typeof local.hammers === 'number') this.hammerCount = local.hammers | 0;
      if (local && typeof local.freezes === 'number') this.freezeCount = local.freezes | 0;
      if (local && typeof local.doubles === 'number') this.doubleCount = local.doubles | 0;
      if (local && typeof local.swaps === 'number') this.swapCount = local.swaps | 0;
      const stg = JSON.parse(localStorage.getItem('yag-2048-settings') || '{}');
      if (typeof stg.musicOn === 'boolean') this.musicOn = stg.musicOn;
      if (typeof stg.sfxOn === 'boolean') this.sfxOn = stg.sfxOn;
    } catch (e) {}
  }
  async saveProgress() {
    try {
      await saveData('bestScore', this.bestScore);
      await saveData('bonuses', {hammers:this.hammerCount,freezes:this.freezeCount,doubles:this.doubleCount,swaps:this.swapCount});
    } catch (e) {}
    localStorage.setItem('yag-2048-save-v1', JSON.stringify({ bestScore: this.bestScore, hammers: this.hammerCount, freezes: this.freezeCount, doubles: this.doubleCount, swaps: this.swapCount }));
  }

  updateUI() {
    if (this.scoreLeftText) {
      this.scoreLeftText.setText('Счёт: ' + this.score);
      if (this.lastScore !== this.score) {
        this.tweens.add({ targets: this.scoreLeftText, scale: 1.06, yoyo: true, duration: THEME.motion.micro });
        if (this.scoreBarBg) this.tweens.add({ targets: this.scoreBarBg, alpha: 0.8, yoyo: true, duration: 300 });
        this.lastScore = this.score;
      }
    }
    if (this.scoreRightText)  this.scoreRightText.setText('Рекорд: ' + this.bestScore);
    this.updateButtons();
    this.updateBonusUI();
  }
}

/* -------- helpers -------- */
function tileStyleFor(v){
  return THEME.tile[v] || THEME.tile.default;
}
function getLocalTopScores() { const k = 'yag-2048-top'; const a = JSON.parse(localStorage.getItem(k) || '[]'); a.sort((x, y) => y.score - x.score); return a.slice(0, 10); }
function pushLocalScore(score, nick) { const k = 'yag-2048-top'; const a = JSON.parse(localStorage.getItem(k) || '[]'); a.push({ score: score, ts: Date.now(), nick: nick }); a.sort((x, y) => y.score - x.score); while (a.length > 10) a.pop(); localStorage.setItem(k, JSON.stringify(a)); }
