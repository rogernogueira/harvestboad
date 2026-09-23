-- Camada analítica do nível de REGISTRO.
--
-- Arquivo separado porque as tabelas que ele consulta são opcionais: o painel
-- abre sem elas, e a aba de Dimensões some. `views.sql` precisa continuar
-- válido sozinho para quem baixa só a Base 1.
--
-- Tudo aqui é sobre a **amostra**: até 200 registros vivos por fonte, seguindo
-- o `resumptionToken` por até 12 páginas, em `oai_dc`. Serve para medir taxa e comparar fontes, não para contar o
-- acervo — quem conta acervo é `size`, do Harvester.

CREATE OR REPLACE VIEW v_registro AS
SELECT
    g.*,
    r.source_name_raw,
    r.institution_name,
    r.platform_analysis_group,
    r.source_type_detail,

    -- Completude: quantos dos quinze elementos do Dublin Core simples o
    -- registro traz. Presença, não qualidade — um dc:type com "Artigo" conta
    -- aqui e reprova em conformidade, que é justamente a distinção útil.
    g.campos_presentes / 15.0 AS taxa_completude,

    -- Conformidade DRIVER/OpenAIRE: os quatro critérios que dependem só do
    -- registro. O perfil tem mais regras, e estas são as verificáveis daqui.
    (g.type_eurepo::INT + g.rights_eurepo::INT
     + g.language_iso::INT + g.date_iso::INT)      AS criterios_conformes,
    (g.type_eurepo AND g.rights_eurepo
     AND g.language_iso AND g.date_iso)            AS conforme_total
FROM records g
LEFT JOIN repositories r USING (source_id);

-- Duplicação **entre** fontes: o mesmo título normalizado aparecendo em mais
-- de uma origem. É o caso do agregador — um artigo que chega pelo periódico e
-- de novo pelo portal que o reúne — e não se enxerga olhando uma fonte só.
--
-- O corte por `title_words` não é detalhe: sem ele a medida devolve
-- "Editorial" em 752 fontes e "Apresentação" em 457, porque toda revista tem
-- um. Repetição de rótulo de seção não é duplicação de documento, e contá-la
-- como tal inventaria um problema que não existe.
CREATE OR REPLACE VIEW v_duplicata AS
SELECT
    title_hash,
    COUNT(*)                        AS ocorrencias,
    COUNT(DISTINCT source_id)       AS fontes,
    min(first_identifier)           AS exemplo_identificador,
    list(DISTINCT source_id)[1:6]   AS amostra_fontes
FROM records
WHERE title_hash <> '' AND NOT deleted AND title_words >= 7
GROUP BY 1
HAVING COUNT(*) > 1;

-- O fenômeno que o corte acima remove, guardado à parte: títulos curtos que se
-- repetem por toda a base. Não é defeito de nenhuma fonte — é como periódico
-- se organiza —, mas explica por que uma deduplicação ingênua por título
-- colapsaria milhares de registros distintos.
CREATE OR REPLACE VIEW v_titulo_generico AS
SELECT
    title_hash,
    COUNT(*)                   AS ocorrencias,
    COUNT(DISTINCT source_id)  AS fontes
FROM records
WHERE title_hash <> '' AND NOT deleted AND title_words < 7
GROUP BY 1
HAVING COUNT(DISTINCT source_id) > 1;

-- Normalização: o que cada campo de vocabulário controlado realmente recebe.
-- A coluna `conforme` marca o valor que o perfil aceita; o resto é a cauda que
-- a padronização teria de resolver.
CREATE OR REPLACE VIEW v_vocabulario AS
SELECT
    field,
    value,
    COUNT(*)                   AS ocorrencias,
    COUNT(DISTINCT source_id)  AS fontes,
    CASE field
        WHEN 'type'     THEN starts_with(value, 'info:eu-repo/semantics/')
        WHEN 'rights'   THEN value LIKE 'info:eu-repo/semantics/%Access'
        WHEN 'language' THEN regexp_matches(value, '^[a-z]{2,3}([_-][A-Za-z]{2,4})?$')
        WHEN 'date'     THEN regexp_matches(value, '^\d{4}(-\d{2}(-\d{2}([T ]\d{2}:\d{2}(:\d{2})?Z?)?)?)?$')
        ELSE NULL
    END AS conforme
FROM record_values
GROUP BY ALL;

