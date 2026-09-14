import { createBrowserRouter } from 'react-router'

import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { RootLayout } from '@/layouts/RootLayout'
import { LoginPage } from '@/pages/LoginPage'

const lazyPage = <T extends Record<string, unknown>>(
  load: () => Promise<T>,
  name: keyof T & string,
) => async () => ({ Component: (await load())[name] as React.ComponentType })

export const router = createBrowserRouter([
  { path: '/entrar', Component: LoginPage },
  {
    Component: ProtectedRoute,
    children: [
      {
        path: '/',
        Component: RootLayout,
        children: [
          {
            index: true,
            lazy: lazyPage(() => import('@/pages/RepositoriesPage'), 'RepositoriesPage'),
          },
          {
            path: 'trocar-senha',
            lazy: lazyPage(() => import('@/pages/ChangePasswordPage'), 'ChangePasswordPage'),
          },
          {
            path: 'repositorios/:repositoryId',
            lazy: lazyPage(() => import('@/pages/RepositoryPage'), 'RepositoryPage'),
          },
          {
            path: 'coletas/:snapshotId',
            lazy: lazyPage(() => import('@/pages/HarvestLayout'), 'HarvestLayout'),
            children: [
              {
                index: true,
                lazy: lazyPage(() => import('@/pages/DiagnosisPage'), 'DiagnosisPage'),
              },
              {
                path: 'registros',
                lazy: lazyPage(() => import('@/pages/RecordsPage'), 'RecordsPage'),
              },
            ],
          },
          {
            // Splat: o identificador OAI contém "/" e precisa chegar inteiro.
            path: 'coletas/:snapshotId/registros/*',
            lazy: lazyPage(() => import('@/pages/RecordPage'), 'RecordPage'),
          },
          {
            path: '*',
            lazy: lazyPage(() => import('@/pages/NotFoundPage'), 'NotFoundPage'),
          },
        ],
      },
    ],
  },
])
