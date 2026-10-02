export type SqlValue = string | number | null;

export interface D1StatementLike {
  bind(...values: SqlValue[]): D1StatementLike;
}

export interface D1ResultLike {
  meta?: { changes?: number };
}

export interface D1BatchLike {
  prepare(sql: string): D1StatementLike;
  batch(statements: D1StatementLike[]): Promise<D1ResultLike[]>;
}
