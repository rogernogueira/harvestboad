"""Aposenta o campo de texto e promove a chave estrangeira ao nome `category`.

A ordem importa e é o motivo de esta migração ser escrita à mão: o
`makemigrations` propôs remover `category_ref` e converter o varchar no lugar,
o que jogaria fora exatamente os vínculos que a 0004 acabou de preencher.

Aqui o texto sai primeiro, a chave assume o nome livre e só então vira
obrigatória — nesta altura toda linha já tem categoria, garantido pela 0004.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("notifications", "0004_categorias_iniciais")]

    operations = [
        migrations.RemoveField(model_name="notification", name="category"),
        migrations.RenameField(
            model_name="notification", old_name="category_ref", new_name="category"
        ),
        migrations.AlterField(
            model_name="notification",
            name="category",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="notifications",
                to="notifications.notificationcategory",
                verbose_name="categoria",
            ),
        ),
    ]
