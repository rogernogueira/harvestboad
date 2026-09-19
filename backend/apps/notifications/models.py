from django.conf import settings
from django.db import models

# Idiomas da interface, na ordem em que o projeto os declara. O pt-BR é a
# reserva: é o único nome obrigatório no cadastro.
IDIOMA_PADRAO = "pt-BR"


class NotificationCategory(models.Model):
    """Categoria de notificação, cadastrada pelo administrador.

    Era um `TextChoices` de quatro valores fixos. Virou tabela para o
    administrador manter o catálogo sem depender de quem mexe no código.

    **O nome vem em três idiomas** porque categoria é texto de interface, não
    dado de origem: ela aparece como selo ao lado do título, e uma tela em
    inglês com "Comunicação" no selo denunciaria a tradução pela metade. Só o
    pt-BR é obrigatório — os outros dois caem nele quando vazios, que é melhor
    do que um selo em branco.

    Não se exclui, desativa-se: as notificações já enviadas continuam
    apontando para a categoria, e apagá-la levaria junto a informação de avisos
    que alguém já leu.
    """

    slug = models.SlugField("código", max_length=32, unique=True)
    name_pt_br = models.CharField("nome (pt-BR)", max_length=48)
    name_es = models.CharField("nome (es)", max_length=48, blank=True)
    name_en = models.CharField("nome (en)", max_length=48, blank=True)
    active = models.BooleanField("ativa", default=True)
    created_at = models.DateTimeField("criada em", auto_now_add=True)

    class Meta:
        verbose_name = "categoria de notificação"
        verbose_name_plural = "categorias de notificação"
        ordering = ["name_pt_br"]

    def __str__(self) -> str:
        return self.name_pt_br

    def name_for(self, idioma: str | None) -> str:
        """Nome no idioma pedido, caindo no pt-BR quando não houver.

        Aceita tanto `es` quanto `es-AR`: o i18next resolve a variante regional
        para o idioma base, e aqui o prefixo basta.
        """
        base = (idioma or IDIOMA_PADRAO).split("-")[0].lower()
        if base == "es":
            return self.name_es or self.name_pt_br
        if base == "en":
            return self.name_en or self.name_pt_br
        return self.name_pt_br


class NotificationTemplate(models.Model):
    """Texto padrão de uma categoria.

    Serve para o administrador não reescrever do zero o aviso que manda toda
    semana: escolhida a categoria, os modelos dela aparecem e preenchem título
    e mensagem, que continuam editáveis antes do envio.

    **Não é multilíngue**, ao contrário do nome da categoria, e de propósito: o
    que ele preenche são o título e a mensagem da notificação, que também não
    são — o administrador escreve um texto só, para os gestores daquele
    repositório.
    """

    category = models.ForeignKey(
        NotificationCategory,
        related_name="templates",
        on_delete=models.CASCADE,
        verbose_name="categoria",
    )
    label = models.CharField("nome do modelo", max_length=60)
    title = models.CharField("título", max_length=120)
    message = models.TextField("mensagem")
    active = models.BooleanField("ativo", default=True)
    created_at = models.DateTimeField("criado em", auto_now_add=True)

    class Meta:
        verbose_name = "texto padrão"
        verbose_name_plural = "textos padrão"
        ordering = ["category__name_pt_br", "label"]
        constraints = [
            models.UniqueConstraint(
                fields=["category", "label"], name="unique_template_por_categoria"
            )
        ]

    def __str__(self) -> str:
        return f"{self.category}: {self.label}"


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

    title = models.CharField("título", max_length=120)
    message = models.TextField("mensagem")
    # `PROTECT`: categoria não se exclui, desativa-se — e o banco garante isso
    # mesmo que alguém tente pelo Django Admin.
    category = models.ForeignKey(
        NotificationCategory,
        related_name="notifications",
        on_delete=models.PROTECT,
        verbose_name="categoria",
    )

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

    # Aviso que não se dispensa de passagem: na tela ele exige um botão de
    # confirmação em vez do clique no corpo do item. O estado continua sendo o
    # mesmo `read_at` — o visto de um gestor vale para todos, como a leitura —,
    # e o que muda é o peso do gesto que o registra.
    requires_acknowledgement = models.BooleanField("exige visto", default=False)

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
        return f"{self.category} → {destino}: {self.title}"

    @property
    def is_read(self) -> bool:
        return self.read_at is not None
