#!/usr/bin/env python
"""Dica didática de cada coluna de cada tabela do dataset congelado.

Importado por `congelar.py`, que grava `metadata/hints.json`.

A dica não repete o nome do campo em português — isso não ensina nada. Ela diz
**o que o número é** e, onde existe, **como ele engana**. Metade destas colunas
tem uma armadilha: `size` é resultado da coleta e não tamanho do acervo,
`deleted` quer dizer coisas diferentes em duas tabelas, `validity_rate` não
existe quando não houve registro. É isso que a dica precisa carregar.
"""

from __future__ import annotations

# Coluna -> dica. Vale para toda tabela em que o nome apareça, salvo override.
DICAS: dict[str, str] = {
    # ---------------------------------------------------------- identidade
    "source_id": "Identificador da fonte no Harvester. É a chave que liga todas as tabelas.",
    "oasisbr_source_id": "Identificador da mesma fonte no portal Oasisbr, quando difere do Harvester.",
    "source_name_raw": "Nome da fonte exatamente como o cadastro informa, sem limpeza.",
    "source_name_normalized": "O mesmo nome sem acento, pontuação nem caixa — serve para casar duplicatas, não para exibir.",
    "institution_name": "Instituição responsável. 755 instituições para 2.183 fontes: a USP sozinha tem 87.",
    "institution_acronym": "Sigla da instituição, quando o nome a traz entre parênteses.",
    "institution_type": "Natureza jurídica da instituição (CV01). Inferida por nós do nome e conferida contra o e-MEC — não vem do cadastro.",
    "fins_lucrativos": "S/N para instituição privada com fins lucrativos. Vazio onde a distinção não se aplica.",
    "comunitaria": "S/N para instituição comunitária, categoria do e-MEC que convive com privada sem fins lucrativos.",
    "country_code": "País em ISO 3166-1 alfa-2. Praticamente tudo é BR; o que não é são agregadores estrangeiros.",
    "subdivision_code": "Unidade federativa em ISO 3166-2, como BR-SP. Vem do cadastro, não do endereço do servidor.",
    "city": "Município informado no cadastro do Harvester.",
    "issn": "ISSN do periódico, quando a fonte é revista e o cadastro o traz.",
    # ---------------------------------------------------------- endereços
    "source_url": "Endereço do portal que um humano visita. Não é por onde a coleta passa.",
    "harvest_endpoint_url": "Endereço OAI-PMH por onde a coleta realmente acontece. 212 fontes apontam para o old.scielo.br, desativado.",
    # ------------------------------------------------------- classificação
    "source_status": "Situação cadastral declarada: ACTIVE, INACTIVE, TEMPORARILY_UNAVAILABLE ou UNKNOWN. É declaração, não teste de conectividade.",
    "source_type_macro": "Tipo da fonte em duas categorias amplas — periódico ou repositório.",
    "source_type_detail": "Tipo detalhado (CV04): revista científica, repositório institucional, biblioteca de teses e mais seis. Quase determina a plataforma.",
    "platform_name_raw": "Software como o cadastro o declara, em texto livre. Costuma divergir do que a detecção encontra.",
    "platform_product": "Produto identificado pelas sondas (CV06): OJS, DSPACE, DATAVERSE, EPRINTS e outros. UNKNOWN é desfecho legítimo.",
    "platform_analysis_group": "O produto agrupado para análise. Reúne variantes do mesmo software numa categoria só.",
    "platform_version": "Versão do software, quando o Identify ou o meta generator a expõem.",
    "platform_detection_method": "Como a plataforma foi identificada (CV07): meta generator do HTML, resposta do Identify, padrão de URL, API da plataforma.",
    "platform_confidence": "Força da evidência (CV08), não o escore. Assinatura fecha em CONFIRMED; só um caminho de URL para em MEDIUM.",
    # ------------------------------------------------------------- OAI-PMH
    "harvest_protocol": "Protocolo de coleta. Tudo nesta base é OAI-PMH.",
    "harvest_scope": "Se a coleta pega a fonte inteira ou apenas um conjunto (set) dela.",
    "oai_protocol_version": "Versão do OAI-PMH que a fonte declara no Identify. Todas declaram 2.0.",
    "oai_repository_name": "Nome que a própria fonte dá a si mesma no Identify. Compare com source_name_raw: divergir é comum.",
    "oai_earliest_datestamp": "Data do registro mais antigo que a fonte declara ter. Indica a profundidade do acervo, não quando ela entrou no Oasisbr.",
    "oai_deleted_record_policy": "Como a fonte trata exclusões: persistent, transient ou no. Quem responde 'no' nunca avisa que apagou algo.",
    "oai_granularity": "Precisão das datas que a fonte aceita em filtros — dia ou segundo.",
    "harvest_metadata_prefix": "Formato pedido na coleta: oai_dc em 2.045 fontes, xoai em 114, e mais seis.",
    "metadata_profile": "O perfil normalizado do formato acima. É a única variável de processamento que varia com a plataforma fixa.",
    "metadata_store_schema": "Esquema em que o Harvester guarda o metadado depois de transformá-lo.",
    "identify_sha256": "SHA-256 da resposta crua do Identify. Prova que os campos oai_* vieram daquele XML e não de interpretação nossa.",
    "schedule_cron": "Expressão cron do agendamento. Todas as 2.183 fontes têm a mesma: 29 de fevereiro, que dispara uma vez a cada quatro anos.",
    "published": "Se a fonte está publicada no portal, segundo o cadastro do Harvester.",
    # ---------------------------------------------------------- snapshots
    "snapshot_id": "Identificador de uma coleta específica no Harvester.",
    "ordem": "Posição da coleta na série da fonte, 0 sendo a mais recente. Existe para nenhuma consulta depender da ordem das linhas.",
    "status": "Desfecho da coleta: VALID, HARVESTING_FINISHED_ERROR, HARVESTING e outros.",
    "index_status": "Se a coleta chegou ao índice de busca. UNKNOWN em 574 fontes é ausência de informação, não falha.",
    "start_time": "Quando a coleta começou.",
    "end_time": "Quando a coleta terminou.",
    "duration_seconds": "Duração da coleta. Mediana de 47 segundos.",
    "size": "Registros que a coleta trouxe. **Não é o tamanho do acervo**: é o resultado da coleta, e uma que falhou reporta zero.",
    "valid_size": "Quantos daqueles registros passaram no perfil DRIVER/OpenAIRE.",
    "transformed_size": "Quantos foram convertidos para o formato do índice. Pode superar valid_size: validação e transformação são etapas paralelas, não em série.",
    "is_failure": "Verdadeiro quando o status é HARVESTING_FINISHED_ERROR. Atalho para as análises de estabilidade.",
    "validity_rate": "valid_size ÷ size. **Nulo quando size é zero** — ausência de registro não é zero por cento de validade.",
    # ----------------------------------------------------- métricas de coleta
    "snapshot_count": "Quantas coletas a fonte já teve. Mediana 9, máximo 266.",
    "failure_count": "Quantas dessas terminaram em erro.",
    "failure_rate": "failure_count ÷ snapshot_count.",
    "current_failure_streak": "Falhas seguidas contando da coleta mais recente para trás. Mede quebra em curso.",
    "max_failure_streak": "A maior sequência de falhas seguidas em toda a série. Mede instabilidade crônica.",
    "never_failed": "Verdadeiro para as 1.027 fontes que nunca falharam.",
    "always_failed": "Verdadeiro para as 61 que falharam em toda coleta já tentada.",
    "persistent": "Falha em série de um modo que o acaso não produz: três seguidas, ou metade das coletas num histórico de pelo menos quatro. São 180 fontes.",
    "first_harvest": "Primeira coleta registrada. A série da base começa em 2017-07-19.",
    "last_harvest": "Coleta mais recente registrada.",
    "latest_snapshot_id": "Identificador da última coleta — a que alimenta todos os números do painel.",
    "latest_snapshot_status": "Desfecho da última coleta.",
    "latest_index_status": "Situação da última coleta no índice.",
    "latest_snapshot_date": "Data da última coleta.",
    "latest_size": "Registros trazidos na última coleta.",
    "latest_valid_size": "Registros válidos na última coleta.",
    "latest_transformed_size": "Registros transformados na última coleta.",
    "days_since_last_harvest": "Dias entre a última coleta e 2026-09-20, a data de referência do dataset. Mediana de 254.",
    "transformation_rate": "transformed_size ÷ size na última coleta. Mediana de 100% em toda plataforma.",
    # --------------------------------------------------------- plataformas
    "signal_name": "Nome do sinal de detecção, como html-generator-ojs ou identify-dspace.",
    "probe": "De onde o sinal veio: html, identify, sets, rota, api, formatos ou cadastro.",
    "platform": "Plataforma que este sinal indica quando aparece.",
    "weight": "Peso do sinal. **Só ordena candidatas** quando mais de uma plataforma pontua — não decide a confiança.",
    "strength": "Força do sinal: assinatura, caracteristica ou indireta. É ela, e não o peso, que determina platform_confidence.",
    "detection_method": "Método correspondente no vocabulário CV07.",
    # ----------------------------------------------------------- evidência
    "classification_evidence_id": "Identificador da linha de evidência. Uma fonte tem várias.",
    "source_observation_id": "Liga a evidência à observação da fonte na base original.",
    "signal_value_raw": "O texto observado que disparou o sinal, como veio da origem.",
    "signal_strength": "Força deste sinal nesta observação.",
    "signal_weight": "Peso deste sinal nesta observação.",
    "inferred_product": "Produto que este sinal isolado sugere. A decisão final combina todos.",
    "decisive": "Verdadeiro quando este sinal pertence à plataforma que venceu a classificação.",
    "notes": "Observação em texto livre sobre a classificação, quando houve decisão manual.",
    # ------------------------------------------------------------ registros
    "oai_identifier": "Chave do registro no protocolo OAI, como oai:ojs.pkp.sfu.ca:article/23. **Não confundir** com dc:identifier, que é a URL do documento.",
    "datestamp": "Data da última alteração do registro no repositório. **Não é a data de publicação** — muda a cada correção de metadado.",
    "datestamp_granularity": "Se o datestamp veio com hora (datetime) ou só com dia (date).",
    "deleted": "Registro marcado como excluído no cabeçalho OAI. Conta para latência e duplicação, não para completude.",
    "n_sets": "Em quantos conjuntos (sets) o registro está declarado.",
    "has_driver_set": "Se o registro declara o set driver, que sinaliza adesão ao perfil.",
    "campos_presentes": "Quantos dos 15 elementos Dublin Core o registro traz. É o numerador da completude.",
    "n_fora_esquema": "Elementos que vieram no oai_dc e não pertencem ao Dublin Core simples. Achado de conformidade.",
    "title_hash": "SHA-1 dos primeiros 16 caracteres do título normalizado. Permite achar o mesmo documento em duas fontes sem carregar o texto.",
    "title_words": "Palavras no título normalizado. **O corte em sete separa documento de rótulo de seção** — sem ele, 'Editorial' aparece em 578 revistas e vira falsa duplicata.",
    "first_identifier": "O primeiro dc:identifier do registro, em geral a URL do documento.",
    "type_eurepo": "Se algum dc:type usa o vocabulário info:eu-repo/semantics/, que o perfil DRIVER exige.",
    "rights_eurepo": "Se algum dc:rights traz o termo de nível de acesso info:eu-repo/semantics/*Access. Só 598 de 112.777 valores trazem.",
    "language_iso": "Se todos os dc:language seguem um código ISO 639.",
    "date_iso": "Se todos os dc:date seguem o formato ISO 8601.",
    "field": "Qual elemento Dublin Core este valor preenche.",
    "ordinal": "Posição do valor quando o mesmo elemento se repete no registro.",
    "value": "O valor como veio da origem, truncado em 200 caracteres.",
    # --------------------------------------------- métricas de registro
    "records_sampled": "Registros amostrados desta fonte. Uma página de até 100, não o acervo.",
    "records_deleted": "Quantos deles estavam marcados como excluídos.",
    "fields_mean": "Média de elementos Dublin Core por registro, de 0 a 15.",
    "type_eurepo_rate": "Fração dos registros com dc:type no vocabulário eu-repo.",
    "rights_eurepo_rate": "Fração com dc:rights no vocabulário eu-repo. Mediana praticamente zero em toda a base.",
    "language_iso_rate": "Fração com dc:language em ISO 639.",
    "date_iso_rate": "Fração com dc:date em ISO 8601.",
    "driver_set_rate": "Fração dos registros que declaram o set driver.",
    "off_schema_records": "Registros com ao menos um elemento fora do Dublin Core simples.",
    "titles_eligible": "Registros vivos com título de sete palavras ou mais — o denominador da taxa de duplicação. Registro excluído não tem título e não entra.",
    "duplicate_titles": "Títulos longos repetidos dentro da própria fonte. Só conta título com sete palavras ou mais.",
    "section_titles": "Registros cujo título é curto demais para ser documento — 'Editorial', 'Sumário', 'Expediente'.",
}

