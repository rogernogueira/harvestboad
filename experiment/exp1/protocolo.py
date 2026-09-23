#!/usr/bin/env python
"""Auditoria do experimento contra o checklist de qualidade.

Importado por `analisar.py`, que grava o resultado em `metadata/protocol.json`.

O valor deste arquivo está em dizer **não** quando é não. Um checklist em que
tudo aparece verde não informa nada; os três itens não atendidos abaixo são a
parte útil, e dois deles não têm conserto retroativo.
"""

from __future__ import annotations

# situacao: atendido | parcial | nao
CHECKLIST = [
    {
        "item": "dataset congelado e identificado",
        "situacao": "atendido",
        "evidencia": "HB-EVIDENCE-2026-09-20-v1.0.0, dataset_status FROZEN, em metadata/dataset.json",
    },
    {
        "item": "origem e data de extração registradas",
        "situacao": "atendido",
        "evidencia": "metadata/provenance.json: blocos source e extraction, com git_commit e datas por coleta",
    },
    {
        "item": "critérios de inclusão/exclusão documentados",
        "situacao": "atendido",
        "evidencia": (
            "campos inclusao e exclusao em cada ficha de metadata/hypotheses.json; a regra de "
            "outlier está em sql/views-registros.sql, versionada junto do dataset"
        ),
        "ressalva": (
            "A USP é o único outlier declarado: 87 fontes, o dobro da segunda e 4,0% da base. "
            "É exceção nomeada, não estatística — a cerca de Tukey nesta distribuição cai em 3,5 "
            "fontes e pegaria 104 instituições, porque 515 das 755 têm uma fonte só. Ela sai "
            "apenas como recorte de sensibilidade, nunca da inclusão, e removê-la não muda "
            "conclusão nenhuma: H7 vai de 0,0325 para 0,0329 e H4 de 0,1874 para 0,1936."
        ),
    },
    {
        "item": "vocabulários controlados versionados",
        "situacao": "atendido",
        "evidencia": "metadata/vocabularies.json, 17 vocabulários e 116 termos, com o código e o rótulo de cada um",
    },
    {
        "item": "plataforma validada em amostra manual",
        "situacao": "parcial",
        "evidencia": "validar_sondas.py mediu precisão e ganho por sinal e derrubou dois (cadastro-scielo, html-wordpress)",
        "ressalva": (
            "a validação foi por sinal, contra o cadastro declarado — não houve conferência manual "
            "cega de uma amostra aleatória por um segundo revisor. As 1.705 fontes CONFIRMED vêm de "
            "assinatura (meta generator ou Identify), que é forte; as 408 MEDIUM não foram conferidas "
            "uma a uma."
        ),
    },
    {
        "item": "dados faltantes quantificados",
        "situacao": "atendido",
        "evidencia": "conferir() em base_fontes.py; a aba Coleta mostra vazio por campo e a aba Dimensões a cobertura da amostra",
    },
    {
        "item": "cobertura temporal informada",
        "situacao": "atendido",
        "evidencia": "coletas de 2017-07-19 a 2026-09-20 em 110 meses; campo cobertura_temporal em cada ficha",
    },
    {
        "item": "possíveis confundidores identificados",
        "situacao": "atendido",
        "evidencia": "campo confundidores em cada ficha; em H4 o confundimento com tamanho é medido (rho de Spearman), não suposto",
    },
    {
        "item": "métricas definidas antes da análise",
        "situacao": "nao",
        "evidencia": "não há pré-registro",
        "ressalva": (
            "as métricas foram escolhidas depois de olhar os dados, e isso não tem conserto "
            "retroativo — declarar agora que foram pré-registradas seria datar para trás. O que existe "
            "a partir da v1.0.0 é congelamento: a definição está em analisar.py e em views.sql, e "
            "qualquer mudança nelas muda o hash do pacote. Vale para o que vier depois, não para o que "
            "já foi medido."
        ),
    },
    {
        "item": "análises com IC e tamanho de efeito",
        "situacao": "atendido",
        "evidencia": "epsilon-quadrado e delta de Cliff com IC95 por bootstrap percentílico, 2.000 reamostragens, semente fixa",
        "ressalva": (
            "os números que este experimento reportou antes da v1.0.0 (z = 5,2 em H4, z = 16,6 em H6, "
            "rho = -0,37) vinham de análise feita à mão no console e **não reproduzem**: os critérios de "
            "inclusão eram outros. Valem os desta ficha."
        ),
    },
    {
        "item": "análise de sensibilidade",
        "situacao": "atendido",
        "evidencia": "cinco recortes por hipótese comparável; foi ela que mostrou que o efeito de H4 é carregado só pelo SCIELO",
    },
    {
        "item": "scripts SQL/Python preservados",
        "situacao": "atendido",
        "evidencia": "pipeline em metadata/provenance.json; views.sql e views-registros.sql publicados junto do pacote",
    },
    {
        "item": "SHA-256 dos datasets",
        "situacao": "atendido",
        "evidencia": "metadata/checksums.sha256, uma linha por Parquet; congelar.py regenera byte a byte",
    },
    {
        "item": "resultado reproduzível a partir do pacote",
        "situacao": "parcial",
        "evidencia": (
            "congelar.py e analisar.py reproduzem dataset e fichas a partir dos arquivos de coleta, byte a "
            "byte: semente fixa e ORDER BY explícito em tudo o que alimenta sorteio — sem este, a mesma "
            "semente dava outro IC a cada execução, até 2026-09-23"
        ),
        "ressalva": (
            "reproduzir **a partir do zero** exige refazer a coleta, e ela não é reprodutível por "
            "natureza: as origens mudam, saem do ar e voltam. O que se reproduz é tudo daí para frente. "
            "Os arquivos de coleta em exp1/data/ são o ponto de corte e precisam ser preservados junto."
        ),
    },
]

