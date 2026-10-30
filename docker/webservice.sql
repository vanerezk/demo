-- Activa el Webservice y crea la clave __WS_KEY__ con permisos CRUD sobre
-- los recursos que necesita catalog-sync. Idempotente.
SET @key := '__WS_KEY__';

UPDATE ps_configuration SET value = '1', date_upd = NOW() WHERE name = 'PS_WEBSERVICE';
INSERT INTO ps_configuration (name, value, date_add, date_upd)
  SELECT 'PS_WEBSERVICE', '1', NOW(), NOW() FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM ps_configuration WHERE name = 'PS_WEBSERVICE');

INSERT INTO ps_webservice_account (`key`, description, class_name, is_module, module_name, active)
  SELECT @key, 'catalog-sync', 'WebserviceRequest', 0, NULL, 1 FROM DUAL
  WHERE NOT EXISTS (SELECT 1 FROM ps_webservice_account WHERE `key` = @key);
UPDATE ps_webservice_account SET active = 1 WHERE `key` = @key;

SET @acc := (SELECT id_webservice_account FROM ps_webservice_account WHERE `key` = @key);

INSERT IGNORE INTO ps_webservice_account_shop (id_webservice_account, id_shop) VALUES (@acc, 1);

DELETE FROM ps_webservice_permission WHERE id_webservice_account = @acc;
INSERT INTO ps_webservice_permission (resource, method, id_webservice_account)
SELECT r.resource, m.method, @acc
FROM (
  SELECT 'products' AS resource UNION ALL SELECT 'combinations'
  UNION ALL SELECT 'product_options' UNION ALL SELECT 'product_option_values'
  UNION ALL SELECT 'stock_availables' UNION ALL SELECT 'categories'
  UNION ALL SELECT 'images'
) r
CROSS JOIN (
  SELECT 'GET' AS method UNION ALL SELECT 'POST' UNION ALL SELECT 'PUT'
  UNION ALL SELECT 'DELETE' UNION ALL SELECT 'HEAD'
) m;
