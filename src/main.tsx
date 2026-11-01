import { createRoot } from 'react-dom/client'
import App from './App'
import { LauncherProvider } from './state/LauncherProvider'
import './styles/base.css'
import './styles/components.css'
import './styles/app.css'
import './styles/theme.css'

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

if (!window.aqua) {
  root.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;background:#0e091c;color:#f4f1ff;font-family:system-ui,sans-serif;padding:32px;text-align:center">
      <div>
        <h1 style="font-size:22px;margin:0 0 8px">Aqua runs as a desktop app</h1>
        <p style="color:#a79dbf;margin:0">Start it with <code style="color:#8fc4ff">npm run dev</code> rather than opening this page in a browser.</p>
      </div>
    </div>
  `
} else {
  window.addEventListener('error', (event) => {
    void window.aqua?.reportRendererError({
      message: event.message || 'Renderer error',
      stack: event.error instanceof Error ? event.error.stack : undefined,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    void window.aqua?.reportRendererError({
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  createRoot(root).render(
    <LauncherProvider>
      <App />
    </LauncherProvider>,
  )
}
