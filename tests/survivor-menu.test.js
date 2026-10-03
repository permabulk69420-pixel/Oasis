import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSurvivorMenu, MENU_SIZE } from '../src/survivor-menu.js';
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
 const states=[left,right].map(inputSource=>({inputSource,controller:new THREE.Group()}));states.forEach(s=>{s.controller.position.set(0,1.4,0);scene.add(s.controller)});
 const slots={left:null,right:null};
 const tools={getHipSlots:()=>({...slots}),equip(type,side){if(!inventory.removeInventoryItem(type,1))return false;if(slots[side])inventory.addInventoryItem(slots[side],1);slots[side]=type;return true;},unequip(side){if(!slots[side])return false;inventory.addInventoryItem(slots[side],1);slots[side]=null;return true;}};
 const menu=createSurvivorMenu({scene,renderer:{xr},states,tools});
 const {width:W,height:H,metres:M}=MENU_SIZE;
 const button=(source,i,value)=>{source.gamepad.buttons[i].pressed=value;menu.update()};
 const click=(x,y)=>{const panel=scene.getObjectByName('Survivor inventory menu');const point=new THREE.Vector3((x/W-.5)*M,(.5-y/H)*M*H/W,0);panel.localToWorld(point);const c=states[1].controller;c.lookAt(point);c.rotateY(Math.PI);c.updateMatrixWorld(true);button(right,0,true);button(right,0,false)};
 button(left,5,true);assert.ok(menu.isOpen());menu.update();assert.ok(menu.isOpen());button(left,5,false);
 assert.ok(scene.getObjectByName('Survivor inventory menu').visible);
 inventory.addInventoryItem('stick',5);inventory.addInventoryItem('stone',3);menu.update();
 click(450,70);assert.ok(body.querySelector('[data-action="craft"]'),'crafting tab shows the craft button');

 click(1334,812);assert.equal(inventory.getInventoryCount('axe'),1);
 menu.update();assert.equal(inventory.getInventoryCount('axe'),1);
 click(212,180);click(1334,812);assert.equal(inventory.getInventoryCount('torch'),1);
 assert.equal(inventory.getInventoryWeight(),15);
 click(1334,812);assert.equal(inventory.getInventoryCount('torch'),1,'cannot craft without materials');
 click(160,70);assert.ok(body.querySelector('[data-action="item:axe"]'));assert.ok(body.querySelector('[data-action="item:torch"]'));

 click(100,180);click(1222,748);
 assert.deepEqual(tools.getHipSlots(),{left:'axe',right:null},'the selected axe goes on the left hip');
 assert.equal(inventory.getInventoryCount('axe'),0);
 click(1334,812);assert.equal(tools.getHipSlots().left,null,'back to backpack');assert.equal(inventory.getInventoryCount('axe'),1);

 click(1500,66);assert.ok(!menu.isOpen());assert.ok(states.every(s=>!s.controller.getObjectByName('Inventory pointer').visible));
 button(left,5,true);assert.ok(menu.isOpen());button(left,5,false);session.visibilityState='hidden';menu.update();assert.ok(!menu.isOpen());
 xr.isPresenting=false;xr.getSession=()=>null;menu.setOpen(true);assert.ok(!body.querySelectorAll('*').find(x=>x.id==='survivor-menu').hidden);
 body.querySelector('[data-action="crafting"]').listeners.click();menu.update();assert.ok(body.querySelector('[data-action="craft"]').disabled);
 body.querySelector('[data-action="close"]').listeners.click();assert.ok(!menu.isOpen());

  } finally { globalThis.document = originalDocument; }
});
