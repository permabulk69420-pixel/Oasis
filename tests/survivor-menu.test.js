import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSurvivorMenu } from '../src/survivor-menu.js';
import * as inventory from '../src/inventory.js';

// Minimal DOM surface; raycasting and menu code below are the real implementations.
class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.listeners={};this.attributes={};}
 append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n)}}
 setAttribute(k,v){this.attributes[k]=v}
 addEventListener(k,v){this.listeners[k]=v}
 remove(){this.parent.children=this.parent.children.filter(x=>x!==this)}
 focus(){document.activeElement=this}
 querySelector(s){return this.querySelectorAll(s)[0]}
 querySelectorAll(s){return this.children.flatMap(n=>[n,...(n.querySelectorAll?.('*')||[])]).filter(n=>s==='*'||s==='button:not(:disabled)'&&n.tagName==='button'&&!n.disabled||n.dataset?.action===s.match(/data-action="([^"]+)"/)?.[1])}
}

test('Quest controller rays and desktop callbacks share the same crafting inventory', () => {
  const originalDocument = globalThis.document;
  const body = new Element('body');
  const context = new Proxy({ measureText: text => ({ width: text.length * 12 }) }, {
    get: (target, key) => target[key] ?? (() => {}),
  });
  globalThis.document = { body, activeElement: body, createElement(tag) {
    const node = new Element(tag);
    if (tag === 'canvas') node.getContext = () => context;
    return node;
  } };
  try {
 const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera();camera.position.set(0,1.7,0);scene.add(camera);scene.updateMatrixWorld(true);
 const source=handedness=>({handedness,targetRayMode:'tracked-pointer',gamepad:{buttons:Array.from({length:6},()=>({pressed:false}))}});
 const left=source('left'),right=source('right');const session={visibilityState:'visible',inputSources:[right,left]};
 const xr={isPresenting:true,getSession:()=>session,getCamera:()=>camera,addEventListener:()=>{}};
 const states=[left,right].map(inputSource=>({inputSource,controller:new THREE.Group(),objectGrip:new THREE.Group()}));states.forEach(s=>{s.controller.position.set(0,1.4,0);scene.add(s.controller)});
 const equipped = [];
 const menu=createSurvivorMenu({scene,renderer:{xr},states,onEquip(type, state) {
   equipped.push({ type, state });
   assert.ok(inventory.removeInventoryItem(type));
   return { ok: true };
 }});
 const button=(source,i,value)=>{source.gamepad.buttons[i].pressed=value;menu.update()};
 const click=(x,y)=>{const panel=scene.getObjectByName('Survivor inventory menu');const point=new THREE.Vector3((x/1440-.5)*1.76,(.5-y/900)*1.10,0);panel.localToWorld(point);const c=states[1].controller;c.lookAt(point);c.rotateY(Math.PI);c.updateMatrixWorld(true);button(right,0,true);button(right,0,false)};
 button(left,5,true);assert.ok(menu.isOpen());menu.update();assert.ok(menu.isOpen());button(left,5,false);
 assert.ok(scene.getObjectByName('Survivor inventory menu').visible);
 inventory.addInventoryItem('stick',5);inventory.addInventoryItem('stone',3);menu.update();
 click(480,166);assert.ok(body.querySelector('[data-action="craft"]'));

 click(300,654);assert.equal(inventory.getInventoryCount('axe'),1);
 menu.update();assert.equal(inventory.getInventoryCount('axe'),1);
 click(475,305);click(300,654);assert.equal(inventory.getInventoryCount('torch'),1);
 assert.equal(inventory.getInventoryWeight(),15);
 click(300,654);assert.equal(inventory.getInventoryCount('torch'),1);
 click(180,165);assert.ok(body.querySelector('[data-action="item:axe"]'));assert.ok(body.querySelector('[data-action="item:torch"]'));

 // Hold the actual controller ray on the inventory slot: short holds and
 // interruptions must not equip, then either hand can complete its own hold.
 const aim = (index, x, y) => {
   const panel = scene.getObjectByName('Survivor inventory menu');
   const point = new THREE.Vector3((x / 1440 - .5) * 1.76, (.5 - y / 900) * 1.10, 0);
   panel.localToWorld(point);
   const controller = states[index].controller;
   controller.lookAt(point); controller.rotateY(Math.PI); controller.updateMatrixWorld(true);
 };
 aim(1, 144, 320); right.gamepad.buttons[1].pressed = true;
 for (let i = 0; i < 20; i++) menu.update(.1);
 assert.equal(equipped.length, 0);
 aim(1, 900, 800); menu.update(.1);
 aim(1, 144, 320);
 for (let i = 0; i < 29; i++) menu.update(.1);
 assert.equal(equipped.length, 0, 'moving away must restart the timer');
 menu.update(.1);
 assert.equal(equipped.length, 1);
 assert.equal(equipped[0].type, 'axe'); assert.equal(equipped[0].state, states[1]);
 assert.ok(!menu.isOpen(), 'successful equip closes inventory');
 right.gamepad.buttons[1].pressed = false;
 menu.setOpen(true); aim(0, 144, 320); left.gamepad.buttons[1].pressed = true;
 for (let i = 0; i < 30; i++) menu.update(.1);
 assert.equal(equipped.length, 2);
 assert.equal(equipped[1].type, 'torch'); assert.equal(equipped[1].state, states[0]);
 assert.ok(!menu.isOpen());
 left.gamepad.buttons[1].pressed = false;
 menu.setOpen(true);
 click(1300,50);assert.ok(!menu.isOpen());assert.ok(states.every(s=>!s.controller.getObjectByName('Inventory pointer').visible));
 button(left,5,true);assert.ok(menu.isOpen());button(left,5,false);session.visibilityState='hidden';menu.update();assert.ok(!menu.isOpen());
 xr.isPresenting=false;xr.getSession=()=>null;menu.setOpen(true);assert.ok(!body.querySelectorAll('*').find(x=>x.id==='survivor-menu').hidden);
 body.querySelector('[data-action="crafting"]').listeners.click();menu.update();assert.ok(body.querySelector('[data-action="craft"]').disabled);
 body.querySelector('[data-action="close"]').listeners.click();assert.ok(!menu.isOpen());

  } finally { globalThis.document = originalDocument; }
});
