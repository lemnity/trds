-- Учение восстановления (T-072, docs/runbook.md): синтетические данные в учебной БД.
-- Только вымышленные адреса @example.invalid — никаких реальных ПД (rules.md §4).
-- Запуск: psql "<URL учебной БД>" -v ON_ERROR_STOP=1 -v scale=1 -f scripts/drill/seed.sql
-- scale=1 ≈ 10 тыс. покупателей; объём остальных таблиц пропорционален.
\set customers (10000 * :scale)

begin;

insert into accounts_customers (id, email, name, created_at)
select gen_random_uuid(), 'drill-' || g || '@example.invalid', 'Зритель ' || g,
       now() - (g % 365) * interval '1 day'
from generate_series(1, :customers) g;

-- Коды входа: половина давно истекла (их удалит accounts.cleanup), половина свежие.
insert into accounts_auth_codes (id, email, code_hash, purpose, attempts, expires_at, created_at)
select gen_random_uuid(), 'drill-' || (g % :customers + 1) || '@example.invalid', md5(g::text), 'login', 0,
       case when g % 2 = 0 then now() - interval '2 days' else now() + interval '10 minutes' end,
       now() - interval '1 hour'
from generate_series(1, :customers * 2) g;

-- Сессии: часть закончилась больше 30 дней назад, остальные активны.
insert into accounts_sessions (id, token_hash, customer_id, expires_at, created_at)
select gen_random_uuid(), md5('s' || c.n), c.id,
       case when c.n % 4 = 0 then now() - interval '40 days' else now() + interval '20 days' end,
       now() - interval '10 days'
from (select id, row_number() over (order by email) as n from accounts_customers) c;

insert into accounts_consents (id, email, document, version, context, given_at)
select gen_random_uuid(), email, 'personal-data', 'draft-2026-10', 'drill', created_at
from accounts_customers;

-- Бонусы: по три лота на покупателя; каждый десятый лот уже сгорел, но с остатком
-- (его обнулит wallet.expire).
insert into wallet_ledger (id, customer_id, kind, amount_kopecks, lot_remaining_kopecks, expires_at,
                           idempotency_key, created_at)
select gen_random_uuid(), c.id, 'purchase', 15000, 15000,
       case when (c.n + k) % 10 = 0 then now() - interval '1 day' else now() + interval '300 days' end,
       'drill:' || c.id || ':' || k, now() - interval '30 days'
from (select id, row_number() over (order by email) as n from accounts_customers) c,
     generate_series(1, 3) k;

insert into wallet_certificates (id, code_hash, last4, amount_kopecks, status, issued_by, created_at)
select gen_random_uuid(), md5('cert' || g), lpad((g % 10000)::text, 4, '0'), 300000, 'issued', 'drill', now()
from generate_series(1, :customers / 20) g;

commit;

select 'accounts_customers' as table_name, count(*) from accounts_customers
union all select 'accounts_auth_codes', count(*) from accounts_auth_codes
union all select 'accounts_sessions', count(*) from accounts_sessions
union all select 'wallet_ledger', count(*) from wallet_ledger
union all select 'wallet_certificates', count(*) from wallet_certificates;
