-- Réplica en SQL de transform_station() (backend/app/ingestion.py):
-- mismo FIELD_MAP / PRICE_FIELDS, misma normalización de coma decimal
-- española a punto, mismos casts numéricos, y el mismo criterio de
-- descarte (sin IDEESS o sin coordenadas válidas no hay forma útil de
-- mostrar la estación en el mapa).
--
-- Nombres de columna en snake_case minúsculas (convención dbt/Postgres):
-- los nombres mixtos originales de Solr (IDEESS, Precio_Gasoleo_A...)
-- obligarían a citar cada identificador en cada test/consulta (Postgres
-- pliega a minúsculas cualquier identificador sin comillas). El remapeo de
-- vuelta a los nombres que espera Solr es responsabilidad del loader que
-- construya EPIC-2 al hacer el cutover, igual que hoy FIELD_MAP traduce los
-- nombres de la API del Gobierno.
--
-- Una fila de salida por fila de entrada (una fila por estación por
-- ejecución de ingesta) — la deduplicación a "última foto" ocurre en
-- marts.stations_current, no aquí, para no perder el histórico que
-- necesita marts.fct_station_prices_history.

with source as (

    select * from {{ source('raw', 'raw_stations') }}

),

casted as (

    select
        run_id,
        ingested_at,

        nullif(trim(payload ->> 'IDEESS'), '')::integer as ideess,
        nullif(trim(payload ->> 'IDMunicipio'), '')::integer as id_municipio,
        nullif(trim(payload ->> 'IDProvincia'), '')::integer as id_provincia,
        nullif(trim(payload ->> 'IDCCAA'), '')::integer as id_ccaa,

        nullif(replace(trim(payload ->> 'Latitud'), ',', '.'), '')::numeric as latitud,
        nullif(replace(trim(payload ->> 'Longitud (WGS84)'), ',', '.'), '')::numeric as longitud,

        nullif(trim(payload ->> 'Rótulo'), '') as estacion,
        nullif(trim(payload ->> 'Provincia'), '') as provincia,
        nullif(trim(payload ->> 'Municipio'), '') as municipio,
        nullif(trim(payload ->> 'Localidad'), '') as localidad,
        nullif(trim(payload ->> 'Dirección'), '') as direccion,
        nullif(trim(payload ->> 'Horario'), '') as horario,
        nullif(trim(payload ->> 'Margen'), '') as margen,
        nullif(trim(payload ->> 'Remisión'), '') as remision,
        nullif(trim(payload ->> 'C.P.'), '') as cp,
        nullif(trim(payload ->> 'Tipo Venta'), '') as tipo_venta,

        nullif(replace(trim(payload ->> '% BioEtanol'), ',', '.'), '')::numeric as bioetanol,
        nullif(replace(trim(payload ->> '% Éster metílico'), ',', '.'), '')::numeric as ester_metilico,

        nullif(replace(trim(payload ->> 'Precio Gasoleo A'), ',', '.'), '')::numeric as precio_gasoleo_a,
        nullif(replace(trim(payload ->> 'Precio Gasoleo B'), ',', '.'), '')::numeric as precio_gasoleo_b,
        nullif(replace(trim(payload ->> 'Precio Gasoleo Premium'), ',', '.'), '')::numeric as precio_gasoleo_premium,
        nullif(replace(trim(payload ->> 'Precio Gasolina 95 E5'), ',', '.'), '')::numeric as precio_gasolina_95_e5,
        nullif(replace(trim(payload ->> 'Precio Gasolina 98 E5'), ',', '.'), '')::numeric as precio_gasolina_98_e5

    from source

)

select *
from casted
-- Mismo criterio que transform_station(): sin IDEESS o sin coordenadas
-- válidas, la fila se descarta (no llega a Solr hoy, no debe llegar a los
-- marts tampoco).
where ideess is not null
  and latitud is not null
  and longitud is not null
