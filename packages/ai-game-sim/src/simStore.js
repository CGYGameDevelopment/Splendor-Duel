"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = get;
exports.set = set;
exports.remove = remove;
exports.size = size;
const store = new Map();
function get(id) {
    return store.get(id);
}
function set(id, state) {
    store.set(id, state);
}
function remove(id) {
    store.delete(id);
}
function size() {
    return store.size;
}
//# sourceMappingURL=simStore.js.map