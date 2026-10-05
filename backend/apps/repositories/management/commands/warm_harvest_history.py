"""Aquece o histórico global de coletas no cache, na mão.

A série da seção Coleta se mantém **sozinha**: a view renova o agregado em
segundo plano quando ele envelhece (`services.ensure_harvest_history_fresh`),
sem comando nem agendador. Este comando existe para os casos em que não se quer
esperar o primeiro acesso disparar isso — aquecer logo depois de um deploy, ou
forçar uma atualização imediata:

    docker exec harvestboard_api sh -c \\
        "cd /app && python manage.py warm_harvest_history"

A varredura percorre o `findByNetworkIdOrdered` fonte a fonte (~42.358 coletas),
o que é lento e só funciona de dentro do `harvestboard_api` — o Harvester não
responde de fora.
"""

import time

from django.core.management.base import BaseCommand

from apps.integrations.harvester import HarvesterError
from apps.repositories.services import build_harvest_history, store_harvest_history


class Command(BaseCommand):
    help = "Varre o histórico de coletas de todas as fontes e cacheia o agregado."

    def handle(self, *args, **options):
        inicio = time.monotonic()
        try:
            agregado = build_harvest_history()
        except HarvesterError as exc:
            self.stderr.write(self.style.ERROR(f"Harvester inacessível: {exc}"))
            return

        store_harvest_history(agregado)

        decorrido = time.monotonic() - inicio
        totais = agregado["totals"]
        self.stdout.write(
            self.style.SUCCESS(
                f"{totais['snapshots']} coletas em {totais['sources']} fontes "
                f"({agregado['unavailableSources']} indisponíveis) em "
                f"{decorrido:.1f}s — {len(agregado['months'])} meses, "
                f"{totais['failures']} falhas."
            )
        )
