import * as THREE from 'three';

const CHEST_Y_OFFSET = 0.38;
const CHEST_HORIZONTAL_RADIUS = 0.34;
const CHEST_VERTICAL_RADIUS = 0.25;
const headPosition = new THREE.Vector3();
const handPosition = new THREE.Vector3();

// Call after renderer.xr.updateCamera(camera). The XR camera is not parented
// to the player rig: recomputing its world matrix here can discard the rig's
// translation. Read the world matrix prepared by WebXRManager instead.
export function isHandAtChest(renderer, state) {
  if (!renderer?.xr?.isPresenting || !state?.inputSource) return false;
  const xrCamera = renderer.xr.getCamera();
  const grip = state.grip || state.objectGrip;
  if (!xrCamera || !grip) return false;

  headPosition.setFromMatrixPosition(xrCamera.matrixWorld);
  // Use the tracked controller, not the animated finger/held-object socket.
  grip.updateWorldMatrix(true, false);
  handPosition.setFromMatrixPosition(grip.matrixWorld);
  const horizontalDistance = Math.hypot(
    handPosition.x - headPosition.x,
    handPosition.z - headPosition.z,
  );
  const verticalDistance = Math.abs(handPosition.y - (headPosition.y - CHEST_Y_OFFSET));
  return horizontalDistance <= CHEST_HORIZONTAL_RADIUS
    && verticalDistance <= CHEST_VERTICAL_RADIUS;
}
