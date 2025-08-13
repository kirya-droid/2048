import Phaser from 'phaser';
import BootScene from './scenes/BootScene.js';
import GameScene from './scenes/GameScene.js';
import { initYandexSDK } from './sdk/yandex.js';
initYandexSDK().catch(()=>{});
const W=480,H=800;
new Phaser.Game({ type:Phaser.AUTO, parent:'game', backgroundColor:'#11141a',
  scale:{ mode:Phaser.Scale.FIT, autoCenter:Phaser.Scale.CENTER_BOTH, width:W, height:H },
  physics:{ default:'arcade' }, scene:[BootScene, GameScene] });