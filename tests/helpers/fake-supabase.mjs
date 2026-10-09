// Minimal in-memory stand-in for the supabase-js query builder, covering only
// the calls lib/curator-jobs.js makes. `failWrites` makes every upsert/update
// return { error }, like a frozen or rejecting database.
export class FakeSupabase {
  constructor() {
    this.rows = new Map(); // id -> row
    this.failWrites = null; // error message or null
  }
  from() {
    return new Query(this);
  }
}

class Query {
  constructor(db) {
    this.db = db;
    this.op = 'select';
    this.filters = [];
    this.isSingle = false;
  }
  select() { return this; }
  order() { return this; }
  single() { this.isSingle = true; return this; }
  eq(col, val) { this.filters.push((r) => r[col] === val); return this; }
  or() { return this; }
  upsert(row) { this.op = 'upsert'; this.row = row; return this; }
  update(patch) { this.op = 'update'; this.patch = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  then(resolve, reject) {
    try { resolve(this.run()); } catch (e) { reject(e); }
  }
  run() {
    const { db } = this;
    if ((this.op === 'upsert' || this.op === 'update') && db.failWrites) return { data: null, error: { message: db.failWrites } };
    const match = [...db.rows.values()].filter((r) => this.filters.every((f) => f(r)));
    if (this.op === 'upsert') { db.rows.set(this.row.id, { ...db.rows.get(this.row.id), ...structuredClone(this.row) }); return { data: null, error: null }; }
    if (this.op === 'update') { for (const r of match) Object.assign(r, this.patch); return { data: match.map((r) => ({ id: r.id })), error: null }; }
    if (this.op === 'delete') { for (const r of match) db.rows.delete(r.id); return { data: null, error: null }; }
    const data = match.map((r) => structuredClone(r));
    if (this.isSingle) return data.length ? { data: data[0], error: null } : { data: null, error: { message: 'no rows' } };
    return { data, error: null };
  }
}
