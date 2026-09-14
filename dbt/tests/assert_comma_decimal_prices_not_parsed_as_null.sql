-- Test singular: ningún precio crudo con coma decimal española (p.ej.
-- "1,749") debe acabar como NULL después del parseo en stg_stations. Este
-- test pasa si la consulta no devuelve filas.
--
-- Apunta directamente al quirk documentado de _to_float() en
-- backend/app/ingestion.py: un valor con coma que no se normaliza a punto
-- antes del cast numérico falla silenciosamente a NULL en vez de lanzar un
-- error, así que hace falta un test explícito para pillarlo.

with raw_prices as (

    select
        run_id,
        payload ->> 'IDEESS' as ideess_text,
        'Precio Gasoleo A' as price_field,
        payload ->> 'Precio Gasoleo A' as raw_value
    from {{ source('raw', 'raw_stations') }}

    union all

    select
        run_id,
        payload ->> 'IDEESS',
        'Precio Gasoleo B',
        payload ->> 'Precio Gasoleo B'
    from {{ source('raw', 'raw_stations') }}

    union all

    select
        run_id,
        payload ->> 'IDEESS',
        'Precio Gasoleo Premium',
        payload ->> 'Precio Gasoleo Premium'
    from {{ source('raw', 'raw_stations') }}

    union all

    select
        run_id,
        payload ->> 'IDEESS',
        'Precio Gasolina 95 E5',
        payload ->> 'Precio Gasolina 95 E5'
    from {{ source('raw', 'raw_stations') }}

    union all

    select
        run_id,
        payload ->> 'IDEESS',
        'Precio Gasolina 98 E5',
        payload ->> 'Precio Gasolina 98 E5'
    from {{ source('raw', 'raw_stations') }}

),

staged_prices as (

    select
        run_id,
        ideess::text as ideess_text,
        'Precio Gasoleo A' as price_field,
        precio_gasoleo_a as parsed_value
    from {{ ref('stg_stations') }}

    union all

    select run_id, ideess::text, 'Precio Gasoleo B', precio_gasoleo_b
    from {{ ref('stg_stations') }}

    union all

    select run_id, ideess::text, 'Precio Gasoleo Premium', precio_gasoleo_premium
    from {{ ref('stg_stations') }}

    union all

    select run_id, ideess::text, 'Precio Gasolina 95 E5', precio_gasolina_95_e5
    from {{ ref('stg_stations') }}

    union all

    select run_id, ideess::text, 'Precio Gasolina 98 E5', precio_gasolina_98_e5
    from {{ ref('stg_stations') }}

)

select
    raw_prices.run_id,
    raw_prices.ideess_text,
    raw_prices.price_field,
    raw_prices.raw_value
from raw_prices
inner join staged_prices
    on raw_prices.run_id = staged_prices.run_id
    and raw_prices.ideess_text = staged_prices.ideess_text
    and raw_prices.price_field = staged_prices.price_field
where raw_prices.raw_value like '%,%'
  and staged_prices.parsed_value is null
