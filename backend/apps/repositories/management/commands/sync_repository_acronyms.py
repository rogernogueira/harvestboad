"""Atualiza as siglas gravadas em RepositoryAccess a partir do Harvester.

A coluna `acronym` é uma cópia feita no momento da associação e envelhece
quando o repositório é renomeado na origem. A API já serve a sigla ao vivo,
mas o valor gravado continua sendo a reserva usada quando o Harvester está
fora — e é o que o Django Admin exibe. Daí este comando, pensado para rodar
periodicamente.
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.integrations.harvester import HarvesterError
from apps.repositories.models import RepositoryAccess
from apps.repositories.services import repository_detail


class Command(BaseCommand):
    help = "Ressincroniza as siglas dos vínculos com os dados do Harvester."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Apenas relata as divergências, sem gravar.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        # Um repositório pode estar vinculado a vários usuários; consultar a
        # origem uma vez por repositório, não uma vez por vínculo.
        repository_ids = sorted(
            set(
                RepositoryAccess.objects.values_list("harvester_repository_id", flat=True)
            )
        )

        atualizados = inalterados = falhas = 0

        for repository_id in repository_ids:
            try:
                detail = repository_detail(repository_id)
            except HarvesterError as exc:
                falhas += 1
                self.stderr.write(
                    self.style.WARNING(f"  {repository_id}: não consultado ({exc})")
                )
                continue

            live = detail.get("acronym")
            if not live:
                falhas += 1
                self.stderr.write(
                    self.style.WARNING(f"  {repository_id}: Harvester não informou sigla")
                )
                continue

            divergentes = RepositoryAccess.objects.filter(
                harvester_repository_id=repository_id
            ).exclude(acronym=live)

            if not divergentes.exists():
                inalterados += 1
                continue

            antigas = sorted(set(divergentes.values_list("acronym", flat=True)))
            quantidade = divergentes.count()
            self.stdout.write(
                f"  {repository_id}: {', '.join(antigas)} → {live} "
                f"({quantidade} vínculo(s))"
            )

            if not dry_run:
                with transaction.atomic():
                    divergentes.update(acronym=live)
            atualizados += 1

        prefixo = "Simulação: " if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(
                f"{prefixo}{atualizados} repositório(s) com sigla divergente, "
                f"{inalterados} já corretos, {falhas} não consultados."
            )
        )
