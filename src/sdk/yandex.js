// src/sdk/yandex.js
let ysdk = null; let player = null;

export async function initYandexSDK() {
  if (typeof window === 'undefined') return null;
  function onLoad() { return new Promise(res => window.addEventListener('load', res, { once: true })); }
  if (document.readyState === 'loading') { await onLoad(); }
  if (!window.YaGames) { console.log('[YAG] SDK not found — local mode'); return null; }
  try {
    ysdk = await window.YaGames.init();
    try { player = await ysdk.getPlayer({ scopes: false }); } catch (e) {}
    return ysdk;
  } catch (e) {
    console.warn('[YAG] init failed', e);
    return null;
  }
}

export function isYandex() { return !!ysdk; }

export async function getPlayerName() {
  try {
    if (player && typeof player.getName === 'function') {
      const n = await player.getName(); if (n) return n;
    }
    if (player && player.name) return player.name;
  } catch (e) {}
  return null;
}

export async function showRewarded() {
  if (!ysdk || !ysdk.adv || !ysdk.adv.showRewardedVideo) return false;
  return new Promise(resolve => {
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onOpen() {}, onRewarded() { resolve(true); }, onClose() { resolve(false); }, onError() { resolve(false); }
      }
    });
  });
}

export async function showInterstitial() {
  if (!ysdk || !ysdk.adv || !ysdk.adv.showFullscreenAdv) return false;
  return new Promise(resolve => {
    ysdk.adv.showFullscreenAdv({
      callbacks: { onOpen() {}, onClose() { resolve(true); }, onError() { resolve(false); } }
    });
  });
}

const LOCAL_KEY = 'yag-2048-save-v1';
export async function saveCloud(data) {
  if (player && typeof player.setData === 'function') {
    try { await player.setData(data, true); return true; } catch (e) {}
  }
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
  return false;
}
export async function loadCloud() {
  if (player && typeof player.getData === 'function') {
    try { const res = await player.getData(['bestScore']); return res || null; } catch (e) {}
  }
  const raw = localStorage.getItem(LOCAL_KEY);
  return raw ? JSON.parse(raw) : null;
}

export async function setLeaderboardScore(lb, score) {
  if (!ysdk || !ysdk.getLeaderboards) return false;
  try { const api = await ysdk.getLeaderboards(); await api.setLeaderboardScore(lb, score); return true; }
  catch (e) { return false; }
}
