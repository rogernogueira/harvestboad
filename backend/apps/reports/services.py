"""Geração das exportações.

As linhas são produzidas em streaming, página a página: uma coleta tem dezenas
de milhares de registros e materializar tudo em memória antes de responder
derrubaria o processo.
"""

import csv
from typing import Iterator

from apps.harvests import services as harvests
from apps.harvests.filters import RecordFilters

PAGE_SIZE = 200

COLUMNS = [
    ("identifier", "identificador"),
    ("id", "id_interno"),
    ("isValid", "valido"),
    ("isTransformed", "transformado"),
    ("networkAcronym", "sigla_repositorio"),
    ("repositoryName", "nome_repositorio"),
    ("institutionName", "instituicao"),
    ("setSpec", "conjunto"),
    ("metadataPrefix", "prefixo_metadados"),
    ("origin", "origem"),
]


class _Echo:
    """Buffer que devolve o que recebe — o writer do csv escreve nele."""

    def write(self, value: str) -> str:
        return value


def iter_records(
    snapshot_id: str,
    filters: RecordFilters | None = None,
    max_rows: int | None = None,
) -> Iterator[dict]:
    """Percorre os registros da coleta respeitando os filtros.

    Não constrói `HarvesterClient`: delega a `harvests.records`, que é o único
    ponto de construção. Assim há um só lugar a substituir nos testes — e
    nenhuma chance de a suíte escapar para a rede real.
    """
    filters = filters or RecordFilters()
    enviados = 0
    page = 1

    while True:
        payload = harvests.records(
            snapshot_id, page=page, count=PAGE_SIZE, filters=filters
        )
        content = payload["results"]
        if not content:
            return

        for record in content:
            yield record
            enviados += 1
            if max_rows is not None and enviados >= max_rows:
                return

        total_pages = payload.get("totalPages") or 0
        if page >= total_pages:
            return
        page += 1


def csv_rows(
    snapshot_id: str,
    filters: RecordFilters | None = None,
    max_rows: int | None = None,
) -> Iterator[str]:
    """Gera o CSV linha a linha, pronto para um StreamingHttpResponse."""
    writer = csv.writer(_Echo())
    yield writer.writerow([titulo for _, titulo in COLUMNS])

    for record in iter_records(snapshot_id, filters, max_rows):
        yield writer.writerow([record.get(campo) for campo, _ in COLUMNS])


def filename(snapshot_id: str, filters: RecordFilters | None = None) -> str:
    """Nome do arquivo, com os filtros embutidos para o usuário se situar."""
    partes = [f"coleta-{snapshot_id}"]
    filters = filters or RecordFilters()
    if filters.valid is not None:
        partes.append("validos" if filters.valid == "true" else "invalidos")
    if filters.transformed is not None:
        partes.append(
            "transformados" if filters.transformed == "true" else "nao-transformados"
        )
    for rule in filters.invalid_rules:
        partes.append(f"regra-{rule}-violada")
    for rule in filters.valid_rules:
        partes.append(f"regra-{rule}-ok")
    return "-".join(partes) + ".csv"
