-- Camada analítica do HarvestBoard Evidence.
--
-- Executada uma vez, na abertura do painel, contra os Parquet congelados. Tudo
-- que as telas consultam passa por aqui: nenhuma consulta da interface toca a
-- tabela crua, para que uma mudança de definição tenha um lugar só.
--
-- As faixas (banda_*) são recortes de apresentação e vivem no SQL de propósito
-- — se ficassem no JavaScript, o número do painel e o número de quem baixa o
-- dataset e roda a mesma consulta poderiam divergir sem ninguém notar.

CREATE OR REPLACE VIEW v_source AS
SELECT
    s.*,

    -- Taxa só existe onde houve registro coletado. size = 0 não é 0% de
    -- validade, é ausência de medida: tratar como zero criaria 460 fontes
    -- falsamente péssimas no histograma.
    CASE WHEN s.latest_size > 0 THEN s.validity_rate END       AS taxa_validade,
    CASE WHEN s.latest_size > 0 THEN s.transformation_rate END AS taxa_transformacao,

    CASE
        WHEN s.latest_size IS NULL OR s.latest_size = 0 THEN 'sem registros'
        WHEN s.validity_rate >= 1        THEN '100%'
        WHEN s.validity_rate >= 0.95     THEN '95% a 99,9%'
        WHEN s.validity_rate >= 0.80     THEN '80% a 95%'
        WHEN s.validity_rate >= 0.50     THEN '50% a 80%'
        ELSE 'abaixo de 50%'
    END AS banda_validade,

    CASE
        WHEN s.days_since_last_harvest IS NULL THEN 'nunca coletada'
        WHEN s.days_since_last_harvest <=  30  THEN 'até 30 dias'
        WHEN s.days_since_last_harvest <=  90  THEN '31 a 90'
        WHEN s.days_since_last_harvest <= 180  THEN '91 a 180'
        WHEN s.days_since_last_harvest <= 365  THEN '181 a 365'
        WHEN s.days_since_last_harvest <= 730  THEN '1 a 2 anos'
        ELSE 'mais de 2 anos'
    END AS banda_atualidade,

    -- Critérios de atenção. Objetivos e independentes: a tela lista quais
    -- foram atendidos em vez de ordenar por um "pior" que ninguém definiu.
    COALESCE(s.latest_snapshot_status = 'HARVESTING_FINISHED_ERROR', FALSE)      AS crit_erro,
    COALESCE(s.persistent, FALSE)                                                AS crit_persistente,
    COALESCE(s.latest_size = 0 AND COALESCE(s.snapshot_count, 0) > 0, FALSE)     AS crit_vazio,
    COALESCE(s.days_since_last_harvest > 730, FALSE)                             AS crit_parada,
    COALESCE(s.latest_size >= 100 AND s.validity_rate < 0.5, FALSE)              AS crit_baixa_validade,
    COALESCE(s.latest_index_status IN ('FAILED', 'SEM_INDICE'), FALSE)           AS crit_fora_indice,
    COALESCE(s.source_status IN ('INACTIVE', 'TEMPORARILY_UNAVAILABLE'), FALSE)  AS crit_inativa
FROM repository_summary s;

CREATE OR REPLACE VIEW v_attention AS
SELECT
    *,
    (crit_erro::INT + crit_persistente::INT + crit_vazio::INT + crit_parada::INT
     + crit_baixa_validade::INT + crit_fora_indice::INT + crit_inativa::INT) AS n_criterios
FROM v_source;

CREATE OR REPLACE VIEW v_snapshot AS
SELECT
    sn.*,
    date_trunc('month', sn.start_time) AS mes,
    r.platform_analysis_group,
    r.source_type_detail,
    r.institution_name,
    r.source_name_raw
FROM snapshots sn
LEFT JOIN repositories r USING (source_id);

-- Uma linha por célula tipo × plataforma, inclusive as vazias: é a ausência
-- que sustenta H1 e H3, então ela precisa existir como linha, não como buraco.
CREATE OR REPLACE VIEW v_celula AS
SELECT
    t.source_type_detail,
    p.platform_analysis_group,
    COUNT(s.source_id) AS fontes
FROM (SELECT DISTINCT source_type_detail FROM repository_summary) t
CROSS JOIN (SELECT DISTINCT platform_analysis_group FROM repository_summary) p
LEFT JOIN repository_summary s
       ON s.source_type_detail = t.source_type_detail
      AND s.platform_analysis_group = p.platform_analysis_group
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_mes AS
SELECT
    date_trunc('month', start_time)                      AS mes,
    COUNT(*)                                             AS coletas,
    COUNT(DISTINCT source_id)                            AS fontes,
    SUM(is_failure::INT)                                 AS falhas,
    SUM(is_failure::INT) / COUNT(*)::DOUBLE              AS taxa_falha,
    SUM(size)                                            AS registros,
    median(duration_seconds)                             AS duracao_mediana
FROM snapshots
WHERE start_time IS NOT NULL
GROUP BY 1;

-- Sinais efetivamente observados, com o quanto cada um apareceu. O catálogo
-- (platforms) lista o que existe; isto mostra o que pegou.
CREATE OR REPLACE VIEW v_sinal AS
SELECT
    e.signal_name,
    e.probe,
    e.detection_method,
    e.inferred_product,
    p.platform,
    p.weight,
    p.strength,
    COUNT(*)                          AS ocorrencias,
    COUNT(DISTINCT e.source_id)       AS fontes,
    SUM(e.decisive::INT)              AS decisivos
FROM platform_evidence e
LEFT JOIN platforms p USING (signal_name)
GROUP BY ALL;
