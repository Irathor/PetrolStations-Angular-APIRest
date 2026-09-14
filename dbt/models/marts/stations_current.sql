-- Última foto de cada estación: mismo shape plano (mismos campos) que hoy
-- consume Solr, un registro por ideess. Nombres de columna en snake_case
-- minúsculas (ver comentario en stg_stations.sql); EPIC-2 remapea a los
-- nombres de campo de Solr al hacer el cutover.

with ranked as (

    select
        *,
        row_number() over (
            partition by ideess
            order by ingested_at desc
        ) as rn
    from {{ ref('stg_stations') }}

)

select
    ideess,
    id_municipio,
    id_provincia,
    id_ccaa,
    latitud,
    longitud,
    estacion,
    provincia,
    municipio,
    localidad,
    direccion,
    horario,
    margen,
    remision,
    cp,
    tipo_venta,
    bioetanol,
    ester_metilico,
    precio_gasoleo_a,
    precio_gasoleo_b,
    precio_gasoleo_premium,
    precio_gasolina_95_e5,
    precio_gasolina_98_e5,
    run_id,
    ingested_at
from ranked
where rn = 1
