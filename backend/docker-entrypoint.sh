#!/bin/sh
# Prepara o banco e os estáticos antes de entregar o processo ao gunicorn.
set -e

echo "==> Aplicando migrações"
python manage.py migrate --noinput

# Os estáticos são do Django admin e do Swagger; o nginx os serve a partir do
# volume compartilhado, em /static/.
echo "==> Coletando estáticos"
python manage.py collectstatic --noinput --clear

exec "$@"
