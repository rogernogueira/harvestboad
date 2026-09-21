import { createBrowserRouter } from 'react-router'

import { AdminRoute } from '@/auth/AdminRoute'
import { ProtectedRoute } from '@/auth/ProtectedRoute'
import { AppShell } from '@/layouts/AppShell'
import { LoginPage } from '@/pages/LoginPage'

const lazyPage =
  <T extends Record<string, unknown>>(load: () => Promise<T>, name: keyof T & string) =>
  async () => ({ Component: (await load())[name] as React.ComponentType })

export const router = createBrowserRouter([
  { path: '/entrar', Component: LoginPage },
  {
    Component: ProtectedRoute,
    children: [
      {
        path: '/',
        Component: AppShell,
        children: [
          {
            index: true,
            lazy: lazyPage(() => import('@/pages/RepositoriesPage'), 'RepositoriesPage'),
          },
          {
            path: 'perfil',
            lazy: lazyPage(() => import('@/pages/ProfilePage'), 'ProfilePage'),
          },
          {
            // Administração: o guarda é conveniência de navegação; quem barra
            // de fato é o backend, com 403.
            Component: AdminRoute,
            children: [
              {
                path: 'acessos',
                lazy: lazyPage(() => import('@/pages/AccessPage'), 'AccessPage'),
              },
            ],
          },
          {
            // Fora do guarda de ADMIN de propósito: o gestor também abre a
            // seção, e vê as demandas dos repositórios que gerencia.
            path: 'demandas',
            lazy: lazyPage(() => import('@/pages/DemandsPage'), 'DemandsPage'),
          },
          {
            // Fora do guarda pelo mesmo motivo das demandas: a seção tem uma
            // aba para cada perfil. O gestor abre a caixa de entrada; as abas
            // de envio e de catálogo só o administrador monta, e quem as
            // recusa de fato é o backend, com 403.
            path: 'notificacoes',
            lazy: lazyPage(() => import('@/pages/NotificationsPage'), 'NotificationsPage'),
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
