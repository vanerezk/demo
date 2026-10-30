import { loadConfig, type AppConfig } from '../config.js';
import { logger } from '../shared/logger.js';
import { PrestaShopClient } from './client.js';
import type { ProductContext } from './products.js';

export function createClient(config: AppConfig = loadConfig()): PrestaShopClient {
  return new PrestaShopClient({
    baseUrl: config.PS_BASE_URL,
    apiKey: config.PS_WEBSERVICE_KEY,
    logger,
  });
}

export function productContext(config: AppConfig = loadConfig()): ProductContext {
  return {
    idLang: config.PS_ID_LANG,
    idShop: config.PS_ID_SHOP,
    idTaxRulesGroup: config.PS_TAX_RULES_GROUP_ID,
  };
}

export { PrestaShopClient, RESOURCES, type Resource } from './client.js';
export { PrestaShopError } from './errors.js';
export * from './products.js';
