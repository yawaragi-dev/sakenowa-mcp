import pg from 'pg';

/**
 * Minimal read-only database seam.
 *
 * Tool query functions depend on this interface rather than on `pg.Pool`
 * directly, so unit tests can pass a tiny stub object literal while
 * integration tests and production pass a real pool. `pg.Pool` satisfies this
 * structurally with no adapter code.
 */
export interface Db {
  query<R>(sql: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/**
 * Create a `pg.Pool` from a connection string. The returned pool already
 * satisfies the `Db` interface.
 */
export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}
