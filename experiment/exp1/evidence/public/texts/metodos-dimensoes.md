---
titulo: Coleta de registros e medição das dimensões de qualidade
destino: seção de Materiais e Métodos
dataset: HB-EVIDENCE-2026-09-20-v1.0.0
gerado_de: exp1/coletar_registros.py · exp1/congelar.py · sql/views-registros.sql
aba: Dimensões
---

# 3.x Coleta de registros e medição das dimensões de qualidade

## 3.x.1 Universo e origem

As dimensões de qualidade em nível de registro foram medidas sobre uma amostra
obtida diretamente dos provedores de dados, e não do agregador. O universo é o
conjunto de 2.183 fontes registradas no Oasisbr, das quais 2.178 possuíam
endpoint OAI-PMH declarado no cadastro e foram contactadas em 21 de setembro de
2026. A data de referência do conjunto congelado é 20 de setembro de 2026: ela
designa o estado operacional registrado no agregador, contra o qual se calculam
os intervalos temporais, enquanto a coleta de registros junto aos provedores
constitui camada independente, realizada no dia seguinte.

Optou-se por consultar as origens diretamente porque as dimensões aqui tratadas
— completude, conformidade, duplicação, consistência e normalização — são
propriedades do registro, ao passo que a base operacional do agregador tem
granularidade de fonte e de coleta, registrando quantos documentos foram aceitos,
mas não qual elemento faltou em qual documento. As dimensões de **perda** e
**transformação** não pertencem a esta camada: são medidas no nível da coleta, a
partir das contagens de registros trazidos, válidos e transformados que o
agregador registra, e estão definidas na subseção correspondente. Cabe notar que,
medidas daquele modo, ambas são grandezas de volume e não de conteúdo — dizem
quantos registros foram rejeitados ou convertidos, não o que se alterou em cada
um.

## 3.x.2 Protocolo de coleta

Emitiu-se uma requisição `ListRecords` por fonte, com os seguintes critérios:

**Formato de metadados.** Solicitou-se `oai_dc` a todas as fontes,
independentemente do prefixo que cada uma declara no cadastro. O cadastro
registra oito prefixos distintos — `oai_dc` em 2.045 fontes, `xoai` em 114,
`oai_datacite` em 16, entre outros —, e comparar completude entre formatos
diferentes equivaleria a comparar vocabulários diferentes, dado que um elemento
ausente em um esquema pode existir sob outra denominação. O `oai_dc` é de
suporte obrigatório para todo repositório em conformidade com o OAI-PMH 2.0,
constituindo o único denominador comum que permite medida comparável entre
fontes. Onde o formato não foi servido, registrou-se o desfecho
`cannotDisseminateFormat`, que é ele próprio um achado de conformidade.

**Profundidade.** Uma página por fonte, sem seguir o `resumptionToken`. O
tamanho da página é definido pelo provedor e não foi negociado: a mediana
resultante é de 100 registros por fonte, com 11 fontes retornando mais e máximo
de 2.532, por servirem páginas maiores. A amostra destina-se a estimar taxas — propriedades do fluxo
editorial de quem publica, razoavelmente estáveis dentro de uma mesma fonte — e
não a caracterizar o acervo.

**Cortesia com os provedores.** A paralelização foi feita por *host* e não por
fonte, com atendimento sequencial das fontes que compartilham o mesmo servidor e
intervalo de 0,7 s entre requisições; o paralelismo decorreu do atendimento
simultâneo de até doze hosts distintos. Adotou-se tempo limite de 40 s e
obedeceu-se ao controle de fluxo do protocolo (resposta 503 com cabeçalho
`Retry-After`). O critério não é apenas ético, é de validade de medida: sob
concorrência alta e prazo curto, tempo esgotado do lado do cliente é registrado
como não-resposta da origem, e a não-resposta assim produzida entra na análise
como se fosse propriedade da fonte. Etapas anteriores deste experimento
observaram esse efeito ao reconsultar, em série e com prazo folgado, fontes antes
classificadas como inacessíveis.

**Preservação.** O XML bruto não foi retido, por volume: as respostas somariam
centenas de megabytes. Preservou-se o SHA-256 de cada resposta, que sustenta a
proveniência de cada valor extraído, e os campos já desmontados. Valores textuais
foram truncados em 500 caracteres, com registro do comprimento original quando
houve truncamento; nenhuma das dimensões medidas depende da leitura integral de
um resumo.

## 3.x.3 Definições operacionais

Extraíram-se, de cada registro, o cabeçalho OAI (identificador, *datestamp*,
conjuntos, marcação de exclusão) e os quinze elementos do Dublin Core simples.
Distinguiu-se o `<identifier>` do cabeçalho — chave do protocolo — do
`dc:identifier` do metadado, que designa o documento.

As cinco dimensões tratadas nesta camada dividem-se em dois grupos de estatuto
distinto, e a distinção é deliberada. **Três produzem indicadores**: grandezas
em escala 0–1, definidas por registro e agregadas por fonte, comparáveis entre
fontes e passíveis de entrar em teste estatístico. **Duas constituem análises
descritivas**: caracterizam padrões observados sem produzir um índice
comparável, e não devem ser lidas como escores de qualidade.

### Indicadores

- **Completude** — número de elementos Dublin Core distintos presentes no
  registro, dividido por quinze. A completude da fonte é a média aritmética
  desse valor entre seus registros vivos. Mede presença, não adequação.
