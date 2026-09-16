#!/usr/bin/env bash
# Migração única de monitor_integra -> harvestboard.
#
# Os containers e volumes antigos ainda carregam o nome velho. Este script copia
# os dados para os volumes novos e renomeia o banco. Nada é apagado: os volumes
# antigos ficam intactos como fallback.
#
# A ordem importa. O container da API roda `migrate` ao subir, e o DATABASE_URL
# já aponta para o banco `harvestboard`; por isso o ALTER DATABASE acontece
# antes de a API entrar.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 1/5 Backup do banco antes de mexer em qualquer coisa"
docker exec monitor_integra_postgres \
  pg_dump -U monitor -d monitor_integra --clean --if-exists > backup_pre_rename.sql
echo "    $(wc -c < backup_pre_rename.sql) bytes em backup_pre_rename.sql"

echo "==> 2/5 Parando e removendo os containers antigos (volumes preservados)"
docker stop monitor_integra_postgres monitor_integra_redis
docker rm   monitor_integra_postgres monitor_integra_redis

echo "==> 3/5 Copiando os volumes para os nomes novos"
docker volume create harvestboard_postgres_data
docker volume create harvestboard_redis_data
docker run --rm -v monitor_integra_postgres_data:/from -v harvestboard_postgres_data:/to \
  alpine sh -c 'cd /from && cp -a . /to'
docker run --rm -v monitor_integra_redis_data:/from -v harvestboard_redis_data:/to \
  alpine sh -c 'cd /from && cp -a . /to'

echo "==> 4/5 Subindo só o banco para renomeá-lo"
docker compose up -d postgres redis
until docker exec harvestboard_postgres pg_isready -U monitor >/dev/null 2>&1; do sleep 1; done
docker exec harvestboard_postgres \
  psql -U monitor -d postgres -c 'ALTER DATABASE monitor_integra RENAME TO harvestboard;'

echo "==> 5/5 Subindo a API e o nginx"
docker compose up -d
docker compose ps

cat <<'FIM'

Pronto. O nginx está publicado na porta do WEB_PORT (8085 por padrão) — é para
lá que o proxy reverso deve apontar.

Confira antes de liberar o domínio:

  curl -I http://localhost:8085/
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8085/api/v1/schema/

Os volumes antigos continuam intactos. Depois de confirmar que tudo subiu:

  docker volume rm monitor_integra_postgres_data monitor_integra_redis_data

FIM
