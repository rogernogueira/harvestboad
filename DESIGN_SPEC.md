# COMAIS — Especificação de Design Atualizada

Esta especificação reflete o frontend implementado no código atual do projeto, com foco no layout da landing page, navegação, identidade visual e padrões de interação presentes em produção.

---

## 1. Visão geral

O site do COMAIS segue uma estética institucional clara, leve e tecnológica, com forte presença de elementos em branco, tipografia contrastante e marcações em azul institucional. O visual combina a linguagem de laboratório acadêmico com uma leitura moderna inspirada em landing pages de produtos e centros de pesquisa.

A identidade atual está implementada em:
- AppShell e Header
- Footer
- HomePage
- index.css
- NAV_ITEMS em src/lib/navigation.ts

---

## 2. Tokens visuais

### 2.1 Paleta de cores

| Uso | Valor | Token atual |
|-----|-------|-------------|
| Azul institucional | #5B84B1 | brand-blue |
| Dourado | #D6C68B | brand-gold |
| Verde | #9CB994 | brand-green |
| Cinza institucional | #5A5B5D | brand-gray |
| Texto principal | #333333 | brand-text |
| Fundo principal | #FFFFFF | background |
| Fundo neutro | #F8FAFC / cinza claro | slate-50 |

Padrão atual observado no CSS:
- azul principal em CTAs, destaques, links ativos e elementos de interação
- dourado e verde usados como acentos em blocos de conteúdo e mosaicos
- texto em cinza escuro e preto para leitura confortável
- fundo branco predominante, com seções alternadas em neutral soft

### 2.2 Tipografia

Fonte definida em CSS:
- Headings: Montserrat
- Body/UI: Open Sans
- Labels e eyebrow: font-mono com uppercase e tracking elevado

Implementação atual:
- headings via font-heading
- corpo via font-sans
- labels de seção com uppercase + tracking 0.18em a 0.28em

### 2.3 Raio de borda

O design atual não usa bordas arredondadas fortes. A maioria dos cards e botões usa bordas quadradas ou levemente arredondadas em elementos de destaque, mas a assinatura visual principal é a aparência enxuta e angular.

Observação importante:
- Botões e cards podem usar rounded por conveniência de componente, mas a linguagem visual da página prioriza linhas retas e blocos bem definidos.
- No código, a propriedade --radius fica em 0.75rem no tema, mas na prática a interface visual usa formas mais retas especialmente em CTAs, navegação e blocos de conteúdo.

---

## 3. Estrutura da página principal

A HomePage implementa uma landing page com as seguintes seções, em ordem:

1. Hero
2. Parceiros / logos em marquee
3. Notícias
4. Projetos
5. Serviços online
6. Cursos e formações
7. Equipe
8. Missão
9. Visão / objetivos
10. Domínios de atuação

A estrutura é modular e a navegação é feita com React Router, com layout global em AppShell.

---

## 4. Header e navegação

### 4.1 Layout

O Header contém:
- faixa institucional superior com texto UFT/PPGGTD
- barra principal com marca COMAIS + Labs
- menu desktop horizontal
- botão Entrar no desktop
- menu mobile de acesso em hamburguer

### 4.2 Navegação

Itens ativos em NAV_ITEMS:
- Início
- Sobre
- Notícias
- Cursos
- Projetos
- Serviços
- Equipe
- Contato

O item Sobre possui submenu com links para:
- Missão
- Visão

A navegação usa links com underline animado em baixo, com transição de escala e cor ao hover.

### 4.3 Estado visual

Padrão atual:
- texto principal em brand-text
- item ativo em brand-blue
- hover em brand-blue
- underline animado em 2px com transição
- menu mobile em painel branco com blocos discretos

---

## 5. Hero section

### 5.1 Composição

O hero da HomePage é dividido em duas colunas em desktop:
- esquerda: texto + CTA
- direita: logo do COMAIS em destaque

