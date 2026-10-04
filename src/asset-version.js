import * as THREE from 'three';

// GitHub Pages tells browsers to keep every file for 10 minutes (cache-control: max-age=600), so after a deploy a headset browser can keep
// showing the old models and textures for a while, or mix old and new. Every build gets an id (vite.config.js, the commit on GitHub), and
// each model, texture and sound the three.js loaders fetch gets `?v=<id>` added, so a new deploy asks for new URLs and cannot be served
// from the old cache. In the dev server the id is empty and nothing changes.

export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

const ASSET_FOLDERS = /(^|\/)(models|textures|audio)\//;

// The URL with the build id added, if it is one of our asset files; anything else (blob:, data:, other sites, URLs that already
// have a query) comes back unchanged.
export function versionedUrl(url, id = BUILD_ID) {
  if (!id || typeof url !== 'string') return url;
  if (url.startsWith('blob:') || url.startsWith('data:') || /^https?:\/\//i.test(url) && !url.startsWith(globalThis.location?.origin ?? '\u0000')) return url;
  if (url.includes('?') || !ASSET_FOLDERS.test(url)) return url;
  return `${url}?v=${encodeURIComponent(id)}`;
}

// Call once at start-up, before anything loads.
export function installAssetVersioning(manager = THREE.DefaultLoadingManager, id = BUILD_ID) {
  if (!id) return false;
  manager.setURLModifier(url => versionedUrl(url, id));
  return true;
}