-- Uma linha por fonte com as cinco dimensões que o registro responde e que
-- esta amostra operacionaliza — completude, conformidade, duplicação,
-- normalização e consistência —, pendurada no resto da Base 1. A sexta do
-- nível de registro, latência, não é medida aqui nem em lugar nenhum: o
-- datestamp do OAI é data de alteração, não de publicação.
-- É o que a aba Dimensões consulta.
CREATE OR REPLACE VIEW v_dimensao AS
SELECT
    s.source_id,
    s.source_name_raw,
    s.institution_name,
    s.platform_analysis_group,
    s.source_type_detail,
    s.latest_size,
    s.taxa_validade,
    s.days_since_last_harvest,
    s.latest_snapshot_status,
    s.source_status,
    s.subdivision_code,

    m.* EXCLUDE (source_id),
    m.fields_mean / 15.0            AS completude,

    -- Conformidade da fonte: média dos quatro critérios verificáveis.
    (m.type_eurepo_rate + m.rights_eurepo_rate
     + m.language_iso_rate + m.date_iso_rate) / 4.0 AS conformidade,

    m.duplicate_titles / nullif(m.titles_eligible, 0)::DOUBLE AS taxa_duplicacao
FROM v_source s
JOIN record_metrics m USING (source_id);

-- Uma linha por instituição.
--
-- Existe porque a fonte é a unidade errada para qualquer pergunta sobre
-- instituição: são 755 instituições para 2.183 fontes, a USP sozinha tem 87 e
-- 515 têm uma só. Testar por fonte é pseudo-replicação — a USP entraria no
-- teste 87 vezes —, e isso não muda só o p, muda a estimativa.
--
-- As medianas são das fontes da instituição, não dos registros: quem pergunta
-- sobre a instituição quer o comportamento típico dela, não o do maior
-- periódico que ela publica.
--
-- ## A USP é tratada como outlier declarado
--
-- 87 fontes: o dobro da segunda colocada (UnB, 43), trinta vezes a média (2,9)
-- e 4,0% de toda a base. Numa análise por fonte ela entra 87 vezes.
--
-- A regra é **exceção nomeada**, não estatística, e vale dizer por quê: a cerca
-- de Tukey nesta distribuição cai em 3,5 fontes e pegaria 104 instituições —
-- inútil, porque 515 das 755 têm uma fonte só e a cauda é longa por natureza.
-- O que isola a USP é o vão observado entre 87 e 43. Uma regra que marca
-- exatamente uma instituição é uma exceção nomeada com outra roupa, então fica
-- nomeada, visível e auditável aqui.
--
-- **Excluí-la não muda conclusão nenhuma** — H7 controlado vai de 0,0325 para
-- 0,0329, H4 de 0,1874 para 0,1936. Ela é outlier em concentração, não em
-- influência, e a própria qualidade dela é típica (completude 0,80 contra 0,80
-- da base). Por isso a exclusão é recorte de sensibilidade, não de inclusão: o
-- padrão continua sendo analisar com ela.
CREATE OR REPLACE VIEW v_instituicao AS
SELECT
    s.institution_name,
    s.institution_name LIKE '%São Paulo (USP)%'              AS outlier,
    any_value(s.institution_type)                            AS institution_type,
    any_value(s.fins_lucrativos)                             AS fins_lucrativos,
    any_value(s.comunitaria)                                 AS comunitaria,
    mode(s.subdivision_code)                                 AS subdivision_code,
    count(*)                                                 AS fontes,
    count(DISTINCT s.platform_analysis_group)                AS plataformas,
    mode(s.platform_analysis_group)                          AS plataforma_predominante,
    count(DISTINCT s.source_type_detail)                     AS tipos,
    COALESCE(sum(s.latest_size), 0)                          AS registros,
    sum(s.latest_valid_size) / nullif(sum(s.latest_size), 0)::DOUBLE AS validade_agregada,
    median(s.taxa_validade)                                  AS validade_mediana,
    median(s.days_since_last_harvest)                        AS dias_mediana,
    count(*) FILTER (s.crit_erro)                            AS erros,
    count(*) FILTER (s.crit_persistente)                     AS persistentes,
    median(d.completude)                                     AS completude,
    median(d.conformidade)                                   AS conformidade,
    COALESCE(sum(d.records_sampled), 0)                      AS registros_amostrados
FROM v_source s
LEFT JOIN v_dimensao d USING (source_id)
GROUP BY 1;
