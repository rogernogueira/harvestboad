import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'

import { AppProviders } from '@/app/providers'
import { router } from '@/app/router'
/*
 * Ordem de carga: Font Awesome, core do DS e por último o nosso CSS.
 *
 * O Font Awesome 5 precisa vir declarado — o core referencia
 * `font-family: "Font Awesome 5 Free"` nos glifos de pseudo-elemento e os
 * componentes Br* emitem prefixos `fas`/`far`. Sem este import, todo `icon`
 * do design system renderiza vazio. A major 5 é obrigatória: na 6 os nomes
 * das classes e o mapa de glifos mudaram.
 *
 * O CSS do core não é importado aqui: ele entra por `@/index.css`, dentro de
 * uma camada de cascata nomeada. O motivo está comentado lá — sem a camada, o
 * core sobrescreve todas as utilitárias do Tailwind.
 */
import '@fortawesome/fontawesome-free/css/all.min.css'

import '@/i18n'
import '@/index.css'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Elemento #root não encontrado no index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
