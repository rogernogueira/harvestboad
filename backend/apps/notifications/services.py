"""Consultas de notificação, num ponto só.

Reúne o que as views precisam saber: o que cada pessoa enxerga, e quantas
notificações de cada repositório continuam sem leitura.
"""

from django.db.models import Count, Q, QuerySet
from django.utils import timezone

from .models import Notification


def visiveis_para(user) -> QuerySet[Notification]:
    """Caixa de entrada de uma pessoa: o que é dela e o que é dos seus repositórios.

    De propósito **não** usa `User.accessible_repository_ids()`. Aquele contrato
    devolve `None` para o ADMIN no sentido de "sem limite", e é o certo para
    *autorizar leitura* — mas caixa de entrada não é autorização. Com ele, o
    sino do administrador acenderia com a notificação de todo repositório do
    acervo, que não é o que ele pediu para receber.

    Aqui vale o vínculo real: o ADMIN que também gerencia repositórios vê os
    dele; o que não gerencia nenhum vê só os recados diretos. Gestor sem vínculo
    nenhum cai em `__in=[]`, que não casa nada — sem precisar de ramo extra.
    """
    meus_repositorios = user.repository_accesses.values_list(
        "harvester_repository_id", flat=True
    )
    return Notification.objects.filter(
        Q(recipient=user) | Q(harvester_repository_id__in=meus_repositorios)
    )


def do_autor(user) -> QuerySet[Notification]:
    """O que esta pessoa enviou.

    É a base da tela de gestão do administrador, e de propósito não passa por
    `visiveis_para`: quem envia não é destinatário do próprio aviso, então a
    caixa de entrada esconderia justamente o que ele quer acompanhar. O recorte
    por autoria já basta como garantia — ninguém alcança o que outro enviou.
    """
    return Notification.objects.filter(author=user)


def do_repositorio(harvester_repository_id: str) -> QuerySet[Notification]:
    """Notificações de um repositório. Quem pode ver é decidido antes, na view."""
    return Notification.objects.filter(
        harvester_repository_id=str(harvester_repository_id)
    )


def marcar_lida(notificacao_id: int, user) -> bool:
    """Marca como lida, para todos. Devolve se foi esta chamada que marcou.

    É um `UPDATE` condicional, e não um ler-alterar-salvar: dois gestores
    clicando no mesmo item ao mesmo tempo passariam os dois pelo teste
    `read_at is None` e o segundo sobrescreveria o primeiro. Com a condição
    dentro do `WHERE`, o banco decide, e quem chegou antes continua sendo quem
    consta como leitor.

    O retorno serve à auditoria: re-clique em item já lido não gera entrada
    nova na trilha.
    """
    return bool(
        Notification.objects.filter(pk=notificacao_id, read_at__isnull=True).update(
            read_at=timezone.now(), read_by=user
        )
    )


def contar_nao_lidas_por_repositorio() -> dict[str, int]:
    """Não lidas de cada repositório, em uma consulta.

    Sem receber a lista de identificadores da página, ao contrário de
    `_annotate_manager_counts`: o conjunto de não lidas é pequeno por construção
    (a leitura compartilhada zera o item para todo mundo de uma vez), enquanto a
    página pode ter 2.181 repositórios desde que a tela passou a oferecer
    "tudo" — e aí o `IN` custaria mais que a varredura.

    Sem parâmetro de usuário também de propósito: o estado de leitura é
    compartilhado, então a contagem é a mesma para quem quer que pergunte.
    """
    return dict(
        Notification.objects.filter(read_at__isnull=True)
        .exclude(harvester_repository_id="")
        .values_list("harvester_repository_id")
        .annotate(total=Count("id"))
    )


def destinos_do_alcance(scope: str) -> tuple[list[dict], list]:
    """Resolve "todos os gestores" e "todos os repositórios" em destinos concretos.

    **"Todos os repositórios" são os que têm gestor vinculado**, e não os ~2.181
    do acervo. Um aviso para repositório sem ninguém vinculado não tem quem o
    leia: ele nasceria não lido e ficaria assim para sempre, acendendo o
    indicador na tela do administrador sem que houvesse ação possível.

    Importa aqui dentro para não criar dependência de módulo entre as apps no
    carregamento — `repositories` já importa `notifications` para as contagens.
    """
    from django.contrib.auth import get_user_model

    from apps.accounts.models import Profile
    from apps.repositories.models import RepositoryAccess

    if scope == "ALL_MANAGERS":
        gestores = get_user_model().objects.filter(profile=Profile.GESTOR, is_active=True)
        return [], list(gestores)

    if scope == "ALL_REPOSITORIES":
        # Uma linha por repositório, com a sigla de qualquer um dos vínculos —
        # elas são iguais entre os gestores do mesmo repositório.
        vistos: dict[str, str] = {}
        for identificador, sigla in RepositoryAccess.objects.values_list(
            "harvester_repository_id", "acronym"
        ):
            vistos.setdefault(identificador, sigla)
        return (
            [
                {"harvesterRepositoryId": identificador, "acronym": sigla}
                for identificador, sigla in sorted(vistos.items())
            ],
            [],
        )

    return [], []