Layout observado:
- max-w-6xl
- grid com 1.1fr 0.9fr
- gap de 10 em telas grandes
- texto com destaque em azul no segundo trecho da frase principal

### 5.2 Texto principal

H1 atual:
- Modelo: Modelagem Computacional de Soluções de Inteligência Artificial
- segunda parte destacada em azul
- typography: font-heading, font-extrabold, tracking negativo
- mobile: text-4xl
- desktop: lg:text-[4rem]

Edição complementada por eyebrow em mono:
- Laboratório de Inteligência Artificial · UFT
- subtitle em uppercase com tracking de 0.2em

### 5.3 Logo do hero

- imagem: /brand/logo-comais1188x713.png
- exibida grande na coluna direita
- elemento flutuante via animate-hero-float
- box-shadow suave e radial glow azul ao fundo

### 5.4 Mosaico decorativo

Há um mosaico de blocos em azul, dourado e verde no canto superior direito do hero, implementado em JS com renderização de tiles em grid.

Características:
- totalmente decorativo
- oculto em mobile
- visível apenas em telas maiores
- densidade maior na diagonal e no canto superior direito
- opacidade variável por linha/coluna

Este efeito é a resposta visual direta do código à referência de fireworks ai aplicada à identidade COMAIS.

### 5.5 Animações

Implementadas em src/index.css:
- slideInBottom: entrada do H1 com fade + deslocamento vertical
- hero-float: flutuação do logo em 6s infinito

Transições padrão:
- duration-150 ease-out
- hover em CTAs com leve variação de opacidade

---

## 6. Parceiros em marquee

Depois do hero, há uma seção de parceiros com:
- título pequeno em uppercase
- linha de logos em movimento horizontal
- autoFill e pauseOnHover
- velocidade 40
- máscara de fade nas bordas

Design:
- fundo branco com borda top/bottom sutil
- logos em opacidade 90%, aumento para 100% no hover
- espaçamento uniforme entre marcas

A lista atual de parceiros inclui:
- Universidade Federal do Tocantins
- PPGGTD
- Fundação de Apoio Científico e Tecnológico do Tocantins
- Softex
- Huawei

---

## 7. Cards e blocos de conteúdo

### 7.1 Notícias

A seção de notícias usa uma composição editorial com:
- destaque principal em card com imagem + texto
- item complementar em card compacto com imagem lateral
- bordas discretas, sombras suaves e hover leve

Tipografia:
- data em uppercase com tracking e cor azul
- título em Montserrat com peso forte
- resumo em cinza

### 7.2 Projetos

A seção de projetos tem:
- filtros por tipo, em chips com contagem por categoria
- cards em grid com imagem, título, resumo e tags
- hover com elevação suave e ícone de seta no topo direito da imagem

Padrão atual:
- 3 cards por linha em desktop
- 2 em tablet
- 1 em mobile

### 7.3 Serviços online

Seção com blocos em grid 4 colunas em desktop:
- ícone em caixa azul clara
- título em destaque
- descrição curta
- hover com borda azul e elevação

Serviços atuais:
- RedCap
- Conversor PDF
- Smart Review
- Apoio técnico

### 7.4 Cursos e formações

Cartões de curso com layout compacto:
- ícone contextual por título
- data, carga horária e modalidade
- badges e setas de ação

### 7.5 Equipe

Blocos de colaboradores com:
- avatar circular ou inicial sem foto
- nome e função
- botão com label de currículo Lattes
- hover com ring azul e leve elevação

---

## 8. Seções institucionais

### 8.1 Missão

Seção textual com layout de duas colunas:
- esquerda: label + título "Missão"
- direita: texto de apresentação em duas frases

A escrita do conteúdo é institucional e enfatiza colaboração entre pesquisadores, empresas e governo.

### 8.2 Visão / objetivos

Blocos em grid com 3 pilares:
- Integração
- Multidisciplinaridade
- Inovação

Cada objetivo possui:
- número em mono
- ícone
- título em heading
- descrição curta
- faixa azul/verde/dourada no topo

