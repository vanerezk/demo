import 'dotenv/config';
import { resolve } from 'node:path';
import { logger } from '../shared/logger.js';
import { MockPrestaShop } from './server.js';

const apiKey = process.env.PS_WEBSERVICE_KEY ?? '';
if (!/^[A-Z0-9]{32}$/.test(apiKey)) {
  logger.fatal(
    'Define PS_WEBSERVICE_KEY en .env (32 caracteres A-Z0-9) antes de arrancar el simulador',
  );
  process.exit(1);
}

const port = Number(process.env.MOCK_PS_PORT ?? 8080);
const mock = new MockPrestaShop({
  apiKey,
  dataFile: resolve(process.env.MOCK_PS_DATA ?? 'data/mock-prestashop.json'),
  notices: process.env.MOCK_PS_NOTICES !== '0',
  failureRate: Number(process.env.MOCK_PS_FAILURE_RATE ?? 0),
});
const url = await mock.listen(port);
logger.info(
  { url, api: `${url}/api`, data: process.env.MOCK_PS_DATA ?? 'data/mock-prestashop.json' },
  'Simulador de PrestaShop listo',
);
if (process.env.PS_BASE_URL && process.env.PS_BASE_URL.replace(/\/+$/, '') !== url) {
  logger.warn({ PS_BASE_URL: process.env.PS_BASE_URL, url }, 'PS_BASE_URL no apunta al simulador');
}
