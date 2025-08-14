import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import GameScene from './scenes/GameScene.js';
import { initYandexSDK } from './sdk/yandex.js';

initYandexSDK().catch(() => {});

const config = {
  type: Phaser.AUTO,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    parent: 'app',
    width: 720,
    height: 1280
  },
  render: { pixelArt: false, roundPixels: true },
  physics: { default: 'arcade' },
  scene: [BootScene, GameScene]
};

new Phaser.Game(config);