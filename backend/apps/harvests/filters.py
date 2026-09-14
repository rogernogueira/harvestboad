"""Vocabulário de filtros das coletas.

Existe para que diagnóstico e registros falem a mesma língua: o usuário clica
na contagem de uma regra no diagnóstico e chega aos registros já filtrados, com
os mesmos parâmetros na URL. Por isso o filtro é montado aqui e devolvido nas
respostas — quem consome não precisa remontá-lo para navegar.

Os nomes de campo são os das facetas que o próprio Harvester publica em
`/public/diagnose/{id}` (`record_is_valid`, `valid_rules`, `invalid_rules`,
`record_is_transformed`).
"""

import hashlib
from dataclasses import dataclass, field

from rest_framework.exceptions import ValidationError

# Filtro neutro: é o valor que o Harvester aceita como "sem filtro".
NO_FILTER = "fq"

_BOOLEANS = {"true": "true", "false": "false", "1": "true", "0": "false"}


def _parse_bool(name: str, raw: str) -> str:
    valor = _BOOLEANS.get(raw.strip().lower())
    if valor is None:
        raise ValidationError({name: "Use true ou false."})
    return valor


def _parse_rule_ids(name: str, raw_values: list[str]) -> list[str]:
    ids: list[str] = []
    for raw in raw_values:
        for pedaco in raw.split(","):
            pedaco = pedaco.strip()
            if not pedaco:
                continue
            if not pedaco.isdigit():
                raise ValidationError({name: f"'{pedaco}' não é um ID de regra válido."})
            if pedaco not in ids:
                ids.append(pedaco)
    return ids


@dataclass(frozen=True)
class RecordFilters:
    """Filtros aplicáveis à listagem de registros de uma coleta."""

    valid: str | None = None
    transformed: str | None = None
    valid_rules: list[str] = field(default_factory=list)
    invalid_rules: list[str] = field(default_factory=list)
    record_id: str | None = None

    @classmethod
    def from_query(cls, params) -> "RecordFilters":
        """Lê os filtros de uma QueryDict, validando cada um.

        Parâmetros desconhecidos são ignorados de propósito: paginação e
        formato de exportação viajam na mesma query string.
        """
        valid = params.get("valid")
        transformed = params.get("transformed")
        return cls(
            valid=_parse_bool("valid", valid) if valid not in (None, "") else None,
            transformed=(
                _parse_bool("transformed", transformed)
                if transformed not in (None, "")
                else None
            ),
            valid_rules=_parse_rule_ids("validRule", params.getlist("validRule")),
            invalid_rules=_parse_rule_ids("invalidRule", params.getlist("invalidRule")),
        )

    def with_record_id(self, record_id: str) -> "RecordFilters":
        return RecordFilters(
            valid=self.valid,
            transformed=self.transformed,
            valid_rules=self.valid_rules,
            invalid_rules=self.invalid_rules,
            record_id=record_id,
        )

    @property
    def is_empty(self) -> bool:
        return not self.clauses

    @property
    def clauses(self) -> list[str]:
        clausulas: list[str] = []
        if self.record_id:
            clausulas.append(f"id:{self.record_id}")
        if self.valid is not None:
            clausulas.append(f"record_is_valid:{self.valid}")
        if self.transformed is not None:
            clausulas.append(f"record_is_transformed:{self.transformed}")
        clausulas += [f"valid_rules:{rule}" for rule in self.valid_rules]
        clausulas += [f"invalid_rules:{rule}" for rule in self.invalid_rules]
        return clausulas

    def to_query(self) -> str:
        """Consulta no formato que o Harvester espera no segmento de caminho.

        O serviço documenta esse segmento como `/fq`; na prática ele aceita uma
        consulta Solr, e o literal "fq" funciona como filtro neutro.
        """
        return " AND ".join(self.clauses) if self.clauses else NO_FILTER

    def as_dict(self) -> dict:
        """Eco dos filtros aplicados, para o cliente preservá-los ao navegar."""
        return {
            "valid": self.valid,
            "transformed": self.transformed,
            "validRule": self.valid_rules,
            "invalidRule": self.invalid_rules,
        }

    def cache_token(self) -> str:
        """Token curto e seguro para compor chaves de cache.

        A consulta em si tem espaços e dois-pontos, que quebram backends como o
        memcached; o hash mantém a chave curta e portátil.
        """
        if self.is_empty:
            return "all"
        return hashlib.sha1(self.to_query().encode("utf-8")).hexdigest()[:16]
