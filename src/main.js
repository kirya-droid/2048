import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import GameScene from './scenes/GameScene.js';
import { initYandexSDK } from './sdk/yandex.js';
import { GAME_W, GAME_H } from './config.js';

initYandexSDK().catch(() => {});

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#0b1220',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_W,
    height: GAME_H
  },
  render: { roundPixels: true },
  physics: { default: 'arcade' },
  scene: [BootScene, GameScene]
};

new Phaser.Game(config);