# Onde o mesmo nome significa coisas diferentes, a tabela manda.
POR_TABELA: dict[tuple[str, str], str] = {
    ("snapshots", "deleted"): (
        "Coleta expurgada do Harvester. **Sentido diferente do `deleted` em `records`**, "
        "que marca registro excluído pela origem."
    ),
    ("snapshots", "validity_rate"): "valid_size ÷ size **desta coleta**. Nulo quando size é zero.",
    ("harvest_metrics", "validity_rate"): (
        "valid_size ÷ size **da última coleta**, não a média da série. Nulo quando não houve registro."
    ),
    ("platform_evidence", "probe"): "Sonda que produziu esta evidência específica.",
    ("platform_evidence", "signal_name"): "Sinal que esta linha de evidência registra.",
    ("platform_evidence", "detection_method"): "Método correspondente a este sinal observado.",
    ("record_values", "oai_identifier"): "Registro ao qual este valor pertence.",
    # ------------------------------------------------------ record_harvest
    ("record_harvest", "requested_url"): "Endereço OAI-PMH efetivamente pedido na coleta de 2026-09-22. Vazio nas 5 fontes sem endpoint.",
    ("record_harvest", "endpoint_host"): "Servidor do endereço pedido. É por ele que o disjuntor conta falhas, não por fonte.",
    ("record_harvest", "outcome"): "Desfecho cru do ListRecords: ok, rede, xml-invalido, disjuntor, http-<código>, oai-<erro>, vazio, so-excluidos ou sem-endpoint.",
    ("record_harvest", "outcome_detail"): "Complemento do desfecho — o tipo de erro de rede ou o Content-Type que veio no lugar do XML. Vazio quando não há o que acrescentar.",
    ("record_harvest", "breaker_cause"): "Só no desfecho disjuntor: a falha repetida no host que fez a coleta parar de pedir. A fonte em si não foi consultada.",
    ("record_harvest", "reaction"): "O desfecho agrupado em reação legível. agregador-desativado vem antes de tudo: a SciELO cai em três desfechos com uma causa só.",
    ("record_harvest", "attempts"): "Tentativas feitas. Repetição só em falha de transporte; zero no disjuntor e na fonte sem endpoint.",
    ("record_harvest", "tls_verified"): "Se o certificado foi verificado. false quer dizer que a coleta desistiu da verificação no host depois de erro de TLS.",
    ("record_harvest", "browser_agent"): "Se a resposta veio com agente de navegador, depois de um 403 com o agente honesto. 403 que cede a isso é WAF, não política do acervo.",
    ("record_harvest", "pages"): "Páginas de ListRecords seguidas pelo resumptionToken, com teto de 12. Vazio onde nenhuma página chegou.",
    ("record_harvest", "live_records"): "Registros não excluídos juntados. A meta era 200; abaixo disso, o acervo acabou ou o teto de páginas bateu.",
    ("record_harvest", "records_harvested"): "Registros recebidos, excluídos inclusive. Nas fontes ok é o records_sampled de record_metrics.",
    ("record_harvest", "has_more"): "Se o provedor ainda oferecia resumptionToken quando a coleta parou. true é amostra truncada, não acervo pequeno.",
    ("record_harvest", "datestamp_min"): "Datestamp mais antigo da amostra. É data de alteração do registro, não de publicação.",
    ("record_harvest", "datestamp_max"): "Datestamp mais recente da amostra. Mesma ressalva: muda a cada correção de metadado.",
    # ------------------------------------------------------ metadata_rules
    ("metadata_rules", "rule_id"): "Número da regra no validador OpenAIRE que serviu de modelo: 103 a 119, sem 111 e 113. É a chave que liga a record_metadata.",
    ("metadata_rules", "rule_name"): "Nome da regra como o validador a exibe, inclusive o \"Creador\" em espanhol.",
    ("metadata_rules", "description"): "O que a regra verifica, em uma frase.",
    ("metadata_rules", "required"): "Se a regra é obrigatória no perfil. Regra opcional também atende ou viola; o peso é que muda.",
    ("metadata_rules", "quantifier"): "ONE_OR_MORE basta uma ocorrência válida; ONE_ONLY exige exatamente uma — duas versões ou dois níveis de acesso válidos violam.",
    ("metadata_rules", "oai_dc_element"): "Elemento de oai_dc efetivamente lido. Nas regras aproximadas não é o campo que o validador lê.",
    ("metadata_rules", "fidelity"): "exata, aproximada ou nao-verificavel: o quanto a regra alcança em oai_dc, onde os campos qualificados do DSpace colapsam.",
    ("metadata_rules", "fidelity_note"): "Por que a regra não é exata. Vazio nas exatas.",
    # ----------------------------------------------------- record_metadata
    ("record_metadata", "oai_identifier"): "Registro avaliado. Com source_id e rule_id forma a chave: 15 linhas por registro vivo.",
    ("record_metadata", "rule_id"): "A regra aplicada; nome, obrigatoriedade e quantificador estão em metadata_rules.",
    ("record_metadata", "applicable"): "false quando a condição da regra não vale para o registro — data de liberação sem embargo, orientador em quem não é TCC, tese ou dissertação. Aí o status é atende, como no validador.",
    ("record_metadata", "status"): "atende, viola ou nao-verificavel. Só a 119 (Resumo) é nao-verificavel, em todos os registros: o campo não existe em oai_dc.",
    ("record_metadata", "occurrences"): "Quantos valores o elemento lido tem no registro, válidos ou não. Zero é não preenchido.",
    ("record_metadata", "valid_occurrences"): "Quantos desses valores passam na regra. Na ONE_ONLY o registro só atende com exatamente 1. Nulo quando a regra não se aplica.",
    # ---------------------------------------------- record_metadata_values
    ("record_metadata_values", "oai_identifier"): "Registro ao qual o valor pertence. Com source_id e rule_id liga à linha de record_metadata.",
    ("record_metadata_values", "rule_id"): "A regra que leu este valor. dc:type aparece em três regras (105, 106, 118) e dc:date em duas: o mesmo valor, um veredito por regra.",
    ("record_metadata_values", "ordinal"): "Posição do valor no elemento, a partir de 0, na ordem em que o provedor o serviu.",
    ("record_metadata_values", "value"): "O valor, sem espaço nas pontas, cortado em 100 caracteres. value_length diz se houve corte.",
    ("record_metadata_values", "value_length"): "Comprimento do valor antes do corte. Maior que 100 é valor truncado aqui — e, fora de title, type, rights, language e date, pode ter sido truncado já na coleta, em 500.",
    ("record_metadata_values", "valid"): "Se este valor passa na regra. O registro atende pela contagem dos válidos e pelo quantificador, em record_metadata.",
    ("record_metadata", "invalid_sample"): "O primeiro valor que reprovou, cortado em 80 caracteres. Aparece também em registro que atende: na 106, publishedVersion é versão, não tipo.",
}

