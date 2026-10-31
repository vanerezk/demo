import { resolve } from 'node:path';
import { sourceFor } from './sources.js';
import { SupplierAAdapter } from './supplier-a.js';
import { SupplierBAdapter } from './supplier-b.js';
import type { SupplierAdapter } from './types.js';

/**
 * Proveedores dados de alta. La ubicación del feed se puede cambiar por .env
 * (SUPPLIER_A_FEED=https://…) sin tocar el código.
 */
export function createSuppliers(env: NodeJS.ProcessEnv = process.env): SupplierAdapter[] {
  const root = process.cwd();
  return [
    new SupplierAAdapter(
      sourceFor(env.SUPPLIER_A_FEED ?? resolve(root, 'fixtures/supplier-a/catalog.json')),
      ['Halden & Rowe', 'Halden and Rowe', 'Halden'],
    ),
    new SupplierBAdapter(
      sourceFor(env.SUPPLIER_B_FEED ?? resolve(root, 'fixtures/supplier-b/tarifa.csv')),
      ['Talleres Orvia', 'Orvia'],
    ),
  ];
}

export function selectSuppliers(all: SupplierAdapter[], selector: string): SupplierAdapter[] {
  if (selector === 'all') return all;
  const ids = selector.split(',').map((s) => s.trim().toLowerCase());
  const unknown = ids.filter((id) => !all.some((s) => s.id === id));
  if (unknown.length) {
    throw new Error(
      `Proveedor desconocido: ${unknown.join(', ')}. Disponibles: ${all.map((s) => s.id).join(', ')}, all`,
    );
  }
  return all.filter((s) => ids.includes(s.id));
}

export type { SupplierAdapter } from './types.js';
