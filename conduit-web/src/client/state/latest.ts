/** Latest wins: next() retires every call still outstanding and returns this one's check that it is still the latest,
 *  for after each await; drop() retires them without starting one (a close, a cleared field). */
export function createLatest() {
  let current = 0;
  return {
    next: () => {
      const mine = ++current;
      return () => mine === current;
    },
    drop: () => { current++; },
  };
}
