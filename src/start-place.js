// Where a new game starts (Kane, 5 Oct: spawn him on the floating island): 'island' (the default) or 'oasis' (the old start by the pond).
// `?start=oasis` or `?start=island` asks for one in any build. A dev build that is given a screenshot fixture (?at, ?view, ?bird and so on)
// keeps the oasis, because every one of those was written for the desert; add `&start=island` to look at the island with them.
export const DESERT_FIXTURES = Object.freeze(['at', 'look', 'view', 'eye', 'yaw', 'pitch', 'bird', 'camp', 'treelod']);

export function startPlace(search, dev = false) {
  const params = new URLSearchParams(search);
  const asked = params.get('start');
  if (asked === 'oasis' || asked === 'island') return asked;
  if (dev && DESERT_FIXTURES.some(key => params.has(key))) return 'oasis';
  return 'island';
}
