"""Aquece o índice completo de repositórios no cache.

A listagem do painel de administração ordena por percentual de registros
inválidos, o que exige o acervo inteiro — ~40 s e 2,9 MB vindos do Harvester.
Rodar este comando periodicamente faz esse custo ser pago fora da hora do
usuário, em vez de cair sobre a primeira pessoa que abre a tela.
"""

import time

from django.core.management.base import BaseCommand

from apps.integrations.harvester import HarvesterError
from apps.repositories.services import CACHE_PREFIX, full_network_index, invalid_ratio


class Command(BaseCommand):
    help = "Busca e cacheia o índice completo de repositórios do Harvester."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Descarta o índice em cache antes de buscar.",
        )

    def handle(self, *args, **options):
        from django.core.cache import cache

        if options["force"]:
            cache.delete(f"{CACHE_PREFIX}:index")
            self.stdout.write("Índice anterior descartado.")

        inicio = time.monotonic()
        try:
            indice = full_network_index()
        except HarvesterError as exc:
            self.stderr.write(self.style.ERROR(f"Harvester inacessível: {exc}"))
            return

        decorrido = time.monotonic() - inicio
        com_coleta = [linha for linha in indice if invalid_ratio(linha) >= 0]
        problematicos = sum(1 for linha in com_coleta if invalid_ratio(linha) > 0)

        self.stdout.write(
            self.style.SUCCESS(
                f"{len(indice)} repositórios em {decorrido:.1f}s — "
                f"{len(com_coleta)} com coleta, {problematicos} com registros inválidos."
            )
        )
