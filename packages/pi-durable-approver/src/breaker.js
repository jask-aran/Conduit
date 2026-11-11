export function createBreaker({ consecutive = 3, window = 50, windowDenials = 10 } = {}) {
  const histories = new Map();
  return {
    record(id, denied) {
      const history = histories.get(id) ?? [];
      history.push(denied === true);
      histories.set(id, history.slice(-Math.max(consecutive, window, 1)));
    },
    tripped(id) {
      const history = histories.get(id) ?? [];
      return (history.length >= consecutive && history.slice(-consecutive).every(Boolean)) ||
        history.slice(-window).filter(Boolean).length >= windowDenials;
    },
    reset(id) { histories.delete(id); },
  };
}
