/*
 * O que a tabela `metadata_rules` não carrega: para que cada regra existe e um
 * exemplo de leitura. Descrição, obrigatoriedade, quantificador e fidelidade
 * vêm do dataset — aqui só o que é explicação, não definição.
 *
 * Chave é o `rule_id`. Regra nova no dataset sem entrada aqui abre a ficha só
 * com o que o dataset diz, sem quebrar.
 */
export const FICHAS_REGRA: Record<number, { paraQue: string; exemplo: string }> = {
  103: {
    paraQue:
      'Dizer ao agregador quando um documento sob embargo passa a poder ser aberto. Sem a data, ele fica fechado para sempre no portal, mesmo depois de liberado na origem.',
    exemplo:
      'Tese com dc:rights = info:eu-repo/semantics/embargoedAccess precisa de um dc:date como info:eu-repo/date/embargoEnd/2027-03-01. Um artigo em openAccess não tem embargo: a regra não se aplica e ele atende.',
  },
  104: {
    paraQue: 'É o mínimo para o registro ser exibido e encontrado. Sem título, não há o que mostrar na lista de resultados.',
    exemplo: 'Um registro sem dc:title aparece no portal como "sem título" — ou nem aparece, conforme o agregador.',
  },
  105: {
    paraQue:
      'Separar a versão publicada do preprint e do manuscrito aceito, que é o que o leitor precisa saber antes de citar.',
    exemplo:
      'dc:type = info:eu-repo/semantics/publishedVersion atende. Como o quantificador é ONE_ONLY, um registro com publishedVersion e acceptedVersion ao mesmo tempo viola: a versão tem de ser uma.',
  },
  106: {
    paraQue:
      'Classificar o documento num vocabulário que todo agregador entende — é o que permite filtrar "só teses" ou "só artigos" em qualquer portal.',
    exemplo:
      '"Dissertação" é legível para uma pessoa e reprova; info:eu-repo/semantics/masterThesis passa. info:eu-repo/semantics/publishedVersion também reprova aqui: é versão, não tipo.',
  },
  107: {
    paraQue: 'Deixar o filtro de idioma do portal funcionar, com um código só para cada idioma.',
    exemplo:
      '"por" atende. "pt_BR", "pt" e "Português" reprovam — são o mesmo idioma escrito de três jeitos que não são ISO 639-3. E "pot" passa, porque é código válido (potawatomi), embora quase sempre seja erro de digitação de "por": a regra verifica a forma, não a intenção.',
  },
  108: {
    paraQue: 'Permitir ordenar e filtrar por ano. Data fora da norma não entra em nenhum recorte temporal.',
    exemplo: '"2020" e "2020-07-24T17:11:46Z" atendem. "01/01/2005" e "2018.00" reprovam — o agregador não sabe ler.',
  },
  109: {
    paraQue: 'Dar à busca por tema algo além do título: é por assunto que se chega a documentos que usam outras palavras.',
    exemplo: 'Um artigo com cinco dc:subject aparece em cinco buscas temáticas a mais do que o mesmo artigo sem nenhum.',
  },
  110: {
    paraQue: 'O resumo é o que o leitor lê para decidir se abre o documento, e o que a busca de texto indexa além do título.',
    exemplo:
      'Qualquer dc:description com conteúdo atende. Em oai_dc não dá para saber se é abstract ou outra descrição — por isso a regra é aproximada.',
  },
  112: {
    paraQue:
      'Dizer se o documento está aberto, embargado ou fechado — é o que o portal de acesso aberto precisa ler para decidir o que mostrar.',
    exemplo:
      '"Acesso Aberto" por extenso e uma licença Creative Commons reprovam, embora digam a coisa certa: o termo que o perfil lê é info:eu-repo/semantics/openAccess. É a regra que mais reprova na base.',
  },
  114: {
    paraQue: 'Atribuir o trabalho acadêmico também a quem orientou, que é como a produção de um programa de pós é contada.',
    exemplo:
      'Uma dissertação sem dc:contributor viola. Um artigo não é trabalho acadêmico: a regra não se aplica e ele atende, com ou sem contributor.',
  },
  115: {
    paraQue: 'Atribuir autoria. Sem autor, o documento não aparece na busca por nome nem conta na produção de ninguém.',
    exemplo: '"MATOS, B.R." em dc:creator atende. O registro sem nenhum dc:creator é um documento órfão no portal.',
  },
  116: {
    paraQue: 'Levar do registro ao documento. Sem URL, o portal mostra a referência e o leitor não tem onde clicar.',
    exemplo:
      'http://repositorio.ipen.br/handle/123456789/31366 atende. Um DOI cru como "10.5007/…" não é URL e reprova sozinho — basta outro dc:identifier com http para o registro atender.',
  },
  117: {
    paraQue: 'Dizer que tipo de arquivo o leitor vai receber, e se o agregador consegue extrair texto dele.',
    exemplo: '"application/pdf" atende. "pdf", "Texto" e "1-13" (número de páginas no campo errado) reprovam.',
  },
  118: {
    paraQue: 'O mínimo de classificação: que o registro diga o que é, mesmo fora do vocabulário.',
    exemplo:
      '"Artigo avaliado pelos Pares" atende aqui e reprova na 106 — é exatamente a distância entre ter conteúdo e ter o conteúdo que a máquina lê.',
  },
  119: {
    paraQue: 'Resumo em português, separado do abstract, para o portal mostrar o idioma do leitor.',
    exemplo:
      'Não verificável nesta amostra: em oai_dc o resumo e o abstract saem no mesmo dc:description, e o valor não diz qual é qual. Medir exigiria coletar no formato próprio do DSpace (xoai).',
  },
}
