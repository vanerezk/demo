import { describe, expect, it } from 'vitest';
import {
  PrestaShopError,
  isNoticeOnlyFailure,
  isRetryableError,
  parseErrorBody,
} from '../../src/prestashop/errors.js';

const notice =
  '[PHP Notice #8] Trying to access array offset on value of type bool (Product.php, line 7178)';

describe('parseErrorBody', () => {
  it('parses JSON errors', () => {
    expect(parseErrorBody('{"errors":[{"code":18,"message":"Invalid key"}]}')).toEqual([
      { code: 18, message: 'Invalid key' },
    ]);
  });

  it('parses XML errors', () => {
    const xml =
      '<prestashop><errors><error><code><![CDATA[85]]></code><message><![CDATA[Validation error: "price"]]></message></error></errors></prestashop>';
    expect(parseErrorBody(xml)).toEqual([{ code: 85, message: 'Validation error: "price"' }]);
  });

  it('returns no details for non-PrestaShop bodies', () => {
    expect(parseErrorBody('<html>Bad gateway</html>')).toEqual([]);
  });
});

describe('isNoticeOnlyFailure', () => {
  it('accepts a 500 that carries the entity and only PHP notices', () => {
    const body = JSON.stringify({ product: { id: '20' }, errors: [{ code: 5, message: notice }] });
    expect(isNoticeOnlyFailure(500, parseErrorBody(body), body)).toBe(true);
  });

  it('rejects real errors and bodies without data', () => {
    const real = JSON.stringify({ errors: [{ code: 85, message: 'Validation error' }] });
    expect(isNoticeOnlyFailure(500, parseErrorBody(real), real)).toBe(false);
    const onlyNotice = JSON.stringify({ errors: [{ code: 5, message: notice }] });
    expect(isNoticeOnlyFailure(500, parseErrorBody(onlyNotice), onlyNotice)).toBe(false);
  });
});

describe('isRetryableError', () => {
  const err = (status: number, details: { message: string }[] = []) =>
    new PrestaShopError('GET', 'products', status, details, '');

  it('retries gateway errors and bare 500s', () => {
    expect(isRetryableError(err(503))).toBe(true);
    expect(isRetryableError(err(502))).toBe(true);
    expect(isRetryableError(err(500))).toBe(true);
  });

  it('does not retry PrestaShop business errors or 4xx', () => {
    expect(isRetryableError(err(500, [{ message: 'Validation error' }]))).toBe(false);
    expect(isRetryableError(err(400))).toBe(false);
    expect(isRetryableError(err(401))).toBe(false);
  });

  it('retries network failures', () => {
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(true);
  });
});
