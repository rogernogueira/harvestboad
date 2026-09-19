"""Leva as quatro categorias do enum para a tabela, sem perder o que já foi enviado.

As notificações em produção guardam a categoria como texto (`COLETA`,
`COMUNICACAO`…). Aqui cada um desses códigos vira uma linha de
`NotificationCategory`, com os nomes nos três idiomas que a interface já
traduzia por `t()`, e as notificações existentes passam a apontar para ela.

A migração é reversível: desfazer devolve o código ao campo de texto, que só é
removido na migração seguinte.
"""

from django.db import migrations

# Os mesmos rótulos que estavam em `i18n/locales/*.json`, sob
# `notifications.categories`. Trazê-los para cá é o que faz o catálogo nascer
# já traduzido, em vez de o administrador ter de redigitar os três idiomas.
INICIAIS = [
    ("comunicacao", "COMUNICACAO", "Comunicação", "Comunicación", "Communication"),
    ("novidades", "NOVIDADES", "Novidades", "Novedades", "News"),
    ("coleta", "COLETA", "Coleta", "Recolección", "Harvest"),
    ("validacao", "VALIDACAO", "Validação", "Validación", "Validation"),
]


def semear(apps, schema_editor):
    Category = apps.get_model("notifications", "NotificationCategory")
    Notification = apps.get_model("notifications", "Notification")

    por_codigo = {}
    for slug, codigo, pt, es, en in INICIAIS:
        categoria, _ = Category.objects.get_or_create(
            slug=slug,
            defaults={"name_pt_br": pt, "name_es": es, "name_en": en},
        )
        por_codigo[codigo] = categoria

    for codigo, categoria in por_codigo.items():
        Notification.objects.filter(category=codigo, category_ref__isnull=True).update(
            category_ref=categoria
        )

    # Uma notificação com código fora da lista não deveria existir — o campo
    # tinha `choices` —, mas se existir ela ficaria sem categoria e travaria o
    # `NOT NULL` da migração seguinte. Cai na de comunicação, que é a genérica.
    reserva = por_codigo["COMUNICACAO"]
    Notification.objects.filter(category_ref__isnull=True).update(category_ref=reserva)


def desfazer(apps, schema_editor):
    """Devolve o código ao campo de texto, que ainda existe nesta altura."""
    Notification = apps.get_model("notifications", "Notification")
    por_slug = {slug: codigo for slug, codigo, *_ in INICIAIS}
    for notificacao in Notification.objects.select_related("category_ref"):
        if notificacao.category_ref:
            notificacao.category = por_slug.get(notificacao.category_ref.slug, "COMUNICACAO")
            notificacao.save(update_fields=["category"])


class Migration(migrations.Migration):
    dependencies = [("notifications", "0003_cadastro_de_categorias")]

    operations = [migrations.RunPython(semear, desfazer)]
