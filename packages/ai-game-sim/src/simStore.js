"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.get = get;
exports.set = set;
exports.remove = remove;
exports.size = size;
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const store = new Map();
function evictStale() {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const [id, entry] of store) {
        if (entry.updatedAt < cutoff) {
            store.delete(id);
        }
    }
}
function get(id) {
    return store.get(id)?.state;
}
function set(id, state) {
    store.set(id, { state, updatedAt: Date.now() });
    // Periodically evict stale sessions to prevent unbounded memory growth.
    if (store.size % 50 === 0) {
        evictStale();
    }
}
function remove(id) {
    store.delete(id);
}
function size() {
    return store.size;
}
//# sourceMappingURL=simStore.js.map