### 8.3 Domínios de atuação

Lista em grid com palavras-chave:
- Judicial
- Segurança Pública
- Ambiental
- Social

Estética simples e linear, com numeração em mono e títulos em heading.

---

## 9. Footer

O Footer implementa um layout em 4 colunas:

1. Marca + endereço
2. Links úteis
3. Serviços
4. Onde estamos

Elementos presentes:
- marca COMAIS Labs
- endereço físico
- e-mail institucional
- ligações para serviços externos
- informação de copyright e unidade acadêmica

A identidade visual do rodapé é neutra, em slate-50, com texto em cinza e destaques em azul.

---

## 10. Comportamento responsivo

### Mobile
- hero com texto acima do logo
- menu em stack em hamburguer
- cards em coluna única
- marcações e labels menores
- seções espaçadas por padding reduzido

### Tablet / Desktop
- hero em duas colunas
- logo no lado direito
- grids de 2 a 4 colunas conforme seção
- destaque maior em cards e typo

### Breakpoints implementados
- default: 0+
- sm: 640px
- lg: 1024px
- xl: 1280px

---

## 11. Estado de implementação atual

A implementação atual já consolida as decisões principais do design:
- identidade visual clara e institucional
- linguagem de laboratório pesquisa em azul
- uso de Montserrat + Open Sans
- camadas de bloco com bordas sutis e contraste alto
- hover discreto e minimalista
- hero com presença editorial e elementos visuais de marca
- navegação com subtile interaction states
- landing page funcional guiada por conteúdo dinâmico da API

---

## 12. Interação, acessibilidade e estados

### 12.1 Microinterações

O código atual usa microinterações sutis para manter a interface elegante e institucional, sem excessivo movimento:
- hover em links e botões com mudança de cor e elevação leve
- cards com shadow e elevação ao passar o mouse
- setas e ícones com deslocamento mínimo em hover
- underline animado na navegação principal
- transição padrão de 150ms em elementos de CTA e navegação

### 12.2 Acessibilidade

A interface já incorpora vários padrões de acessibilidade observáveis na implementação:
- imagens com alt text descritivo
- aria-label em botões de menu mobile
- foco visível em links e botões via ring de destaque
- contraste alto entre texto e fundo
- uso de semantic HTML em headings, nav, main, footer, sections
- menu mobile e submenu com interação por teclado e clique

### 12.3 Estados de carregamento e erro

Em páginas com conteúdo carregado via API, a implementação usa feedback explícito ao usuário:
- loader animado com Loader2
- textos como “Carregando notícias…”, “Carregando projetos…”
- blocos de conteúdo só renderizam quando os dados chegam
- mensagens de erro ficam em estado visível quando a requisição falha

### 12.4 Redução de movimento

No CSS há suporte para acessibilidade motora:
- @media (prefers-reduced-motion: reduce)
- a animação do hero-float é removida quando o usuário indica preferência por menor movimento

Isso funciona como política de uso coerente com o design friccionado e leve do site.

---

## 13. Conformidade com o código

A especificação abaixo representa o estado real do código atual:

- [x] Header com faixa institucional + menu principal
- [x] Hero com texto, CTA e logo
- [x] Mosaico decorativo no canto superior direito
- [x] Marquee de parceiros
- [x] Seções dinâmicas de notícias, projetos, serviços, cursos e equipe
- [x] Footer com marca e informação institucional
- [x] Paleta azul/dourado/verde com fundos claros
- [x] Tipografia Montserrat + Open Sans
- [x] Responsividade mobile-first implementada
- [x] Navegação por rotas e menu com submenu de Sobre
- [x] Microinterações leves e consistentes
- [x] Estados de carregamento e foco acessível
- [x] Suporte a redução de movimento

---

**Última atualização**: 1 de setembro de 2026  
**Versão**: 2.1  
**Status**: alinhada ao código atual do frontend do COMAIS e com diretrizes de interação/acessibilidade adicionadas
