import { XMLParser } from 'fast-xml-parser';
import type { MultiLang } from './store.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: false,
  // <language> y los elementos dentro de <associations><x> siempre son listas.
  isArray: (name, jpath) => {
    const path = String(jpath).split('.');
    return name === 'language' || (path[2] === 'associations' && path.length === 5);
  },
});

type XmlNode = string | Record<string, unknown>;

/**
 * Convierte el XML de escritura del Webservice en la forma JSON de lectura:
 *  - <name><language id="1">x</language></name>   -> name: [{ id: "1", value: "x" }]
 *  - <associations><categories><category><id>2</id>… -> associations: { categories: [{ id: "2" }] }
 */
export function parseEntityXml(xml: string): { entity: string; fields: Record<string, unknown> } {
  const doc = parser.parse(xml) as { prestashop?: Record<string, unknown> };
  const root = doc.prestashop;
  if (!root || typeof root !== 'object') throw new Error('Falta el elemento <prestashop>');
  const entityName = Object.keys(root).find((k) => !k.startsWith('@_'));
  if (!entityName) throw new Error('El documento no contiene ninguna entidad');
  const node = root[entityName];
  const fields: Record<string, unknown> = {};
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith('@_')) continue;
      fields[key] =
        key === 'associations' ? parseAssociations(value) : parseField(value as XmlNode);
    }
  }
  return { entity: entityName, fields };
}

function text(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'object' && '#text' in node) return String(node['#text']).trim();
  return '';
}

function parseField(value: XmlNode): unknown {
  if (typeof value === 'object' && Array.isArray((value as { language?: unknown }).language)) {
    return ((value as { language: unknown[] }).language as Record<string, unknown>[]).map(
      (l): MultiLang[number] => ({ id: String(l['@_id']), value: text(l) }),
    );
  }
  return text(value);
}

function parseAssociations(value: unknown): Record<string, Record<string, string>[]> {
  const out: Record<string, Record<string, string>[]> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [assoc, container] of Object.entries(value as Record<string, unknown>)) {
    if (assoc.startsWith('@_')) continue;
    const items =
      container && typeof container === 'object'
        ? Object.values(container).find(Array.isArray)
        : undefined;
    out[assoc] = ((items ?? []) as Record<string, unknown>[]).map((item) =>
      Object.fromEntries(
        Object.entries(item)
          .filter(([k]) => !k.startsWith('@_'))
          .map(([k, v]) => [k, text(v)]),
      ),
    );
  }
  return out;
}
