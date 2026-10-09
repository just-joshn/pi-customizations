export function createStore(seed = ['alpha', 'beta']) {
  const notes = [...seed];
  return {
    list() {
      return [...notes];
    },
    add(text) {
      notes.push(String(text));
      return notes.length;
    },
  };
}
