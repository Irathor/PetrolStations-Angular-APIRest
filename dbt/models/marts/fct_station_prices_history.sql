-- Histórico de precios por estación, tipo SCD-2: una fila por rango de
-- vigencia de un conjunto de precios. valid_from es la primera ejecución en
-- la que se vio ese conjunto de precios; valid_to es el momento en que
-- empezó a valer el siguiente conjunto (NULL si es el vigente ahora mismo).
--
-- Detecta cambios comparando, ejecución a ejecución, los 5 campos de
-- precio (no cualquier otro campo de la estación: un cambio de horario, por
-- ejemplo, no abre una nueva versión de este histórico de precios).

with prices as (

    select
        ideess,
        precio_gasoleo_a,
        precio_gasoleo_b,
        precio_gasoleo_premium,
        precio_gasolina_95_e5,
        precio_gasolina_98_e5,
        run_id,
        ingested_at
    from {{ ref('stg_stations') }}

),

with_previous as (

    select
        *,
        lag(precio_gasoleo_a) over w as prev_precio_gasoleo_a,
        lag(precio_gasoleo_b) over w as prev_precio_gasoleo_b,
        lag(precio_gasoleo_premium) over w as prev_precio_gasoleo_premium,
        lag(precio_gasolina_95_e5) over w as prev_precio_gasolina_95_e5,
        lag(precio_gasolina_98_e5) over w as prev_precio_gasolina_98_e5
    from prices
    window w as (partition by ideess order by ingested_at)

),

changes_flagged as (

    select
        *,
        case
            when prev_precio_gasoleo_a is distinct from precio_gasoleo_a
              or prev_precio_gasoleo_b is distinct from precio_gasoleo_b
              or prev_precio_gasoleo_premium is distinct from precio_gasoleo_premium
              or prev_precio_gasolina_95_e5 is distinct from precio_gasolina_95_e5
              or prev_precio_gasolina_98_e5 is distinct from precio_gasolina_98_e5
                then 1
            else 0
        end as starts_new_version
    from with_previous

),

versioned as (

    select
        *,
        sum(starts_new_version) over (
            partition by ideess
            order by ingested_at
            rows between unbounded preceding and current row
        ) as version_number
    from changes_flagged

),

collapsed as (

    -- Colapsa ejecuciones consecutivas con el mismo conjunto de precios en
    -- una sola versión, quedándonos con el rango de vigencia observado.
    select
        ideess,
        version_number,
        precio_gasoleo_a,
        precio_gasoleo_b,
        precio_gasoleo_premium,
        precio_gasolina_95_e5,
        precio_gasolina_98_e5,
        min(ingested_at) as valid_from
    from versioned
    group by
        ideess,
        version_number,
        precio_gasoleo_a,
        precio_gasoleo_b,
        precio_gasoleo_premium,
        precio_gasolina_95_e5,
        precio_gasolina_98_e5

)

select
    ideess,
    precio_gasoleo_a,
    precio_gasoleo_b,
    precio_gasoleo_premium,
    precio_gasolina_95_e5,
    precio_gasolina_98_e5,
    valid_from,
    lead(valid_from) over (partition by ideess order by valid_from) as valid_to,
    lead(valid_from) over (partition by ideess order by valid_from) is null as is_current
from collapsed
