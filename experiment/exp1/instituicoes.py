#!/usr/bin/env python
"""Natureza da instituição (CV01) a partir do nome, com o porquê ao lado.

    .venv/bin/python exp1/instituicoes.py            # escreve data/instituicoes.csv
    .venv/bin/python exp1/instituicoes.py --duvidas  # lista o que o nome não resolve

O campo `institution_type` estava `UNKNOWN` nas 2.183 observações: as origens
trazem o nome da instituição, não a natureza dela. Este módulo deriva uma da
outra, e grava **por qual regra** cada decisão saiu — sem isso a inferência
viraria dado observado, que é a diferença entre uma base auditável e uma base
que parece boa.

A saída é `data/instituicoes.csv`, uma linha por instituição distinta (755 nas
2.183 observações), com `metodo` e `evidencia`:

- `padrao` — o nome diz. "Universidade Federal de Goiás" não deixa dúvida, e a
  `evidencia` é o padrão que casou.
- `excecao` — o nome **mente**, ou cala. A USP não tem "estadual" no nome e é
  estadual; a FURB tem "regional" e é municipal. Cada uma traz a fonte na
  `evidencia`.
- `web` — nem o nome nem o conhecimento de cadastro resolvem, e a natureza foi
  conferida na internet. A `evidencia` é a URL.

A tabela é um arquivo, e não código, de propósito: corrigir uma instituição
não deveria exigir mexer no gerador, e uma linha nova de `web` entra sem
release.

**A ordem das regras importa.** `universidade` sozinho cai em
PRIVATE_UNIVERSITY, porque em regra a universidade pública brasileira carrega
"Federal", "Estadual", "do Estado" ou "Municipal" no nome — as que não
carregam estão nas exceções. Mover essa regra para cima reclassificaria as
públicas todas de uma vez.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

PASTA = Path(__file__).resolve().parent
sys.path.insert(0, str(PASTA))

import base_fontes as bf

TABELA = bf.DADOS / "instituicoes.csv"

# (padrão, código). Lidas em ordem: a primeira que casar decide. As mais
# específicas vêm antes das mais largas — `escola superior da magistratura` é
# órgão do Judiciário e precisa vencer `escola superior`, que é privada.
REGRAS: list[tuple[str, str]] = [
    # --- Judiciário, Executivo, Legislativo, Forças Armadas
    (
        r"escola (superior )?d[ae] magistratura|escola da magistratura",
        "GOVERNMENT_AGENCY",
    ),
    (
        (
            r"\btribunal\b|justica federal|ministerio publico|\bministerio\b|procuradoria|defensoria"
            r"|advocacia-geral|\bsenado\b|camara dos deputados|assembleia legislativa|\bprefeitura\b"
            r"|governo do estado|\bsecretaria\b"
        ),
        "GOVERNMENT_AGENCY",
    ),
    (
        (
            r"exercito|marinha do brasil|forca aerea|corpo de bombeiros|\bpolicia\b"
            r"|escola de guerra naval|escola superior de guerra|instituto militar de engenharia"
            r"|instituto tecnologico de aeronautica|ciencia e tecnologia aeroespacial"
            r"|capacitacao fisica do exercito"
        ),
        "GOVERNMENT_AGENCY",
    ),
    (
        (
            r"banco central|\bbndes\b|agencia nacional|arquivo nacional|\biphan\b|museu historico nacional"
            r"|jardim botanico|fundacao de amparo a pesquisa|fundo nacional|coordenacao de aperfeicoamento"
            r"|escola nacional de administracao publica|instituto chico mendes|instituto mineiro de gestao"
            r"|instituto municipal|instituto paranaense de desenvolvimento|fundacao sistema estadual"
            r"|fundacao joao pinheiro|rede nacional de ensino e pesquisa|recursos minerais"
            r"|empresa de pesquisa agropecuaria|casa de rui barbosa|alexandre de gusmao"
            r"|fundacao joaquim nabuco|cecierj|escola de saude publica|fundacentro"
            r"|instituto de informacao em ciencia e tecnologia|informacao em ciencia e tecnologia"
        ),
        "GOVERNMENT_AGENCY",
    ),
    # --- rede federal de educação profissional
    (
        r"instituto federal|\bcefet\b|centro federal de educacao tecnologica|colegio pedro ii",
        "FEDERAL_INSTITUTE",
    ),
    # --- universidades públicas, que dizem o que são
    (
        r"universidade federal|fundacao universidade federal|universidade tecnologica federal",
        "FEDERAL_UNIVERSITY",
    ),
    (
        r"universidade estadual|universidade do estado|centro paula souza",
        "STATE_UNIVERSITY",
    ),
    (r"universidade municipal", "MUNICIPAL_UNIVERSITY"),
    # --- institutos e centros de pesquisa
    (
        (
            r"\bembrapa\b|\bfiocruz\b|oswaldo cruz|instituto nacional|\binpe\b|\binpa\b|\bipea\b"
            r"|instituto agronomico|butantan|adolfo lutz|instituto biologico|instituto de botanica"
            r"|evandro chagas|lauro de souza lima|museu paraense|laboratorio nacional"
            r"|centro de pesquisa|instituto de pesquisa|instituto de tecnologia|centro de tecnologia"
            r"|engenharia nuclear|tecnologia nuclear|medicina tropical|\bepagri\b|\bepamig\b"
            r"|tecnologia de alimentos|\btecpar\b|analise e planejamento|zoobotanica"
            r"|renato archer|computacao cientifica"
        ),
        "RESEARCH_INSTITUTE",
    ),
    # --- sociedades, associações e conselhos científicos ou profissionais
    (
        (
            r"associacao|asociacion|\bsociedade\b|\bsociety\b|academia|\bconselho\b|colegio brasileiro"
            r"|ordem dos advogados|federacao|confederacao|liga brasileira|sindicato|entomologistas"
            r"|forum brasileiro|rede brasileira|rede de pesquisa|red latinoamericana"
            r"|grupo de estudos|grupo paulista|instituto historico e geografico"
            r"|instituto brasileiro de (direito|ciencias|estudos|relacoes|neuropsicologia|geografia)"
        ),
        "SCIENTIFIC_SOCIETY",
    ),
    # --- editoras
    (r"\beditora\b|\bedicoes\b|editorial|\bpress\b|publicacoes|pro-fono", "PUBLISHER"),
    # --- bibliotecas
    (r"biblioteca|gabinete portugues de leitura", "LIBRARY"),
    # --- ensino superior privado. `universidade` por último, e de propósito:
    # ver o cabeçalho.
    (
        (
            r"pontificia universidade catolica|universidade catolica|centro universitario"
            r"|faculdades?|\bfatec\b|universidade metodista|universidade presbiteriana"
        ),
        "PRIVATE_UNIVERSITY",
    ),
    (r"universidade", "PRIVATE_UNIVERSITY"),
]

# Regras largas, lidas depois de todas as acima. Cobrem o resto do ensino
# superior privado e os nomes que não são de instituição nenhuma.
REGRAS += [
    (
        (
            r"escola superior|escola \w+ de (medicina|saude|teologia|comercio|direito)"
            r"|escola de (medicina|saude|teologia|comercio|direito)|instituto superior"
            r"|centro de ensino|centro educacional|ensino superior|business school|\bacademy\b"
            r"|instituicao de ensino"
        ),
        "PRIVATE_UNIVERSITY",
    ),
    (r"\bhospital\b|cancer center|santa casa", "OTHER"),
    (r"servico nacional de aprendizagem|\bsenac\b|\bsenai\b|\bsesc\b", "OTHER"),
    # Nome de periódico no campo de instituição: o cadastro do Oasisbr aceita
    # texto livre, e em algumas fontes o que veio foi o título da revista.
    (r"^revista |publicacao independente|\(rio de janeiro\. online\)", "OTHER"),
    (
        r"centro de estudos|nucleo de|grupo de|\brede\b|\bfundacao\b|\binstituto\b|\bcentro\b",
        "OTHER",
    ),
]

# O nome mente, ou cala. Cada uma traz a fonte, e o método diz o peso dela:
# `web` foi conferida na internet; `conhecimento` é enquadramento de cadastro
# que não passou por busca; `decisao` é escolha do projeto **contra** uma
# indicação em contrário, e existe para que a linha não seja reaberta como se
# fosse descuido. Os três estão marcados para ninguém tratá-los como igual.
EXCECOES: dict[str, tuple[str, str, str]] = {
    # --- públicas cujo nome não diz que são públicas
    "Universidade de São Paulo (USP)": (
        "STATE_UNIVERSITY",
        "web",
        "autarquia estadual — portaldatransparencia.gov.br/pessoa-juridica/63025530000104",
    ),
    "Instituto Oceanográfico da Universidade de São Paulo (IOUSP)": (
        "STATE_UNIVERSITY",
        "web",
        "unidade da USP — leginf.usp.br/antigo/estatuto/estatuto.html",
    ),
    "Escola Superior de Agricultura Luiz de Queiroz (ESALQ-USP)": (
        "STATE_UNIVERSITY",
        "web",
        "unidade da USP — leginf.usp.br/antigo/estatuto/estatuto.html",
    ),
    "Universidade de Brasília (UnB)": (
        "FEDERAL_UNIVERSITY",
        "web",
        "fundação pública federal — portaldatransparencia.gov.br/pessoa-juridica/00038174000143",
    ),
    "Universidade de Pernambuco (UPE)": (
        "STATE_UNIVERSITY",
        "web",
        "fundação pública estadual — upe.br/transparencia/informacoes-institucionais/",
    ),
    "Universidade Regional do Cariri (URCA)": (
        "STATE_UNIVERSITY",
        "web",
        "autarquia estadual do Ceará — ceara.gov.br/organograma/urca/",
    ),
    "Fundação Universidade do Tocantins (UNITINS)": (
        "STATE_UNIVERSITY",
        "web",
        "autarquia estadual pela Lei 3.124/2016 — pt.wikipedia.org/wiki/Universidade_Estadual_do_Tocantins",
    ),
    "Universidade da Integração Internacional da Lusofonia Afro-Brasileira (UNILAB)": (
        "FEDERAL_UNIVERSITY",
        "web",
        "autarquia federal, Lei 12.289/2010 — planalto.gov.br/ccivil_03/_ato2007-2010/2010/lei/l12289.htm",
    ),
    # --- municipais, que o `universidade` sozinho mandaria para privada
    "Universidade Regional de Blumenau (FURB)": (
        "MUNICIPAL_UNIVERSITY",
        "web",
        "autarquia municipal de Blumenau — furb.br/pt/institucional/a-furb",
    ),
    "Universidade de Taubaté (UNITAU)": (
        "MUNICIPAL_UNIVERSITY",
        "web",
        "autarquia municipal de Taubaté — unitau.br/a-unitau/a-universidade/",
    ),
    # --- comunitária que o histórico municipal poderia confundir
    "Universidade do Vale do Itajaí (UNIVALI)": (
        "PRIVATE_UNIVERSITY",
        "web",
        "fundação privada sem fins lucrativos — mapaosc.ipea.gov.br/detalhar/723293",
    ),
    # --- privadas sem "universidade" nem "faculdade" no nome
    "Centro de Ensino de Brasília (UNICEUB)": (
        "PRIVATE_UNIVERSITY",
        "web",
        "associação privada, centro universitário — mapaosc.ipea.gov.br/detalhar/569066",
    ),
    "Fundação Getulio Vargas (FGV)": (
        "PRIVATE_UNIVERSITY",
        "web",
        "fundação privada sem fins lucrativos — portaldatransparencia.gov.br/pessoa-juridica/33641663000144",
    ),
    "Instituto Superior de Educação Vera Cruz (VeraCruz)": (
        "PRIVATE_UNIVERSITY",
        "web",
        "ensino superior privado — site.veracruz.edu.br/instituto-vera-cruz/nosso-instituto/",
    ),
    # --- o resto que a busca resolveu
    "Scientific Electronic Library Online (SCIELO)": (
        "LIBRARY",
        "web",
        "biblioteca eletrônica, programa FAPESP/BIREME — scielo.br/j/ci/a/XhRCDr87m5VTswK5WtNdYzL/",
    ),
    "Grupo Verde de Agroecologia e Abelhas (GVAA)": (
        "SCIENTIFIC_SOCIETY",
        "web",
        "associação privada sem fins lucrativos — editoraverde.org/portal/gvaa",
    ),
    "Instituto Brasileiro de Ensino e Pesquisa em Fisiologia do Exercício (IBPEFEX)": (
        "RESEARCH_INSTITUTE",
        "web",
        "instituto privado de pesquisa e ensino — ibpefex.com.br/revistas.php",
    ),
    "Instituto Noos": (
        "OTHER",
        "web",
        "organização da sociedade civil sem fins lucrativos — noos.org.br/instituto/",
    ),
    "Cedigma": ("PUBLISHER", "web", "editora acadêmica — cedigma.com.br/sobre-nos/"),
    "Casa de Hiram": (
        "PUBLISHER",
        "web",
        "selo editorial universitário — casadehiram.art/perguntas-frequentes",
    ),
    "Environmental Smoke": (
        "OTHER",
        "web",
        "título de periódico, não instituição — doaj.org/article/f38ad2c5f3bd4705bcf8629f7dff4828",
    ),
    # --- enquadramento de cadastro, sem busca
    # Era ICES pela Portaria MEC 683/2014, mas foi integralmente incorporada
    # pela Ânima Educação, companhia de capital aberto — e ICES exige
    # associação ou fundação sem fins lucrativos. A busca não achou ato que
    # cassasse ou mantivesse a qualificação, então fica como privada, que é o
    # que a natureza jurídica atual sustenta, com a dúvida registrada.
    "Universidade do Sul de Santa Catarina (UNISUL)": (
        "PRIVATE_UNIVERSITY",
        "web",
        (
            "ICES pela Portaria MEC 683/2014, depois incorporada pela Ânima "
            "Educação; qualificação atual não confirmada — "
            "notisul.com.br/unisul-passa-a-ser-integralmente-uma-instituicao-da-anima-educacao/"
        ),
    ),
    # As duas são "Fundação Pública de Direito Privado Municipal" no e-MEC:
    # natureza jurídica pública municipal, apesar de constarem de um recorte
    # de privadas. Vale a mesma regra da FURB e da UNITAU — natureza vence
    # qualificação —, e a UNIFEBE perde por isso a promoção a comunitária.
    "Centro Universitário de Brusque (UNIFEBE)": (
        "MUNICIPAL_UNIVERSITY",
        "web",
        (
            "Fundação Pública de Direito Privado Municipal — e-MEC, "
            "data/dados privadas sem fins lucrativos.csv"
        ),
    ),
    "Faculdade de Medicina do ABC (FMABC)": (
        "MUNICIPAL_UNIVERSITY",
        "web",
        (
            "Fundação Pública de Direito Privado Municipal, hoje Centro "
            "Universitário FMABC — e-MEC, data/dados privadas sem fins lucrativos.csv"
        ),
    ),
    # As duas são "Pública Municipal" no e-MEC — mantidas por município, e não
    # privadas como o nome "Faculdade" fazia supor.
    "Faculdade de Direito de Franca (FDF)": (
        "MUNICIPAL_UNIVERSITY",
        "web",
        "Pública Municipal — e-MEC, data/municipais_mec.csv",
    ),
    "Faculdade de Filosofia, Ciências e Letras de Mandaguari (FAFIMAN)": (
        "MUNICIPAL_UNIVERSITY",
        "web",
        "Pública Municipal — e-MEC, data/municipais_mec.csv",
    ),
    # É instituição de ensino superior privada sem fins lucrativos, não um
    # centro de pesquisa. O "Instituto Nacional" do nome enganou a regra.
    "Instituto Nacional de Telecomunicações (INATEL)": (
        "PRIVATE_UNIVERSITY",
        "web",
        (
            "IES privada sem fins lucrativos — e-MEC, "
            "data/dados privadas sem fins lucrativos.csv"
        ),
    ),
    # É centro universitário, não "instituto" no sentido de centro de
    # pesquisa — mesma armadilha do INATEL, com o nome levando a regra para
    # o lado errado.
    "Instituto de Educação Superior de Brasília (IESB)": (
        "PRIVATE_UNIVERSITY",
        "web",
        (
            "Centro Universitário privado com fins lucrativos — e-MEC, "
            "data/privadas com fins lucrativos.csv"
        ),
    ),
    # As FATECs são do Centro Paula Souza, autarquia estadual paulista. A
    # regra `faculdade` -> privada as pegava todas: é o preço do padrão largo,
    # e é exatamente o que o cruzamento com o e-MEC existe para cobrar.
    "Faculdades de Tecnologia do Estado de São Paulo (Fatec)": (
        "STATE_UNIVERSITY",
        "web",
        "Pública Estadual — e-MEC, data/Publicas estaduais e federais.csv",
    ),
    "Faculdade de Tecnologia de Osasco (FATEC)": (
        "STATE_UNIVERSITY",
        "web",
        "Pública Estadual — e-MEC, data/Publicas estaduais e federais.csv",
    ),
    "Faculdade de Tecnologia da Zona Sul (FATEC Zona Sul)": (
        "STATE_UNIVERSITY",
        "web",
        "Pública Estadual — e-MEC, data/Publicas estaduais e federais.csv",
    ),
    "Faculdade de Medicina de São José do Rio Preto (FAMERP)": (
        "STATE_UNIVERSITY",
        "web",
        "Pública Estadual — e-MEC, data/Publicas estaduais e federais.csv",
    ),
    # "Academia" casava com a regra de sociedade científica. É academia
    # militar: órgão do Exército, pública federal.
    "Academia Militar das Agulhas Negras (AMAN)": (
        "GOVERNMENT_AGENCY",
        "web",
        "Pública Federal — e-MEC, data/Publicas estaduais e federais.csv",
    ),
    # As três mantêm uma IES no e-MEC e continuam `OTHER` **por decisão**: a
    # fonte que está na base é da entidade, não da faculdade que ela mantém.
    # Sem isto elas ficariam `OTHER` por queda no padrão genérico, que é a
    # mesma resposta com outro significado — e a diferença importa, porque
    # decisão registrada não se reabre e default se reabre.
    "Fundação Universitária Vida Cristã (FUNVIC)": (
        "OTHER",
        "decisao",
        "mantém o Centro Universitário FUNVIC no e-MEC; a fonte é da fundação",
    ),
    "Fundação Instituto de Administração (FIA)": (
        "OTHER",
        "decisao",
        "mantém a Faculdade FIA no e-MEC; a fonte é da fundação",
    ),
    "Instituto de Teologia e Pastoral (ITEPA)": (
        "OTHER",
        "decisao",
        (
            "mantém a Faculdade de Teologia e Ciências Humanas no e-MEC; "
            "a fonte é do instituto"
        ),
    ),
    "Escola de Minas": ("FEDERAL_UNIVERSITY", "conhecimento", "unidade da UFOP"),
    "Núcleo de Tecnologias para Educação (UEMAnet)": (
        "STATE_UNIVERSITY",
        "conhecimento",
        "núcleo da UEMA",
    ),
    "Escola Nacional de Saúde Pública Sergio Arouca (ENSP)": (
        "RESEARCH_INSTITUTE",
        "conhecimento",
        "unidade da Fiocruz",
    ),
    "FCCN, serviços digitais da FCT – Fundação para a Ciência e a Tecnologia": (
        "GOVERNMENT_AGENCY",
        "conhecimento",
        "agência pública portuguesa; fonte não brasileira",
    ),
    "ABClima": (
        "SCIENTIFIC_SOCIETY",
        "conhecimento",
        "Associação Brasileira de Climatologia",
    ),
    "Ânima Educação": (
        "PRIVATE_UNIVERSITY",
        "conhecimento",
        "grupo privado de ensino superior",
    ),
    "Kroton Educacional S.A.": (
        "PRIVATE_UNIVERSITY",
        "conhecimento",
        "grupo privado de ensino superior",
    ),
    "A.C.Camargo Cancer Center": (
        "OTHER",
        "conhecimento",
        "hospital e centro de pesquisa oncológica",
    ),
    "Networked Digital Library of Theses and Dissertations (NDLTD)": (
        "SCIENTIFIC_SOCIETY",
        "conhecimento",
        "consórcio internacional de bibliotecas de teses",
    ),
    "Companhia Brasileira de Produção Científica (CBPC)": (
        "PUBLISHER",
        "web",
        "empresa que controla três editoras científicas — cbpciencia.com.br/index.php/quem-somos",
    ),
    "FILOSOFIA CAPITAL (FC)": (
        "PRIVATE_UNIVERSITY",
        "web",
        (
            "é o título do periódico; a instituição responsável é a Universidade Católica de Brasília "
            "— latindex.org/latindex/ficha/28939"
        ),
    ),
    "SBEE": (
        "SCIENTIFIC_SOCIETY",
        "web",
        (
            "sigla de sociedade científica; a busca não distinguiu entre Eletroquímica e "
            "Etnobiologia — bv.fapesp.br/pt/instituicao/3053/"
        ),
    ),
    "Cesumar Diretoria de Pesquisa": (
        "PRIVATE_UNIVERSITY",
        "conhecimento",
        "setor da UniCesumar, instituição privada",
    ),
    "Laborjuris – Serviços Jurídicos em Educação": (
        "OTHER",
        "conhecimento",
        "empresa de serviços, pelo próprio nome",
    ),
    "Matéria (Rio de Janeiro. Online)": (
        "OTHER",
        "conhecimento",
        "título de periódico no campo de instituição",
    ),
    "Revista Brasileira de História da Educação (RBHE)": (
        "OTHER",
        "conhecimento",
        "título de periódico no campo de instituição",
    ),
    "Revista Ibero-Americana de Estratégia (RIAE)": (
        "OTHER",
        "conhecimento",
        "título de periódico no campo de instituição",
    ),
}

# Instituições com qualificação ICES (Lei 12.881/2013), conferidas nas listas
# de Rio Grande do Sul e Santa Catarina. A tabela é de **nome exato** e não de
# padrão: casar "São José" por substring trouxe a Faculdade de Medicina de São
# José do Rio Preto e um centro universitário de Itaperuna, que nada têm a ver
# com a Universidade de São José catarinense.
#
# A lista cobre só os dois estados que a fonte consultada enumera. **Ausência
# daqui não é prova de que a instituição não seja comunitária** — há ICES em
# outros estados que esta tabela não alcança.
#
# A qualificação não mexe mais no `institution_type`: ela vira a coluna
# `Comunitaria`, ao lado da natureza jurídica, porque são eixos diferentes —
# a natureza diz de quem a instituição é, a qualificação diz como ela opera.
ICES = {
    # Públicas com qualificação ICES. Na versão anterior elas ficavam de fora
    # porque `COMMUNITY_UNIVERSITY` competia com a natureza jurídica; agora
    # que a qualificação é campo próprio, os dois eixos convivem — a FURB é
    # autarquia municipal **e** comunitária, e a base diz as duas coisas.
    "Universidade Regional de Blumenau (FURB)",
    "Universidade do Estado de Santa Catarina (UDESC)",
    "Pontifícia Universidade Católica do Rio Grande do Sul (PUCRS)",
    "Universidade de Santa Cruz do Sul (UNISC)",
    "Universidade de Caxias do Sul (UCS)",
    "Universidade de Passo Fundo (UPF)",
    "Universidade La Salle (UNILASALLE)",
    "Centro Universitário La Salle (Unilasalle)",
    "Universidade do Vale do Rio dos Sinos (UNISINOS)",
    "Universidade do Vale do Rio dos Sinos (Unisinos)",
    "Universidade Regional Integrada do Alto Uruguai e das Missões (URI)",
    "Universidade Regional do Noroeste do Estado do Rio Grande do Sul (UNIJUI)",
    "Universidade Feevale (Feevale)",
    "Centro Universitário Univates (UNIVATES)",
    "Universidade Católica de Pelotas (UCPEL)",
    "Universidade do Oeste de Santa Catarina (UNOESC)",
    "Universidade Comunitária da Região de Chapecó (UNOCHAPECÓ)",
    "Universidade Comunitária da Região de Chapecó (Unochapecó)",
    "Universidade do Contestado (UNC)",
    "Universidade do Extremo Sul Catarinense (Unesc)",
    "Universidade do Vale do Itajaí (UNIVALI)",
    "Centro Universitário de Brusque (UNIFEBE)",
    "Universidade da Região de Joinville (UNIVILLE)",
    "Universidade do Planalto Catarinense (UNIPLAC)",
}

FONTE_ICES = (
    "qualificação ICES, Lei 12.881/2013 — "
    "pt.wikipedia.org/wiki/Instituição_comunitária_de_educação_superior"
)

REGRAS = [(re.compile(padrao), codigo) for padrao, codigo in REGRAS]


def chave(texto: object) -> str:
    """O nome em forma comparável: sem acento, sem caixa, sem espaço repetido."""
    if not isinstance(texto, str):
        return ""
    decomposto = unicodedata.normalize("NFKD", texto)
    limpo = "".join(c for c in decomposto if not unicodedata.combining(c))
    return " ".join(limpo.lower().split())


def por_padrao(nome: str) -> tuple[str, str] | None:
    """O código que o nome sustenta, e o padrão que o sustentou."""
    k = chave(nome)
    for padrao, codigo in REGRAS:
        if padrao.search(k):
            return codigo, padrao.pattern[:60]
    return None


def atributos_do_emec(nomes: pd.Series) -> dict[str, object]:
    """`FinsLucrativos` de cada instituição, pelos recortes do e-MEC em `data/`.

    Sem recorte nenhum, devolve vazio — a tabela continua sendo gerada, só
    que sem esse eixo. É o que mantém `instituicoes.py` utilizável numa
    máquina que não tem os CSVs do e-MEC.
    """
    try:
        from verificar_emec import carregar_emec, fins_lucrativos, ufs_das_instituicoes
    except ImportError:
        return {}
    try:
        emec = carregar_emec()
    except SystemExit:
        return {}
    ufs = ufs_das_instituicoes()
    return {
        nome: fins_lucrativos(nome, ufs.get(nome), emec)
        for nome in sorted(set(nomes.dropna()))
    }


def carregar() -> pd.DataFrame:
    """A tabela gravada, que é quem manda: `excecao` e `web` vivem só nela."""
    if not TABELA.is_file():
        return pd.DataFrame(
            columns=["institution_name", "institution_type", "metodo", "evidencia"]
        )
    return pd.read_csv(TABELA, dtype="str").fillna({"evidencia": ""})


def classificar(nomes: pd.Series) -> pd.DataFrame:
    """Uma linha por instituição distinta, com código, método e evidência.

    `EXCECOES` vence o padrão: é apuração, e o padrão é palpite sobre o nome.
    """
    # `FinsLucrativos` sai dos recortes do e-MEC, pelo mesmo casamento que
    # `verificar_emec.py` usa para conferir o tipo. Importar de lá em vez de
    # repetir a regra é o que impede as duas respostas de divergirem.
    fins = atributos_do_emec(nomes)

    linhas = []
    for nome in sorted(set(nomes.dropna())):
        if nome in EXCECOES:
            codigo, metodo, evidencia = EXCECOES[nome]
        elif achado := por_padrao(nome):
            codigo, metodo, evidencia = achado[0], "padrao", achado[1]
        else:
            codigo, metodo, evidencia = "UNKNOWN", "sem-regra", ""
        comunitaria = "S" if nome in ICES else pd.NA
        linhas.append(
            {
                "institution_name": nome,
                "institution_type": codigo,
                "Comunitaria": comunitaria,
                "FinsLucrativos": fins.get(nome, pd.NA),
                "metodo": metodo,
                "evidencia": evidencia,
                "evidencia_comunitaria": FONTE_ICES if nome in ICES else pd.NA,
            }
        )
    return pd.DataFrame(linhas)


def main() -> int:
    argumentos = argparse.ArgumentParser(description=__doc__)
    argumentos.add_argument(
        "--duvidas", action="store_true", help="só lista o que o nome não resolve"
    )
    opcoes = argumentos.parse_args()

    base = bf.ler()
    tabela = classificar(base["institution_name"])
    fontes = base.groupby("institution_name").size().rename("fontes")
    tabela = tabela.join(fontes, on="institution_name").sort_values(
        ["fontes", "institution_name"], ascending=[False, True]
    )

    duvidas = tabela[tabela.metodo == "sem-regra"]
    if opcoes.duvidas:
        print(
            f"{len(duvidas)} instituições sem regra, {duvidas.fontes.sum()} observações\n"
        )
        for nome, n in zip(duvidas.institution_name, duvidas.fontes, strict=True):
            print(f"{n:>3}  {nome}")
        return 0

    TABELA.write_text(tabela.drop(columns="fontes").to_csv(index=False))
    print(f"{TABELA.name}: {len(tabela)} instituições")
    print(
        tabela.groupby("metodo")
        .agg(instituicoes=("metodo", "size"), fontes=("fontes", "sum"))
        .to_string()
    )
    print()
    print(
        tabela.groupby("institution_type")
        .agg(instituicoes=("institution_type", "size"), fontes=("fontes", "sum"))
        .sort_values("fontes", ascending=False)
        .to_string()
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
