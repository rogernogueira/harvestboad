from django.conf import settings
from django.db import models


class Notification(models.Model):
    """Aviso do administrador para um repositório ou para um gestor.

    O destino é **um dos dois**, nunca os dois nem nenhum: ou a notificação é de
    um repositório — e aí todos os gestores vinculados a ele a recebem —, ou é
    um recado direto a uma pessoa. A constraint `notification_destino_unico`
    guarda essa regra no banco, porque uma notificação sem destino fica
    invisível para todo mundo e uma com os dois seria contada duas vezes.

    **A leitura é compartilhada**, e não por pessoa: o estado mora aqui, na
    própria notificação, e não num par notificação×usuário. O primeiro gestor
    que ler apaga o aviso para os demais. É o que dispensa uma tabela de
    destinatários — e é também o motivo de marcar como lida exigir um clique
    explícito na tela: abrir o painel não pode limpar o aviso da equipe inteira.

    Consequência de não haver destinatários gravados: um gestor vinculado depois
    passa a ver as notificações antigas do repositório. É o desejado — ele
    assume a caixa de entrada do repositório, não um histórico pessoal.
    """

    class Category(models.TextChoices):
        COMUNICACAO = "COMUNICACAO", "Comunicação"
        NOVIDADES = "NOVIDADES", "Novidades"
        COLETA = "COLETA", "Coleta"
        VALIDACAO = "VALIDACAO", "Validação"

    title = models.CharField("título", max_length=120)
    message = models.TextField("mensagem")
    category = models.CharField("categoria", max_length=16, choices=Category.choices)

    # Destino A: um repositório. Vazio quando o destino é uma pessoa.
    harvester_repository_id = models.CharField(
        "identificador no Harvester",
        max_length=64,
        blank=True,
        db_index=True,
    )
    # Sigla no momento do envio, como em `RepositoryAccess.acronym`: o painel
    # precisa rotular "RIUFT — Coleta" e, sem ela, cada item da lista viraria
    # uma ida ao Harvester. Envelhece se o repositório for renomeado — a mesma
    # dívida já aceita no vínculo.
    acronym = models.CharField("sigla", max_length=32, blank=True)

    # Destino B: uma pessoa. NULL quando o destino é um repositório.
    #
    # `CASCADE`: sem a pessoa, o recado direto não tem mais a quem servir. As de
    # repositório não têm destinatário gravado e sobrevivem à saída de qualquer
    # gestor, o que é o desejado — o aviso é do repositório, não de quem o lia.
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="notifications",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="destinatário",
    )

    # Autor preservado como NULL quando a conta sai, pelo mesmo motivo da
    # trilha de auditoria: o histórico não deve desaparecer junto.
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="notifications_sent",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="autor",
    )
    created_at = models.DateTimeField("criada em", auto_now_add=True, db_index=True)

    read_at = models.DateTimeField("lida em", null=True, blank=True)
    read_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="+",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="lida por",
    )

    class Meta:
        verbose_name = "notificação"
        verbose_name_plural = "notificações"
        # A mais recente no topo: é a ordem da "timeline" que o Padrão Digital
        # descreve para o componente, e a que o painel apresenta.
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(recipient__isnull=True) & ~models.Q(harvester_repository_id="")
                )
                | (models.Q(recipient__isnull=False) & models.Q(harvester_repository_id="")),
                name="notification_destino_unico",
            ),
            models.CheckConstraint(
                # `read_by` sem `read_at` seria um leitor de uma notificação que
                # ninguém leu — estado que a tela não sabe desenhar.
                condition=models.Q(read_at__isnull=False) | models.Q(read_by__isnull=True),
                name="notification_leitura_coerente",
            ),
        ]
        indexes = [
            # Parcial: a agregação que alimenta o indicador das duas telas de
            # repositórios só olha as não lidas, e a leitura compartilhada
            # mantém esse conjunto pequeno.
            models.Index(
                fields=["harvester_repository_id"],
                condition=models.Q(read_at__isnull=True),
                name="notif_repo_nao_lida",
            ),
            models.Index(fields=["recipient", "-created_at"], name="notif_dest_criada"),
        ]

    def __str__(self) -> str:
        destino = self.recipient or self.harvester_repository_id
        return f"{self.get_category_display()} → {destino}: {self.title}"

    @property
    def is_read(self) -> bool:
        return self.read_at is not None
