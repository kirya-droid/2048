// src/sdk/yandex.js
let ysdk = null;
let player = null;
let adHooks = { onOpen: null, onClose: null };
let lastInterstitialTs = 0;

const INTERSTITIAL_COOLDOWN = 120 * 1000; // 2 минуты

export async function initYandex() {
  if (ysdk) return ysdk;
  if (typeof YaGames === "undefined") {
    console.warn("[yandex.js] YaGames SDK not found. Add https://yandex.ru/games/sdk/v2 to index.html");
    return null;
  }
  ysdk = await YaGames.init();
  try { player = await ysdk.getPlayer({ scopes: false }); } catch { player = null; }
  return ysdk;
}

// Алиас для совместимости со старым кодом
export async function initYandexSDK(){ return initYandex(); }

export function setAdHooks({ onOpen = null, onClose = null } = {}) {
  adHooks.onOpen  = typeof onOpen  === "function" ? onOpen  : null;
  adHooks.onClose = typeof onClose === "function" ? onClose : null;
}
const safeOpen  = () => { try { adHooks.onOpen  && adHooks.onOpen();  } catch{} };
const safeClose = () => { try { adHooks.onClose && adHooks.onClose(); } catch{} };

export async function showRewarded() {
  await initYandex();
  if (!ysdk?.adv?.showRewardedVideo) return false;
  return new Promise(resolve=>{
    ysdk.adv.showRewardedVideo({
      callbacks:{
        onOpen:  ()=>{ safeOpen(); },
        onRewarded: ()=>{ resolve(true); },
        onClose: ()=>{ safeClose(); resolve(false); },
        onError: ()=>{ safeClose(); resolve(false); }
      }
    });
  });
}

export async function showInterstitial({ force=false } = {}) {
  const now = Date.now();
  if (!force && now - lastInterstitialTs < INTERSTITIAL_COOLDOWN) return false;
  await initYandex();
  if (!ysdk?.adv?.showFullscreenAdv) return false;
  lastInterstitialTs = now;
  return new Promise(resolve=>{
    ysdk.adv.showFullscreenAdv({
      callbacks:{
        onOpen:  ()=>{ safeOpen(); },
        onClose: (wasShown)=>{ safeClose(); resolve(!!wasShown); },
        onError: ()=>{ safeClose(); resolve(false); }
      }
    });
  });
}

// Лидерборды
export async function setLeaderboardScore(technicalName, score){
  await initYandex();
  if (!ysdk?.getLeaderboards) return false;
  try{
    const lb = await ysdk.getLeaderboards();
    await lb.setLeaderboardScore(technicalName, score|0);
    return true;
  }catch{ return false; }
}
export async function getLeaderboardTop(technicalName, quantity=10){
  await initYandex();
  if (!ysdk?.getLeaderboards) return [];
  try{
    const lb = await ysdk.getLeaderboards();
    const res = await lb.getLeaderboardEntries(technicalName, { quantity });
    return res?.entries || [];
  }catch{ return []; }
}

// Облако (fallback на localStorage)
export async function saveData(key, value){
  await initYandex();
  try{
    if (player?.setData) { await player.setData({ [key]: value }, true); return true; }
  }catch{}
  try{ localStorage.setItem(`yg:${key}`, JSON.stringify(value)); }catch{}
  return true;
}
export async function loadData(key, def=null){
  await initYandex();
  try{
    if (player?.getData) {
      const data = await player.getData([key]);
      if (data && Object.prototype.hasOwnProperty.call(data,key)) return data[key];
    }
  }catch{}
  try{
    const raw = localStorage.getItem(`yg:${key}`);
    if (raw != null) return JSON.parse(raw);
  }catch{}
  return def;
}

// Дополнительные вспомогательные функции
export async function getPlayerName(){
  await initYandex();
  try{
    if (player?.getName){
      const n = await player.getName();
      if (n) return n;
    }
  }catch{}
  return player?.name || null;
}

