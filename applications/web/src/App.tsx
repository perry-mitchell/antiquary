import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { ToastProvider } from './components/Toast'
import { CollectionPage, NotFoundPage } from './pages/CollectionPage'
import { HomePage } from './pages/HomePage'
import { ItemFormPage } from './pages/ItemFormPage'
import { ItemPage } from './pages/ItemPage'
import { SearchPage } from './pages/SearchPage'
import { SettingsPage } from './pages/SettingsPage'
import { TemplateFormPage } from './pages/TemplateFormPage'
import { TemplatesPage } from './pages/TemplatesPage'
import { TrashPage } from './pages/TrashPage'

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/collections/:id" element={<CollectionPage />} />
          <Route path="/items/new" element={<ItemFormPage mode="create" />} />
          <Route path="/items/:id" element={<ItemPage />} />
          <Route path="/items/:id/edit" element={<ItemFormPage mode="edit" />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/templates/new" element={<TemplateFormPage mode="create" />} />
          <Route path="/templates/:id/edit" element={<TemplateFormPage mode="edit" />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </ToastProvider>
  )
}
