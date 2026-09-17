---
paths:
  - "frontend/src/**/*.tsx"
---

# Atributo `id` nos componentes

Todo componente de tela — página, layout, guarda de rota e componente
compartilhado — emite `id` no elemento raiz e nos filhos que importam, para que
a estrutura seja legível ao inspecionar o HTML. Ao criar ou alterar um
componente, mantenha a convenção.

## Nomes

Kebab-case derivado do nome do componente, com os filhos recebendo sufixo:

    page-header
    page-header-title
    page-header-eyebrow
    page-header-actions

## Componentes reutilizáveis recebem `id` por prop

Com um padrão que cobre o uso avulso:

```tsx
export function StatCard({ id = 'stat-card', label, value }: { id?: string; ... }) {
  return (
    <div id={id} className="panel overflow-hidden">
      <p id={`${id}-label`} className="eyebrow">{label}</p>
      ...
```

## Em listas, o id embute a chave do registro

Um `id` fixo dentro de um `.map()` sai repetido, e isso é HTML inválido:
`getElementById` e `querySelector` passam a devolver sempre a primeira linha.
Quem renderiza a lista passa o valor único:

```tsx
<ValidityBadge id={`records-page-row-${registro.id}-validity`} valid={registro.isValid} />
```

Vale para `StatCard`, `Tag`, `HarvestStatusBadge`, `UsersIcon`, `UserPlusIcon`,
`Modal` e qualquer outro que apareça mais de uma vez na mesma tela.

O mesmo cuidado se aplica a atributos que referenciam um id: o título do `Modal`
é `${id}-titulo`, e não um literal, porque a tela do gestor monta um modal por
repositório — todos no documento ao mesmo tempo, e o `aria-labelledby` de todos
apontaria para o mesmo `<h2>`.

## Fora do escopo

Conteúdo interno de SVG (`path`, `g`, `circle`) e elementos de bibliotecas de
terceiros não precisam de `id`.
