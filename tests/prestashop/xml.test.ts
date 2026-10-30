import { describe, expect, it } from 'vitest';
import { el, langField, renderElement, toPrestaShopXml } from '../../src/prestashop/xml.js';

describe('xml builder', () => {
  it('renders scalar content as CDATA and booleans as 1/0', () => {
    expect(renderElement(el('active', true))).toBe('<active><![CDATA[1]]></active>');
    expect(renderElement(el('price', 10.5))).toBe('<price><![CDATA[10.5]]></price>');
  });

  it('renders multilanguage fields', () => {
    expect(renderElement(langField('name', { 1: 'Alianza' }))).toBe(
      '<name><language id="1"><![CDATA[Alianza]]></language></name>',
    );
  });

  it('keeps HTML and special characters intact inside CDATA', () => {
    const xml = renderElement(el('description', '<p>Oro & platino</p>'));
    expect(xml).toBe('<description><![CDATA[<p>Oro & platino</p>]]></description>');
  });

  it('splits a CDATA terminator found in the text', () => {
    expect(renderElement(el('x', 'a]]>b'))).toBe('<x><![CDATA[a]]]]><![CDATA[>b]]></x>');
  });

  it('escapes attributes and renders empty elements', () => {
    expect(renderElement(el('a', undefined, { id: 'x"<&' }))).toBe('<a id="x&quot;&lt;&amp;"/>');
  });

  it('wraps entities in the prestashop root element', () => {
    const xml = toPrestaShopXml('product', [el('price', 1)]);
    expect(xml).toContain('<prestashop xmlns:xlink="http://www.w3.org/1999/xlink"><product>');
    expect(xml.endsWith('</product></prestashop>')).toBe(true);
  });
});
