#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import {
  createClient,
  createProduct,
  findProductByReference,
  productContext,
  productUrl,
  RESOURCES,
} from './prestashop/index.js';
import { InMemoryReferenceAllocator } from './domain/reference.js';
import { createPriceCalculator } from './pricing/index.js';
import { logger } from './shared/logger.js';
import { createSuppliers, selectSuppliers } from './suppliers/registry.js';
import { prepareCatalog } from './sync/prepare.js';

type Command = (args: string[]) => Promise<void>;

/** Comprueba conexión y permisos de la clave sobre cada recurso que usa la integración. */
const psPing: Command = async () => {
  const client = createClient();
  const resources = [...Object.keys(RESOURCES), 'images'] as const;
  let ok = true;
  for (const resource of resources) {
    const allowed = await client.canAccess(resource as keyof typeof RESOURCES);
    ok &&= allowed;
    logger.info({ resource, allowed }, allowed ? 'Acceso correcto' : 'Sin permiso');
  }
  if (!ok)
    throw new Error(
      'La clave de API no tiene permiso sobre todos los recursos. Ejecuta npm run setup:webservice',
    );
};

/** Crea (una sola vez) un producto simple de prueba para validar la escritura. */
const psDemoProduct: Command = async (args) => {
  const { values } = parseArgs({
    args,
    options: { reference: { type: 'string', default: 'STR-DEMO-0001' } },
  });
  const config = loadConfig();
  const client = createClient(config);
  const reference = values.reference;

  const existing = await findProductByReference(client, reference);
  if (existing) {
    logger.info(
      { id: existing.id, reference, url: productUrl(config.PS_BASE_URL, Number(existing.id)) },
      'El producto de prueba ya existe',
    );
    return;
  }
  const product = await createProduct(
    client,
    {
      name: 'Alianza clásica media caña 4 mm',
      description:
        '<p>Alianza de boda de perfil media caña, pulida a espejo y con interior confort. Un clásico atemporal.</p>',
      descriptionShort: '<p>Media caña 4 mm, acabado pulido, interior confort.</p>',
      reference,
      // PVP objetivo 449,00 € con IVA del 21 %: se envía la base con 6 decimales.
      priceTaxExcl: 449 / 1.21,
      categoryIds: [config.PS_DEFAULT_CATEGORY_ID],
      active: true,
    },
    productContext(config),
  );
  const id = Number(product.id);
  logger.info(
    { id, reference, url: productUrl(config.PS_BASE_URL, id) },
    'Producto de prueba creado',
  );
};

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

/** Muestra cómo quedaría el catálogo en la tienda (nombres, referencias, PVP), sin tocar nada. */
const catalogPreview: Command = async (args) => {
  const { values } = parseArgs({ args, options: { supplier: { type: 'string', default: 'all' } } });
  const pricing = createPriceCalculator();
  const references = new InMemoryReferenceAllocator();
  for (const adapter of selectSuppliers(createSuppliers(), values.supplier)) {
    const { listings, rejected } = await prepareCatalog(
      adapter,
      { pricing, references, referencePrefix: process.env.REFERENCE_PREFIX ?? 'STR-AL' },
      logger,
    );
    console.log(`\n${adapter.displayName} · margen ${pricing.marginFor(adapter.id)} %`);
    console.table(
      listings.map((l) => {
        const metals = [...new Set(l.combinations.map((c) => c.attributes.Metal))];
        const prices = metals.map((m) => {
          const min = Math.min(
            ...l.combinations.filter((c) => c.attributes.Metal === m).map((c) => c.gross),
          );
          return `${m}: ${eur.format(min)}`;
        });
        return {
          'Ref. tienda': l.reference,
          'Ref. proveedor': l.supplierRef,
          Nombre: l.name,
          Combinaciones: l.combinations.length,
          'PVP desde': prices.join(' | '),
        };
      }),
    );
    for (const r of rejected) console.log(`  ✗ ${r.supplierRef}: ${r.reason}`);
  }
};

const commands: Record<string, Command> = {
  'catalog:preview': catalogPreview,
  'ps:ping': psPing,
  'ps:demo-product': psDemoProduct,
};

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  const command = name ? commands[name] : undefined;
  if (!command) {
    console.error(`Uso: cli <comando>\nComandos: ${Object.keys(commands).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  await command(rest);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
