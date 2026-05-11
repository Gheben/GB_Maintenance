import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { NotificationBell } from './NotificationBell'

export function Header({ title }) {
  const { dark, toggle } = useTheme()
  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{title}</h1>
      <div className="flex items-center gap-2">
        <NotificationBell />
        <button onClick={toggle} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  )
}
