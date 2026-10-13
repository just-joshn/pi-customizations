const Fuse = require('fuse.js');
function searchNotes(query, index) {
  return new Fuse(index, { keys: ['title', 'body'], threshold: 0.35 }).search(query);
}
module.exports = { searchNotes };
