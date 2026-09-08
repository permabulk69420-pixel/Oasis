// Conventional authored VR grip profiles. Objects choose the closest handle size;
// the hand then holds a fixed pose instead of closing blindly through the mesh.
export const GRIP_PROFILE = Object.freeze({
  THIN: 'thin',
  MEDIUM: 'medium',
  LARGE: 'large',
});

const GRIP_POSES = Object.freeze({
  thin: Object.freeze({ animation: 'Grip', amount: 0.58 }),
  medium: Object.freeze({ animation: 'Grip', amount: 0.72 }),
  large: Object.freeze({ animation: 'Grip', amount: 0.86 }),
});

export function setHeldGripProfile(state, profile = GRIP_PROFILE.MEDIUM) {
  if (!state) return;
  state.heldGripProfile = GRIP_POSES[profile] ? profile : GRIP_PROFILE.MEDIUM;
}

export function clearHeldGripProfile(state) {
  if (state) state.heldGripProfile = null;
}

export function getHeldGripPose(state) {
  return state?.heldGripProfile ? GRIP_POSES[state.heldGripProfile] || null : null;
}
