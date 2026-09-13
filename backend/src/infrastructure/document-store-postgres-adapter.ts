export interface PostgresQueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
}

export interface PostgresQueryClient {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<PostgresQueryResult<T>>;
}

export interface DocumentStorePostgresCollectionOptions {
  table: string;
  client: PostgresQueryClient;
  now?: () => Date;
}

export class DocumentStorePostgresCollection {
  private readonly table: string;
  private readonly client: PostgresQueryClient;
  private readonly now: () => Date;

  constructor(options: DocumentStorePostgresCollectionOptions) {
    if (!/^[a-z][a-z0-9_]*$/u.test(options.table)) {
      throw new Error(`Invalid PostgreSQL table name: ${options.table}`);
    }
    this.table = `"${options.table}"`;
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
  }

  async insertOne(document: Record<string, unknown>): Promise<void> {
    await this.client.query(`INSERT INTO ${this.table} (doc) VALUES ($1::jsonb)`, [JSON.stringify(document)]);
  }

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    const where = buildWhereClause(filter);
    const result = await this.client.query<{ doc: unknown }>(
      `SELECT doc FROM ${this.table} WHERE ${where.sql} LIMIT 1`,
      where.values,
    );
    return result.rows[0]?.doc ?? null;
  }

  async updateOne(
    filter: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<{ modifiedCount: number }> {
    const where = buildWhereClause(filter);
    const patchParam = where.values.length + 1;
    const result = await this.client.query(
      `UPDATE ${this.table}
       SET doc = doc || $${patchParam}::jsonb
       WHERE ctid IN (
         SELECT ctid FROM ${this.table} WHERE ${where.sql} LIMIT 1
       )`,
      [...where.values, JSON.stringify(patch)],
    );
    return { modifiedCount: result.rowCount ?? 0 };
  }

  async findActive(deviceId: string, at: string): Promise<unknown | null> {
    const result = await this.client.query<{ doc: unknown }>(
      `SELECT doc FROM ${this.table}
       WHERE doc->>'device_id' = $1
         AND doc->>'status' = 'active'
         AND doc->>'starts_at' <= $2
         AND doc->>'expires_at' > $2
       LIMIT 1`,
      [deviceId, at],
    );
    return result.rows[0]?.doc ?? null;
  }

  async consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const now = this.now().toISOString();
    await this.client.query(
      `INSERT INTO ${this.table} (doc)
       VALUES ($1::jsonb)
       ON CONFLICT ((doc->>'device_id'), (doc->>'date')) DO NOTHING`,
      [JSON.stringify({
        device_id: deviceId,
        date,
        limit,
        used: 0,
        created_at: now,
        updated_at: now,
      })],
    );

    const updated = await this.client.query<{ doc: unknown }>(
      `UPDATE ${this.table}
       SET doc = jsonb_set(
         jsonb_set(
           jsonb_set(doc, '{used}', to_jsonb((COALESCE((doc->>'used')::integer, 0) + 1)), true),
           '{limit}', to_jsonb($3::integer), true
         ),
         '{updated_at}', to_jsonb($4::text), true
       )
       WHERE doc->>'device_id' = $1
         AND doc->>'date' = $2
         AND COALESCE((doc->>'used')::integer, 0) < $3
       RETURNING doc`,
      [deviceId, date, limit, this.now().toISOString()],
    );
    const updatedDocument = asRecord(updated.rows[0]?.doc);
    if (updatedDocument) {
      return { allowed: true, used: readUsed(updatedDocument) };
    }

    const current = await this.findOne({ device_id: deviceId, date });
    return { allowed: false, used: readUsed(asRecord(current) ?? {}) };
  }

  async insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }> {
    try {
      await this.insertOne(document);
      return { inserted: true };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { inserted: false };
      }
      throw error;
    }
  }
}

interface WhereClause {
  sql: string;
  values: unknown[];
}

function buildWhereClause(filter: Record<string, unknown>): WhereClause {
  const clauses: string[] = [];
  const values: unknown[] = [];

  for (const [field, value] of Object.entries(filter)) {
    if (!/^[a-z][a-z0-9_]*$/u.test(field)) {
      throw new Error(`Invalid PostgreSQL JSON field name: ${field}`);
    }
    if (value === null) {
      clauses.push(`(NOT (doc ? '${field}') OR doc->'${field}' = 'null'::jsonb)`);
    } else if (typeof value === "string") {
      values.push(value);
      clauses.push(`doc->>'${field}' = $${values.length}`);
    } else {
      values.push(JSON.stringify(value));
      clauses.push(`doc->'${field}' = $${values.length}::jsonb`);
    }
  }

  return {
    sql: clauses.length > 0 ? clauses.join(" AND ") : "TRUE",
    values,
  };
}

function readUsed(document: Record<string, unknown>): number {
  const used = document.used;
  return typeof used === "number" && Number.isInteger(used) ? used : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}
