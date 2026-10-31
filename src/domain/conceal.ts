/**
 * Ocultación del origen: nada de lo que se publica en la tienda puede delatar al proveedor.
 *
 * Dos capas:
 *  1. `stripSupplierMarks()` limpia textos libres (marca, "by X", "Ref. XXX", ®/™…).
 *  2. `findSupplierTraces()` es la red de seguridad: revisa lo que se va a publicar y, si
 *     encuentra la marca o una referencia del proveedor, el producto se rechaza en lugar
 *     de publicarse.
 */

export interface SupplierMarks {
  /** Marca(s) y razón social del proveedor. */
  brands: string[];
  /** Referencias y SKUs del proveedor. */
  refs: string[];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Regex que encuentra `term` ignorando mayúsculas y tildes, como palabra completa. */
function termRegex(term: string): RegExp {
  // Cada letra acepta su versión con o sin tilde; los espacios aceptan cualquier separador.
  const pattern = Array.from(fold(term))
    .map((ch) => {
      if (/\s/.test(ch)) return '[\\s\\-_.]+';
      const variants: Record<string, string> = {
        a: '[aáàäâ]',
        e: '[eéèëê]',
        i: '[iíìïî]',
        o: '[oóòöô]',
        u: '[uúùüû]',
        n: '[nñ]',
        c: '[cç]',
      };
      return variants[ch] ?? escapeRe(ch);
    })
    .join('');
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu');
}

export function stripSupplierMarks(text: string, marks: SupplierMarks): string {
  let out = text.replace(/[®™©]/g, '');
  // "(ref. ABC-123)", "Ref: ABC-123", "SKU ABC-123", "Art. nº 123"
  out = out.replace(
    /\(?\b(?:ref|sku|art|cod|código|codigo)\b\.?\s*(?:n[º°o]\.?\s*)?[:#]?\s*[\w-]+\)?/giu,
    '',
  );
  for (const brand of marks.brands.filter(Boolean)) {
    // "by Marca", "de Marca", "- Marca", "Marca"
    out = out.replace(new RegExp(`(?:\\b(?:by|de|por)\\s+)?${termRegex(brand).source}`, 'giu'), '');
  }
  for (const ref of marks.refs.filter(Boolean)) out = out.replace(termRegex(ref), '');
  return out
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/(?:\s*[-–|·]\s*)+$/g, '')
    .replace(/^(?:\s*[-–|·]\s*)+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Devuelve las marcas o referencias del proveedor que aparecen en `text`. */
export function findSupplierTraces(text: string, marks: SupplierMarks): string[] {
  return [...marks.brands, ...marks.refs]
    .filter((term) => term.trim().length >= 2)
    .filter((term) => termRegex(term).test(text));
}
