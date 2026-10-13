const routes = {
  '#/notes': () => document.querySelector('#app').textContent = 'Notes',
  '#/settings': () => document.querySelector('#app').textContent = 'Settings',
};
window.addEventListener('hashchange', () => routes[location.hash]?.());
window.notesApi.search(document.querySelector('#q')?.value ?? '');
