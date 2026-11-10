/** Latest wins: next() retires every call still outstanding and returns this one's check that it is still the latest,
 *  for after each await; drop() retires them without starting one (a close, a cleared field); join() returns the
 *  check for the call outstanding now without retiring it (work that belongs to it, begun later). */
export function createLatest() {
  let current = 0;
  return {
    next: () => {
      const mine = ++current;
      return () => mine === current;
    },
    drop: () => { current++; },
    join: () => {
      const mine = current;
      return () => mine === current;
    },
  };
}
