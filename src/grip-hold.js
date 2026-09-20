// One completion per squeeze. Moving off the item or losing the source cancels.
export function createGripHold(duration = 3) {
  let target = null, source = null, elapsed = 0, completed = false;
  return {
    reset() { target = null; source = null; elapsed = 0; completed = false; },
    update(item, inputSource, pressed, dt) {
      if (!item || !inputSource || !pressed) { this.reset(); return { progress: 0, complete: false }; }
      if (target !== item || source !== inputSource) {
        target = item; source = inputSource; elapsed = 0; completed = false;
      }
      if (completed) return { progress: 0, complete: false };
      elapsed += Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0));
      if (elapsed + 1e-8 >= duration) { completed = true; return { progress: 1, complete: true }; }
      return { progress: elapsed / duration, complete: false };
    },
  };
}
