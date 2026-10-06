import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_ISLAND, buildIsland, makeMeshGround, outlineRadius, LIP_WALKABLE } from '../src/sky-island-shape.js';

// The owner, 6 Oct: the last few metres of the island's edge were drawn but you fell through them. The ground you walk on must reach over the
// rounded lip as far as it is gentle enough to stand on, follow the drawn lip there, and end before it turns steep.
const data = buildIsland(0, SKY_ISLAND, null);
const ground = makeMeshGround(data, SKY_ISLAND);
const C = SKY_ISLAND;

test('the ground reaches over the lip, follows it down, and ends where it turns steep', () => {
  for (let k = 0; k < 24; k++) {
    const theta = (k / 24) * Math.PI * 2 + 0.013;
    const lipStart = outlineRadius(theta, C) - C.lip;
    const at = r => ground(C.x + Math.cos(theta) * r, C.z + Math.sin(theta) * r);
    const top = at(lipStart - 0.05);
    assert.notEqual(top, null);
    // a metre and three metres out onto the lip: still ground, lower than the top and dropping as the rounding does
    const one = at(lipStart + 1), three = at(lipStart + 3);
    assert.notEqual(one, null, `ground 1 m onto the lip at ${theta.toFixed(2)}`);
    assert.notEqual(three, null, `ground 3 m onto the lip at ${theta.toFixed(2)}`);
    const drop1 = C.lip * (1 - Math.cos(Math.asin(1 / C.lip))), drop3 = C.lip * (1 - Math.cos(Math.asin(3 / C.lip)));
    assert.ok(Math.abs((top - one) - drop1) < 0.15, `1 m out it drops ${(top - one).toFixed(2)} m, the lip ${drop1.toFixed(2)}`);
    assert.ok(Math.abs((top - three) - drop3) < 0.2, `3 m out it drops ${(top - three).toFixed(2)} m, the lip ${drop3.toFixed(2)}`);
    // past the walkable part of the rounding: no ground (you go over)
    assert.equal(at(lipStart + C.lip * Math.sin(LIP_WALKABLE) + 0.1), null);
  }
});
