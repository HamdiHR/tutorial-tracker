// Adapter: the small part of node:sqlite that the engine uses, on top of the official sqlite-wasm oo1 API.
// prepare(sql) -> { run, get, all } with positional params; exec(sql). Statements are cached per SQL text.
export class DatabaseSync { constructor() { throw new Error('DatabaseSync is Node-only; use wrapDb()'); } }
const clean = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
export function wrapDb(sqlite3, odb) {
  const cache = new Map();
  const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = odb.prepare(sql); cache.set(sql, s); } return s; };
  return {
    exec(sql) { odb.exec(sql); },
    close() { for (const s of cache.values()) s.finalize(); cache.clear(); odb.close(); },
    prepare(sql) {
      return {
        run(...p) {
          const s = stmt(sql);
          try { if (p.length) s.bind(clean(p)); while (s.step()) { /* drain */ } }
          finally { s.reset(true); }
          return { changes: odb.changes(), lastInsertRowid: Number(sqlite3.capi.sqlite3_last_insert_rowid(odb.pointer)) };
        },
        get(...p) {
          const s = stmt(sql);
          try { if (p.length) s.bind(clean(p)); return s.step() ? s.get({}) : undefined; } finally { s.reset(true); }
        },
        all(...p) {
          const s = stmt(sql); const out = [];
          try { if (p.length) s.bind(clean(p)); while (s.step()) out.push(s.get({})); } finally { s.reset(true); }
          return out;
        },
      };
    },
  };
}
