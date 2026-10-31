import type { NormalizeResult } from '../domain/model.js';

/**
 * Contrato de un proveedor. Añadir uno nuevo (API REST, CSV o XML por URL) consiste en
 * escribir una clase que lo implemente y registrarla en `registry.ts`.
 *
 *  - `fetch()` obtiene los registros "en bruto", en el formato del proveedor.
 *  - `normalize()` los valida y los convierte al modelo común (`CatalogItem`).
 *    Un registro inválido va a `rejected` con su motivo; nunca detiene el lote.
 */
export interface SupplierAdapter<Raw = unknown> {
  /** Identificador corto y estable (a, b…). Forma parte de la clave en la base de datos. */
  readonly id: string;
  /** Nombre interno del proveedor (nunca se publica). */
  readonly displayName: string;
  /** Marca/razón social que hay que ocultar en la tienda. */
  readonly brands: string[];
  fetch(): Promise<Raw[]>;
  normalize(raw: Raw[]): NormalizeResult;
}
