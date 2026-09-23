/*
 * A ficha de cada dimensão de qualidade, aberta ao clicar na linha dela na aba
 * Dimensões.
 *
 * A ordem dos blocos é deliberada e o terceiro é o que importa: "para que"
 * diz a decisão que a dimensão sustenta. Uma dimensão que não muda nenhuma
 * decisão é só um número a mais na tela — e é por esse bloco que se vê por que
 * latência continua na tabela mesmo sem ser medida.
 *
 * Os números citados são os mesmos das notas da aba e dos comentários de
 * `congelar.py` e `views-registros.sql`. Mudou a definição lá, muda aqui.
 */
export type Ficha = {
  oQue: string
  como: string
  paraQue: string
  exemplo: string
}

export const FICHAS: Record<string, Ficha> = {
  Validação: {
    oQue:
      'A parcela dos registros coletados pelo agregador que passou nas regras de validação dele. Por fonte, é valid_size ÷ size da última coleta.',
    como:
      'Vem do Harvester: cada snapshot traz size (registros coletados) e valid_size (aprovados). A taxa só existe onde size > 0 — coleta vazia é ausência de medida, não 0% de validade. Fica materializada em harvest_metrics.validity_rate.',
    paraQue:
      'Dizer quanto do que a fonte entrega o agregador consegue aproveitar, e com isso priorizar a correção na origem: uma fonte grande com validade baixa é onde o esforço de adequação devolve mais registros ao portal.',
    exemplo:
      'A revista A coletou 1.000 registros e 600 passaram: validade de 60%. A revista B coletou 50 e os 50 passaram: 100%. O contato começa pela A, que deixa 400 registros de fora. É exatamente o critério "baixa validade" do painel: size ≥ 100 e taxa abaixo de 50%.',
  },
  Estabilidade: {
    oQue:
      'Se a fonte se deixa coletar com regularidade ao longo do tempo, medido pelas coletas que terminaram em erro (HARVESTING_FINISHED_ERROR).',
    como:
      'Sobre os 42.358 snapshots do histórico, por fonte: total de falhas, taxa de falha, maior sequência de falhas e sequência atual, contada a partir da coleta mais recente. É persistente quem falha agora há três coletas seguidas, ou quem falha em metade das vezes num histórico de pelo menos quatro.',
    paraQue:
      'Separar o tropeço pontual da fonte quebrada. Uma falha isolada não pede ação; uma sequência pede. É a base da fila de atenção do painel e da hipótese H6.',
    exemplo:
      'Fonte A: seis coletas boas, uma com erro no meio, e as seguintes boas — estável. Fonte B: seis boas e depois as três mais recentes com erro. A taxa de falha da B é de só 33%, mas ela está quebrada agora: sequência atual 3, persistente. Por isso a sequência pesa mais que a taxa.',
  },
  Completude: {
    oQue:
      'Quantos dos 15 elementos do Dublin Core simples o registro traz preenchidos. Por fonte, é a média entre os registros vivos da amostra, dividida por 15.',
    como:
      'Da amostra de ListRecords em oai_dc de 22/09/2026, até 200 registros vivos por fonte. Conta presença, não qualidade do valor, e registro excluído não entra: ele vem só com cabeçalho.',
    paraQue:
      'Mostrar se o registro traz informação suficiente para ser encontrado e citado. Sem dc:creator o artigo existe mas não aparece na busca por autor. A leitura começa pelos cinco elementos que o perfil DRIVER exige — title, creator, date, type e identifier.',
    exemplo:
      'Um registro com title, creator, date, type, identifier e language tem 6 de 15: completude 0,40. Parece baixo, mas está completo no que importa. Se faltasse creator, seria defeito, porque é obrigatório; faltar coverage é escolha editorial legítima.',
  },
  Conformidade: {
    oQue:
      'Se os valores seguem o vocabulário que o perfil DRIVER/OpenAIRE pede. Não basta estar preenchido: tem de ser legível por máquina.',
    como:
      'Quatro critérios verificáveis no próprio registro: dc:type começando por info:eu-repo/semantics/, dc:rights como info:eu-repo/semantics/*Access, dc:language em ISO 639 e dc:date em ISO 8601. Em type e rights basta um valor conformar; em language e date todos precisam. Por fonte, é a média dos quatro.',
    paraQue:
      'Deixar o agregador classificar e filtrar sem interpretar texto livre — é o que permite separar artigo de tese ou mostrar só o que está em acesso aberto. Aponta a correção de configuração que resolve a fonte inteira de uma vez.',
    exemplo:
      'dc:type = "Artigo avaliado pelos Pares" está presente, conta em completude e reprova em conformidade. "info:eu-repo/semantics/article" passa. Ajustar esse mapeamento uma vez no OJS da revista corrige todos os registros dela ao mesmo tempo.',
  },
  Duplicação: {
    oQue: 'O mesmo documento aparecendo mais de uma vez, dentro da mesma fonte ou em fontes diferentes.',
    como:
      'Hash do título normalizado — sem acento, pontuação nem caixa —, só para títulos com sete palavras ou mais. A taxa da fonte é títulos repetidos ÷ títulos elegíveis. Entre fontes, é o mesmo hash chegando por mais de uma origem.',
    paraQue:
      'Evitar que o portal mostre o mesmo artigo duas vezes e infle contagens, e descobrir revista que chega também por um repositório ou agregador. Serve para decidir qual origem é a canônica.',
    exemplo:
      '"Editorial" aparece em 752 revistas e não é duplicata: cada número tem o seu. Daí o corte de sete palavras. Já "Avaliação da qualidade da água em reservatórios do semiárido nordestino" vindo da revista e do repositório da universidade é um artigo só entrando por duas portas.',
  },
  Transformação: {
    oQue: 'A parcela dos registros coletados que o agregador converteu para o formato interno dele.',
    como:
      'transformed_size ÷ size da última coleta, do Harvester. É contagem de volume: diz quantos registros foram convertidos, não o que mudou em cada um.',
    paraQue:
      'Acompanhar a etapa entre validar e indexar: registro válido e não transformado não chega ao portal. Quando falha, aponta gargalo no agregador, não na fonte.',
    exemplo:
      '1.000 coletados, 900 válidos e 900 transformados: pipeline íntegro. 900 válidos e 0 transformados: a fonte fez a parte dela, e a conversa é com quem opera o Harvester, não com a revista.',
  },
  Perda: {
    oQue: 'Registros que entraram na coleta e não saíram como válidos: size − valid_size.',
    como:
      'Do Harvester, por snapshot. Só o lado da origem é observável; o que efetivamente chega ao portal final não está nestes dados.',
    paraQue:
      'Traduzir a validação em registros concretos que deixam de ser encontrados — é o número que vai para o relatório de impacto. A taxa diz quão ruim é; a perda diz quanto custa.',
    exemplo:
      'Uma fonte com 50.000 registros e 98% de validade perde 1.000. Outra com 200 e 50% perde 100. A primeira parece muito melhor pela taxa e perde dez vezes mais registros — por isso as duas medidas andam juntas.',
  },
  Normalização: {
    oQue:
      'Quantas formas diferentes o mesmo valor assume nos campos controlados: type, language, rights, date e format.',
    como:
      'Contagem dos valores distintos de cada campo na amostra (record_values), marcando os que o perfil aceita. É descritiva: caracteriza o padrão, não produz escore por fonte.',
    paraQue:
      'Montar a tabela de equivalências que a padronização precisa: quais variantes mapear para qual termo, e quais valem mais a pena primeiro. Um índice de dispersão esconderia justamente essa lista.',
    exemplo:
      'O português circula como "por", "pt_BR", "pt" e "Português". Para o filtro de idioma do portal achar todos, as quatro formas precisam virar uma só — e a contagem de ocorrências diz por qual variante começar.',
  },
  Consistência: {
    oQue: 'Se o registro respeita o próprio esquema: em oai_dc, só os 15 elementos do Dublin Core simples.',
    como:
      'Conta os registros com elemento fora do esquema. O fenômeno está inteiro em 9 fontes e, em cada uma, atinge 100% dos registros amostrados. Por isso é descritiva: a informação útil é quais fontes, não quanto.',
    paraQue:
      'Achar fontes com a exportação mal configurada, cujo XML um coletor estrito pode rejeitar ou aproveitar só em parte. O resultado é uma lista de contato, não um ranking.',
    exemplo:
      'Um registro oai_dc que traz date.issued, publisher.country ou description.abstract: são campos qualificados do DSpace vazando para o esquema simples, onde não existem. Como aparece em todos os registros da fonte, é um único ajuste no mapeamento de exportação dela.',
  },
  Latência: {
    oQue: 'O tempo entre um documento ser publicado e ficar disponível no agregador.',
    como:
      'Não é medida neste trabalho. Exigiria a data de publicação; o datestamp do OAI é a data da última alteração do registro, e usar dc:date no lugar dá uma mediana da ordem de sete anos, que é a idade do acervo retroativo quando a fonte entrou no agregador.',
    paraQue:
      'Dizer quão rápido a produção nova chega ao portal — o que importa para quem procura o que acabou de sair. Fica na tabela para marcar a lacuna, não para ser lida como número.',
    exemplo:
      'Artigo publicado em 10/03 e visível no portal em 25/03: 15 dias de latência. Medir isso pediria coletar por janela temporal (from/until) e confrontar com a data de publicação — uma coleta que não foi feita.',
  },
}
