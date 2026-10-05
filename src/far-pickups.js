import * as THREE from 'three';

// Loose stones, sticks and fruit are each their own object, so each is its own draw call, and the ones the world starts with all lie round the oasis pond. Start on the sky
// island and that is about thirty draw calls (a sixth of the view at the spawn) for little things 600 m away that cannot be seen. Past `range` metres from you they are not drawn;
// inside it they are exactly as before. Only the pickups are touched (their `userData` says so); anything else in the same group, like the fruit's halos, is left alone.
// Nothing else switches a pickup's `visible` flag (grabbing looks at the group's, not the item's), so this can put it back without asking anybody.
export const FAR_PICKUPS = Object.freeze({
  range: 250,                                          // metres: a stone is under a pixel across long before this
  flags: Object.freeze(['looseStone', 'looseStick', 'looseFruit']),
});

export const isPickup = (object, flags = FAR_PICKUPS.flags) => flags.some(flag => object.userData?.[flag] === true);

// groups: the Object3Ds whose children are the pickups (they sit at the world's origin, so a child's position is where it is).
export function createFarPickups({ groups, range = FAR_PICKUPS.range, flags = FAR_PICKUPS.flags }) {
  const hidden = new Set();

  // x, z: where you are. Cheap enough to run ten times a second: one distance for each of a few dozen objects.
  function update(x, z) {
    for (const group of groups) {
      for (const child of group.children) {
        if (!isPickup(child, flags)) continue;
        const far = Math.hypot(child.position.x - x, child.position.z - z) > range;
        if (far && child.visible) { child.visible = false; hidden.add(child); }
        else if (!far && hidden.has(child)) { child.visible = true; hidden.delete(child); }
      }
    }
    for (const child of hidden) if (!child.parent) hidden.delete(child); // picked up or eaten while hidden: nothing to put back
  }

  return { update, hiddenCount: () => hidden.size };
}
