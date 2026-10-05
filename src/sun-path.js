import * as THREE from 'three';
import { SUN } from './world.js';

// Where the sun is at any point of the day, and so the moon (always opposite it): one smooth path, shared by the day/night cycle, the sky and
// the tests.
//
// A twilight planet (Kane, 5 Oct): the sun never climbs far. It comes up over the horizon, slides round along it (peaking at SUN_PEAK_DEGREES, a
// hand's width up) and sets, so the whole day is long, low, golden-to-red light and shadows. The moon is opposite it, so it is as low by night.
//
// The azimuth (which way round the sun is) used to be fixed in the morning and then jump to the opposite side at noon, and the same again at
// midnight, so the sun, the light on everything and the moon each popped 63 degrees across the sky once a cycle. Now the sun swings round
// by half a turn over the day instead: slowly near the horizons, quickest at the top of its arc. It still rises and sets on the same line,
// the heights at every hour are exactly what they were, and at the starting time it is exactly where INITIAL_SUN says.

const TAU = Math.PI * 2;

export const SUN_PEAK_DEGREES = 14;
export const SUN_ARC = SUN_PEAK_DEGREES / 90; // the sun's elevation is asin(sin(angle)) (up to 90 degrees) times this
export const INITIAL_SUN = new THREE.Vector3(SUN.x, SUN.y, SUN.z).normalize();

// How far round the sun has gone when the day is `angle` radians old (0 at sunrise, pi at sunset, 2 pi at the next sunrise): half a turn
// per half cycle, eased so the swing starts and ends slowly (the rate is zero at each horizon crossing and twice the average at the top).
export const swing = angle => angle - 0.5 * Math.sin(2 * angle);

// The point of the cycle (0..1; 0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight) the game starts at: a little after sunrise.
export const INITIAL_PHASE = 0.14;

// The sun's compass bearing (radians, the angle of its direction in the x-z plane) at sunrise, chosen so that it is INITIAL_SUN's bearing at
// INITIAL_PHASE: the sun starts on the same side of the sky as it always has (INITIAL_SUN's bearing; its height no longer matches, the sun is lower now). It turns the other way from the x-z angle, so the sun goes round behind
// the player at the start (who faces the pond) rather than across the view.
export const SUNRISE_BEARING = Math.atan2(INITIAL_SUN.z, INITIAL_SUN.x) + swing(INITIAL_PHASE * TAU);

export function sunDirectionFor(phase, target = new THREE.Vector3()) {
  const angle = phase * TAU;
  const elevation = Math.asin(Math.sin(angle)) * SUN_ARC;
  const bearing = SUNRISE_BEARING - swing(angle);
  const level = Math.cos(elevation);
  return target.set(level * Math.cos(bearing), Math.sin(elevation), level * Math.sin(bearing)).normalize();
}