TRES_CRITERIOS = [
    {
        "nome": "Rastreabilidade",
        "pergunta": "Você consegue chegar do gráfico ao registro original?",
        "situacao": "parcial",
        "texto": (
            "Do gráfico até a instituição e à fonte, sim: toda tela consulta as views sobre os "
            "Parquet, e o perfil "
            "individual mostra a linha inteira mais o histórico de coletas. Do gráfico até o registro, "
            "só na aba Dimensões, e só para os 318.953 da amostra. Falta o elo final — do registro de volta "
            "ao XML que o produziu —, porque as respostas de ListRecords não foram guardadas: seriam "
            "centenas de megabytes. Ficou o SHA-256 de cada resposta, que prova procedência mas não "
            "permite reler o original."
        ),
    },
    {
        "nome": "Reprodutibilidade",
        "pergunta": "Outra pessoa consegue obter o mesmo resultado usando o mesmo pacote?",
        "situacao": "atendido",
        "texto": (
            "Sim, do dataset congelado para a frente. congelar.py devolve os mesmos bytes das mesmas "
            "entradas — verificável por checksums.sha256 —, analisar.py tem semente fixa, e as definições "
            "de faixa, critério e persistência vivem em views.sql, publicado junto. O que não se reproduz "
            "é a coleta: as origens mudam."
        ),
    },
    {
        "nome": "Validade",
        "pergunta": "A diferença observada pode ser atribuída à característica estudada?",
        "situacao": "nao",
        "texto": (
            "Este é o ponto fraco, e é estrutural. Em H1 plataforma e tipo de fonte são a mesma variável; "
            "em H3 a matriz é esparsa demais; em H4 o efeito inteiro vem de um grupo cujo problema é "
            "cadastro, não software; em H5 a variável independente é o resultado da dependente. H2, H6 e "
            "H7 sustentam atribuição — H2 é nulo e H7 tem efeito pequeno, o que é o preço de perguntar "
            "algo que a base consegue responder. H7 mostra a saída: a natureza institucional varia dentro "
            "de plataforma e de tipo de fonte, então o teste roda com os dois fixos. O desenho continua "
            "observacional e nenhum desenho observacional conserta colinearidade perfeita — conserta-se "
            "trocando a variável independente por uma que varie, ou coletando fora do Oasisbr."
        ),
    },
]
