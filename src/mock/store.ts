import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Entidad con la misma forma que devuelve el Webservice en JSON. */
export type Entity = Record<string, unknown> & { id: number };
export type MultiLang = { id: string; value: string }[];

interface Snapshot {
  nextId: Record<string, number>;
  data: Record<string, Entity[]>;
}

/** Almacén en memoria, opcionalmente persistido en un JSON para sobrevivir a reinicios. */
export class MockStore {
  private data = new Map<string, Map<number, Entity>>();
  private nextId = new Map<string, number>();
  /** Ficheros binarios (imágenes) por recurso/id; no se persisten. */
  readonly files = new Map<string, { contentType: string; body: Buffer; fileName: string }>();

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) this.load(JSON.parse(readFileSync(file, 'utf8')) as Snapshot);
  }

  all(resource: string): Entity[] {
    return [...(this.data.get(resource)?.values() ?? [])];
  }

  get(resource: string, id: number): Entity | undefined {
    return this.data.get(resource)?.get(id);
  }

  insert(resource: string, entity: Omit<Entity, 'id'> & { id?: number }): Entity {
    const id = entity.id ?? this.nextId.get(resource) ?? 1;
    this.nextId.set(resource, Math.max(id + 1, this.nextId.get(resource) ?? 1));
    const stored = { ...entity, id } as Entity;
    this.table(resource).set(id, stored);
    this.persist();
    return stored;
  }

  replace(resource: string, entity: Entity): Entity {
    this.table(resource).set(entity.id, entity);
    this.persist();
    return entity;
  }

  remove(resource: string, id: number): boolean {
    const ok = this.table(resource).delete(id);
    this.persist();
    return ok;
  }

  private table(resource: string): Map<number, Entity> {
    let t = this.data.get(resource);
    if (!t) {
      t = new Map();
      this.data.set(resource, t);
    }
    return t;
  }

  private load(snapshot: Snapshot): void {
    for (const [resource, rows] of Object.entries(snapshot.data)) {
      this.data.set(resource, new Map(rows.map((r) => [r.id, r])));
    }
    this.nextId = new Map(Object.entries(snapshot.nextId));
  }

  private persist(): void {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const snapshot: Snapshot = {
      nextId: Object.fromEntries(this.nextId),
      data: Object.fromEntries([...this.data].map(([k, v]) => [k, [...v.values()]])),
    };
    writeFileSync(this.file, JSON.stringify(snapshot));
  }
}

export function langValue(field: unknown, idLang = 1): string {
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) {
    const entry =
      (field as MultiLang).find((l) => l.id === String(idLang)) ?? (field as MultiLang)[0];
    return entry?.value ?? '';
  }
  return '';
}
