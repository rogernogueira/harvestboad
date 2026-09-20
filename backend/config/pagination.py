"""Paginação padrão das rotas de modelo.

O DRF pagina com `page`, mas o tamanho da página fica preso ao `PAGE_SIZE` do
settings: sem `page_size_query_param`, `?count=25` é ignorado em silêncio e o
cliente recebe sempre 50 itens. As telas ganharam seletor de itens por página,
então o tamanho precisa vir na requisição.

O nome do parâmetro é **`count`**, e não o `page_size` que o DRF sugere, porque
é o que as rotas que espelham o Harvester já usam (`parse_pagination` em
`apps/harvests/views.py` e a busca de acessos em `apps/repositories/views.py`).
Duas grafias para a mesma ideia obrigariam o frontend a lembrar qual rota fala
qual dialeto.

O teto de 200 é o mesmo de `parse_pagination`, pela mesma razão: é o ponto em
que uma página deixa de ser uma tela e vira um despejo. Acima dele o DRF não
recusa — limita e segue, que é o comportamento certo para uma preferência de
exibição: quem colou `?count=5000` numa URL quer a lista, não um erro.
"""

from rest_framework.pagination import PageNumberPagination


class PaginacaoPadrao(PageNumberPagination):
    page_size_query_param = "count"
    max_page_size = 200