# Uma frase por tabela, para a tela de referência.
TABELAS: dict[str, str] = {
    "repositories": "Identidade e classificação de cada fonte. Uma linha por fonte, sem nenhuma métrica.",
    "snapshots": "Histórico completo de coletas. Uma linha por tentativa, da mais recente para a mais antiga.",
    "platforms": "Catálogo dos sinais de detecção: o que cada um indica, com que peso e com que força.",
    "platform_evidence": "Os sinais efetivamente observados em cada fonte. Uma fonte tem várias linhas.",
    "harvest_metrics": "Métricas derivadas por fonte — taxas, sequências de falha e os números da última coleta.",
    "repository_summary": "A junção de repositories com harvest_metrics. Redundante de propósito: poupa cinco JOINs por consulta num motor que roda no navegador.",
    "records": "Amostra de registros, um por linha. Uma página de até 100 por fonte, em oai_dc — serve para medir taxa, não para contar acervo.",
    "record_values": "Os valores dos campos de vocabulário controlado, em formato longo. Só type, language, rights, format e date.",
    "record_metrics": "A amostra de registros agregada por fonte.",
    "record_harvest": "Como cada uma das 2.183 fontes reagiu ao ListRecords de 2026-09-22 — inclusive as que não responderam, que as outras tabelas de registro não veem.",
    "metadata_rules": "As 15 regras de metadado OpenAIRE: obrigatoriedade, quantificador e o quanto cada uma alcança em oai_dc.",
    "record_metadata": "Cada registro vivo da amostra avaliado nas 15 regras OpenAIRE. Uma linha por registro e regra.",
    "record_metadata_values": "Cada valor lido por cada regra, e se passa. É o detalhe do relatório de um registro; grande demais para o navegador baixar inteiro, é lido por intervalo.",
}


