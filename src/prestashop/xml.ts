/**
 * Constructor mínimo de XML para el Webservice de PrestaShop.
 *
 * El Webservice lee en JSON pero solo acepta escrituras en XML con esta forma:
 *   <prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
 *     <product>
 *       <price>10</price>
 *       <name><language id="1"><![CDATA[Alianza]]></language></name>
 *     </product>
 *   </prestashop>
 */

export type XmlScalar = string | number | boolean;

export interface XmlElement {
  name: string;
  attrs?: Record<string, XmlScalar>;
  /** Texto (se emite como CDATA) o elementos hijos. */
  content?: XmlScalar | XmlElement[];
}

export function el(
  name: string,
  content?: XmlScalar | XmlElement[],
  attrs?: Record<string, XmlScalar>,
): XmlElement {
  return { name, ...(content !== undefined ? { content } : {}), ...(attrs ? { attrs } : {}) };
}

/** Campo multiidioma: <name><language id="1">…</language></name>. */
export function langField(name: string, values: Record<number, string>): XmlElement {
  return el(
    name,
    Object.entries(values).map(([id, value]) => el('language', value, { id: Number(id) })),
  );
}

function escapeAttr(value: XmlScalar): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function cdata(value: XmlScalar): string {
  const text = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
  // "]]>" no puede aparecer dentro de una sección CDATA: se parte en dos.
  return `<![CDATA[${text.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

export function renderElement(node: XmlElement): string {
  const attrs = node.attrs
    ? Object.entries(node.attrs)
        .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
        .join('')
    : '';
  if (node.content === undefined) return `<${node.name}${attrs}/>`;
  const inner = Array.isArray(node.content)
    ? node.content.map(renderElement).join('')
    : cdata(node.content);
  return `<${node.name}${attrs}>${inner}</${node.name}>`;
}

/** Documento completo para POST/PUT: <prestashop><{entity}>…</{entity}></prestashop>. */
export function toPrestaShopXml(entity: string, fields: XmlElement[]): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">${renderElement(el(entity, fields))}</prestashop>`
  );
}
