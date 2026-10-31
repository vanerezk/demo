import { toListing, type Listing, type ListingContext } from '../domain/listing.js';
import type { RejectedRecord } from '../domain/model.js';
import type { Logger } from '../shared/logger.js';
import type { SupplierAdapter } from '../suppliers/types.js';

export interface PreparedCatalog {
  supplier: string;
  listings: Listing[];
  rejected: RejectedRecord[];
}

/**
 * Lee el feed de un proveedor y lo convierte en fichas publicables.
 * Cada fallo (registro inválido, rastro del proveedor, precio no calculable) se registra
 * y se sigue con el resto.
 */
export async function prepareCatalog(
  adapter: SupplierAdapter,
  ctx: Omit<ListingContext, 'supplierBrands'>,
  logger: Logger,
): Promise<PreparedCatalog> {
  const log = logger.child({ supplier: adapter.id });
  const raw = await adapter.fetch();
  const { items, rejected } = adapter.normalize(raw);
  log.info(
    { records: raw.length, items: items.length, rejected: rejected.length },
    'Feed normalizado',
  );
  for (const r of rejected)
    log.warn({ supplierRef: r.supplierRef, reason: r.reason }, 'Registro descartado');

  const listings: Listing[] = [];
  for (const item of items) {
    try {
      listings.push(await toListing(item, { ...ctx, supplierBrands: adapter.brands }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      rejected.push({ supplier: adapter.id, supplierRef: item.supplierRef, reason });
      log.warn(
        { supplierRef: item.supplierRef, reason },
        'Producto descartado al preparar la ficha',
      );
    }
  }
  return { supplier: adapter.id, listings, rejected };
}