def dica(tabela: str, coluna: str) -> str:
    """A dica de uma coluna, com o override da tabela quando existe."""
    return POR_TABELA.get((tabela, coluna)) or DICAS.get(coluna, "")


# Os 15 elementos do Dublin Core simples, com o que cada um carrega. As
# colunas n_<campo> e has_<campo>_rate saem daqui em laço, pelo mesmo motivo
# que congelar.py as gera em laço: escrever trinta dicas à mão convidaria a
# esquecer uma quando o vocabulário mudar.
ELEMENTOS: dict[str, str] = {
    "title": "o título do documento",
    "creator": "quem o escreveu",
    "subject": "palavra-chave ou assunto",
    "description": "o resumo",
    "publisher": "quem publicou",
    "contributor": "colaborador que não é autor principal",
    "date": "a data que a origem associa ao documento",
    "type": "o gênero do documento — artigo, tese, capítulo",
    "format": "o formato do arquivo, como application/pdf",
    "identifier": "o endereço ou DOI do documento",
    "source": "a publicação de onde ele vem, como o fascículo da revista",
    "language": "o idioma",
    "relation": "documento relacionado, em geral o PDF",
    "coverage": "recorte geográfico ou temporal",
    "rights": "licença e nível de acesso",
}

OBRIGATORIOS = ("title", "creator", "date", "type", "identifier")

for _campo, _sentido in ELEMENTOS.items():
    _exigido = (
        " O perfil DRIVER **exige** este elemento."
        if _campo in OBRIGATORIOS
        else " Elemento opcional no perfil."
    )
    DICAS[f"n_{_campo}"] = (
        f"Quantas vezes dc:{_campo} aparece no registro — {_sentido}. Zero significa ausente, "
        f"e mais de um é legítimo.{_exigido}"
    )
    DICAS[f"has_{_campo}_rate"] = (
        f"Fração dos registros da fonte que trazem ao menos um dc:{_campo} — {_sentido}.{_exigido}"
    )
