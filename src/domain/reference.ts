/**
 * Referencias públicas propias de la tienda (STR-AL-000123). La correspondencia con la
 * referencia del proveedor se guarda solo en la base de datos interna.
 */
export interface ReferenceAllocator {
  /** Devuelve el número de secuencia asignado a (proveedor, referencia), creando uno si no existe. */
  sequenceFor(supplier: string, supplierRef: string): number;
}

export function formatReference(prefix: string, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0)
    throw new Error(`Secuencia no válida: ${sequence}`);
  return `${prefix}-${String(sequence).padStart(6, '0')}`;
}

/** Asignador en memoria para previsualizaciones y tests. */
export class InMemoryReferenceAllocator implements ReferenceAllocator {
  private readonly map = new Map<string, number>();

  constructor(private next = 1) {}

  sequenceFor(supplier: string, supplierRef: string): number {
    const key = `${supplier}\u0000${supplierRef}`;
    let seq = this.map.get(key);
    if (seq === undefined) {
      seq = this.next++;
      this.map.set(key, seq);
    }
    return seq;
  }
}