- **Conformidade** — média de quatro critérios do perfil DRIVER/OpenAIRE
  verificáveis no próprio registro: `dc:type` iniciado por
  `info:eu-repo/semantics/`; `dc:rights` contendo termo de nível de acesso
  (`info:eu-repo/semantics/*Access`); `dc:language` em código ISO 639; e
  `dc:date` em formato ISO 8601. A conformidade da fonte é a média das quatro
  proporções de registros que satisfazem cada critério. Presença e conformidade
  foram deliberadamente separadas: um `dc:type` preenchido com "Artigo avaliado
  pelos Pares" é completo e não é legível por máquina.

  Para campos multivalorados a regra **não é uniforme**, e a assimetria é
  intencional. `dc:type` e `dc:rights` satisfazem o critério se **qualquer**
  valor conformar, porque são aditivos: o repositório legitimamente emite o termo
  controlado e um rótulo livre ao lado — em 70,9% dos registros com texto livre
  em `dc:type` o termo `info:eu-repo` está presente no mesmo registro, de modo
  que exigir conformidade de todos reprovaria quem faz certo. `dc:language` e
  `dc:date` exigem que **todos** os valores conformem, por serem enumerativos:
  cada valor é asserção independente e uma data malformada é um defeito.
- **Duplicação** — proporção de registros cujo SHA-1 do título normalizado (sem
  acentuação, pontuação ou distinção de caixa) já ocorreu antes na mesma fonte,
  sobre o total de registros com título elegível. Elegível é o registro vivo cujo
  título tenha **sete palavras ou mais**. O corte é essencial e não é arbitrário:
  sem ele, a medida retorna "Editorial" em 578 periódicos e "Apresentação" em
  315, uma vez que toda revista publica seções assim a cada número. Aplicado o
  corte, as repetições internas caem de 5.827 para 463. Mede-se também a
  duplicação entre fontes, pelo mesmo hash e mesmo corte.

### Análises descritivas

- **Consistência** — ocorrência de elementos alheios ao Dublin Core simples
  dentro do envelope `oai_dc`. Reporta-se a contagem de registros afetados e a
  identificação das fontes, não uma taxa. O fenômeno é integralmente concentrado
  — 8 fontes, e nelas 100% dos registros —, de modo que um índice por fonte
  separaria apenas oito casos de mil e quinhentos zeros, sem ganho analítico.
- **Normalização** — distribuição dos valores efetivamente empregados nos campos
  de vocabulário controlado (`type`, `language`, `rights`, `format`, `date`),
  preservados em formato longo (913.104 valores) com marcação de conformidade por
  valor. Descreve a heterogeneidade observada — o português aparece como `por`,
  `pt_BR`, `pt` e `Português` — sem reduzi-la a um número. Uma medida de
  dispersão seria possível, mas não foi adotada: a informação útil aqui é *quais*
  grafias circulam e em quantas fontes, e não o grau agregado de dispersão.

## 3.x.4 Critérios de inclusão e exclusão

Foram incluídas todas as fontes que retornaram ao menos um registro. Registros
marcados como excluídos no cabeçalho OAI (10.769, ou 7,0% da amostra) não trazem
bloco de metadados — verificou-se que todos apresentam zero elementos Dublin Core
— e foram, por isso, excluídos de todas as medidas de conteúdo, entrando apenas
na caracterização da amostra. Em 48 fontes a página retornada continha
exclusivamente registros dessa natureza, restando sem medida de completude; as
métricas por fonte apoiam-se, portanto, em 1.502 fontes.

## 3.x.5 Limitações

**A amostra não é aleatória nem representativa, e o desvio é mensurável.** Das
2.178 fontes contactadas, 1.550 responderam (71,2%); as demais retornaram 403
(241), falha de rede (147), documento não-XML (112) ou outros erros HTTP. As 628
fontes ausentes encontram-se em estado sistematicamente pior: mediana de 446
dias desde a última coleta contra 254 das presentes, e 338 com erro na última
coleta contra 112. As 215 fontes servidas pela plataforma SciELO estão
integralmente ausentes por causa determinada: 212 têm cadastrado o endpoint
agregador `old.scielo.br`, que responde HTTP 403, e 3 apontam para
`www.scielo.br`, que responde 404; nenhuma possui endpoint próprio registrado.
**A amostra é, portanto, enviesada em favor de fontes operacionalmente
acessíveis, e as estimativas agregadas de qualidade podem ser otimistas em
relação ao universo completo.** Note-se que a inferência inversa não se sustenta
nos dados: entre as fontes presentes, as que estão há mais de um ano sem coleta
apresentam completude mediana ligeiramente superior (0,811) à das coletadas no
último ano (0,797), de modo que abandono operacional não implica, por si,
metadado pior.

Registram-se ainda: a verificação de idioma aceita `pt_BR`, que é identificador
de localidade e não código ISO de idioma, decisão que reduz o rigor do critério;
e uma página por fonte não permite inferência sobre a variação interna do acervo
de fontes grandes.

## 3.x.6 Reprodutibilidade

Os dados derivados foram congelados em três tabelas Parquet (`records`,
`record_values`, `record_metrics`), integrantes do conjunto
`HB-EVIDENCE-2026-09-20-v1.0.0`, acompanhadas de somas SHA-256. As definições
operacionais descritas em 3.x.3 estão materializadas em
`sql/views-registros.sql`, distribuído junto ao conjunto, de modo que a
reexecução das mesmas consultas sobre os mesmos arquivos reproduz os valores
apresentados. A rotina de congelamento é função pura dos arquivos de coleta:
entradas idênticas produzem arquivos idênticos byte a byte.
